// Single-password key scheme (v2), modelled on Bitwarden:
//
//   master password + email ──PBKDF2-SHA256 (600k)──► master key
//   master key ──HKDF "auth"──► login secret   (sent to Supabase as the account password)
//   master key ──HKDF "wrap"──► wrapping key   (never leaves the browser)
//
// The vault itself is encrypted with a random vault key. That key is stored wrapped twice:
// once by the master password's wrapping key and once by a random recovery code. Changing the
// master password or the recovery code only re-wraps the vault key; the data is not re-encrypted.
// The server can't turn the login secret back into the wrapping key (HKDF is one-way).
import { ITER, b64, unb64 } from "./crypto"

export type Wrapped = { iv: string; ct: string }
export type KeySlots = { master: Wrapped; recovery?: Wrapped; /** Kept only while a master-password change is in flight. */ masterPrev?: Wrapped }
export type EnvelopeV2 = { v: 2; kdf: "PBKDF2-SHA256"; iter: number; salt: string; keys: KeySlots; iv: string; ct: string }
export type Header = Omit<EnvelopeV2, "iv" | "ct">
export type MasterKeys = { login: string; wrap: CryptoKey; salt: Uint8Array<ArrayBuffer> }

const enc = new TextEncoder()
const dec = new TextDecoder()
const AES = { name: "AES-GCM", length: 256 } as const

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

/** Deterministic per-account salt, so the login secret can be derived before signing in. */
export async function emailSalt(email: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`tuseif-v2|${normalizeEmail(email)}`)))
}

const b64url = (bytes: ArrayBuffer) => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

async function hkdf(base: CryptoKey, info: string) {
  return crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode(info) }, base, 256)
}

export async function deriveMasterKeys(password: string, salt: Uint8Array<ArrayBuffer>, iter = ITER): Promise<MasterKeys> {
  const pw = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"])
  const master = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, pw, 256)
  const base = await crypto.subtle.importKey("raw", master, "HKDF", false, ["deriveBits"])
  const [loginBits, wrapBits] = await Promise.all([hkdf(base, "tuseif v2 login"), hkdf(base, "tuseif v2 wrap")])
  // The fixed prefix/suffix only guarantees every character class, in case the Supabase project
  // enforces password composition rules. All of the entropy is in the 256-bit middle part.
  const login = `tz2!${b64url(loginBits)}Aa1`
  const wrap = await crypto.subtle.importKey("raw", wrapBits, AES, false, ["encrypt", "decrypt"])
  return { login, wrap, salt }
}

export const deriveForEmail = async (password: string, email: string) => deriveMasterKeys(password, await emailSalt(email))

// ---------- vault key ----------
export const newVaultKey = () => crypto.subtle.generateKey(AES, true, ["encrypt", "decrypt"]) as Promise<CryptoKey>

export async function wrap(vaultKey: CryptoKey, by: CryptoKey): Promise<Wrapped> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const raw = await crypto.subtle.exportKey("raw", vaultKey)
  return { iv: b64(iv), ct: b64(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, by, raw)) }
}

/** Throws if `by` is the wrong key (AES-GCM authentication fails). */
export async function unwrap(w: Wrapped, by: CryptoKey) {
  const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(w.iv) }, by, unb64(w.ct))
  // Extractable so it can be re-wrapped for a new master password or recovery code.
  return crypto.subtle.importKey("raw", raw, AES, true, ["encrypt", "decrypt"])
}

/** Opens the vault key with the master password, falling back to the slot kept during a password change. */
export async function unlockWithMaster(h: Header, master: MasterKeys) {
  try { return await unwrap(h.keys.master, master.wrap) } catch (e) {
    if (!h.keys.masterPrev) throw e
    return unwrap(h.keys.masterPrev, master.wrap)
  }
}

// ---------- recovery code ----------
const B32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no I, O, 0, 1: easy to read back from paper

/** 25 characters from a 32-symbol alphabet = 125 bits, shown as five groups of five. */
export function newRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(25))
  const chars = [...bytes].map((b) => B32[b & 31]).join("")
  return chars.match(/.{5}/g)!.join("-")
}

export function normalizeRecoveryCode(input: string) {
  const s = input.toUpperCase().replace(/[\s-]/g, "")
  return s.length === 25 && [...s].every((c) => B32.includes(c)) ? s : null
}

export async function recoveryWrapKey(code: string) {
  const norm = normalizeRecoveryCode(code)
  if (!norm) throw new Error("รูปแบบรหัสกู้คืนไม่ถูกต้อง")
  // The code is already high-entropy, so a fast KDF is enough.
  const base = await crypto.subtle.importKey("raw", enc.encode(norm), "HKDF", false, ["deriveBits"])
  return crypto.subtle.importKey("raw", await hkdf(base, "tuseif v2 recovery"), AES, false, ["encrypt", "decrypt"])
}

// ---------- envelope ----------
export async function newHeader(vaultKey: CryptoKey, master: MasterKeys, recoveryCode: string): Promise<Header> {
  return {
    v: 2, kdf: "PBKDF2-SHA256", iter: ITER, salt: b64(master.salt),
    keys: { master: await wrap(vaultKey, master.wrap), recovery: await wrap(vaultKey, await recoveryWrapKey(recoveryCode)) },
  }
}

export async function sealV2(header: Header, vaultKey: CryptoKey, data: unknown): Promise<EnvelopeV2> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, vaultKey, enc.encode(JSON.stringify(data)))
  return { ...header, iv: b64(iv), ct: b64(ct) }
}

export async function openV2(blob: EnvelopeV2, vaultKey: CryptoKey): Promise<unknown> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, vaultKey, unb64(blob.ct))
  return JSON.parse(dec.decode(pt))
}

export const headerOf = ({ iv: _iv, ct: _ct, ...h }: EnvelopeV2): Header => h

const isWrapped = (w: unknown): w is Wrapped => {
  if (!w || typeof w !== "object") return false
  const { iv, ct } = w as Record<string, unknown>
  if (typeof iv !== "string" || typeof ct !== "string") return false
  try { return unb64(iv).length === 12 && unb64(ct).length === 48 } catch { return false }
}

export function isEnvelopeV2(x: unknown): x is EnvelopeV2 {
  if (!x || typeof x !== "object") return false
  const v = x as Record<string, unknown>
  if (v.v !== 2 || v.kdf !== "PBKDF2-SHA256" || v.iter !== ITER) return false
  if (!["ct", "iv", "salt"].every((k) => typeof v[k] === "string")) return false
  const k = v.keys as Record<string, unknown> | undefined
  if (!k || !isWrapped(k.master)) return false
  if (k.recovery !== undefined && !isWrapped(k.recovery)) return false
  if (k.masterPrev !== undefined && !isWrapped(k.masterPrev)) return false
  try {
    return unb64(v.salt as string).length === 32 && unb64(v.iv as string).length === 12 && unb64(v.ct as string).length >= 16
  } catch { return false }
}
