// Unlocking with a passkey (Face ID, Touch ID, a fingerprint) through the WebAuthn PRF extension.
//
//   enable:  new passkey ──PRF(salt)──► secret ──HKDF──► device key;  vault key ──wrapped by device key──► localStorage
//   unlock:  passkey prompt ──PRF(salt)──► same secret ──HKDF──► device key ──unwraps──► vault key
//
// The PRF secret only comes out of the authenticator after the person verifies, so the wrapped
// key kept on this device is useless without them. Nothing is added to the envelope or sent to
// the server: this is a per-device shortcut, and the master password still opens the vault.
import { b64, unb64 } from "./crypto"
import { normalizeEmail, unwrap, wrap, type Wrapped } from "./keys"

const KEY = "vault-biometric"
/** A passkey created whose PRF secret could not be read in the same tap; finished on the next try. */
const PENDING = "vault-biometric-pending"
const AES = { name: "AES-GCM", length: 256 } as const
const enc = new TextEncoder()

export type BiometricRecord = { email: string; credentialId: string; salt: string; wrapped: Wrapped }

export class BiometricUnsupportedError extends Error {
  constructor() { super("อุปกรณ์หรือเบราว์เซอร์นี้ยังไม่รองรับการปลดล็อกด้วย Passkey (iPhone ต้อง iOS 18 ขึ้นไป)") }
}
export class BiometricCancelledError extends Error {
  constructor() { super("ยกเลิกการยืนยันตัวตน") }
}
export class BiometricPendingError extends Error {
  constructor() { super("สร้าง Passkey แล้ว กดสวิตช์อีกครั้งเพื่อยืนยันด้วย Face ID หรือลายนิ้วมือให้เสร็จ") }
}

// ---------- what this device remembers ----------
export function biometricRecord(email: string): BiometricRecord | null {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? "null") as BiometricRecord | null
    if (!r || typeof r !== "object" || r.email !== normalizeEmail(email)) return null
    if (typeof r.credentialId !== "string" || typeof r.salt !== "string" || !r.wrapped) return null
    return r
  } catch { return null }
}
export const hasBiometric = (email: string) => biometricRecord(email) !== null
export function forgetBiometric() {
  try { localStorage.removeItem(KEY); localStorage.removeItem(PENDING) } catch { /* nothing stored */ }
}
type Pending = { email: string; credentialId: string; salt: string }
function pendingFor(email: string): Pending | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING) ?? "null") as Pending | null
    return p && p.email === normalizeEmail(email) && typeof p.credentialId === "string" && typeof p.salt === "string" ? p : null
  } catch { return null }
}
function remember(r: BiometricRecord) {
  localStorage.setItem(KEY, JSON.stringify(r))
}

// ---------- crypto (no WebAuthn here, so it is testable) ----------
/** AES key for this device from the authenticator's PRF secret. */
export async function deviceKey(prf: ArrayBuffer) {
  const base = await crypto.subtle.importKey("raw", prf, "HKDF", false, ["deriveBits"])
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode("tuseif v2 biometric") }, base, 256)
  return crypto.subtle.importKey("raw", bits, AES, false, ["encrypt", "decrypt"])
}
export const wrapForDevice = async (vaultKey: CryptoKey, prf: ArrayBuffer) => wrap(vaultKey, await deviceKey(prf))
/** Throws if `prf` is not the secret the key was wrapped with. */
export const unwrapFromDevice = async (wrapped: Wrapped, prf: ArrayBuffer) => unwrap(wrapped, await deviceKey(prf))

// ---------- WebAuthn ----------
/** A platform authenticator (Face ID, Touch ID, Windows Hello, Android biometrics) exists. PRF support only shows at enrolment. */
export async function biometricSupported() {
  try {
    return typeof PublicKeyCredential !== "undefined" && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch { return false }
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n))
/** The PRF output as a plain ArrayBuffer, whichever view the browser hands back (no instanceof: it fails across realms). */
const bytes = (v: BufferSource): ArrayBuffer => ArrayBuffer.isView(v) ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer : v
const failed = (e: unknown) => (e instanceof DOMException && e.name === "NotAllowedError" ? new BiometricCancelledError() : e)
const prfOf = (cred: PublicKeyCredential) => cred.getClientExtensionResults().prf

/** Asks the passkey for its PRF secret; one biometric prompt. */
async function prfSecret(credentialId: string, salt: Uint8Array<ArrayBuffer>) {
  let cred: Credential | null
  try {
    cred = await navigator.credentials.get({
      publicKey: {
        challenge: random(32), rpId: location.hostname, userVerification: "required", timeout: 60_000,
        allowCredentials: [{ type: "public-key", id: unb64(credentialId) }],
        extensions: { prf: { eval: { first: salt } } },
      },
    })
  } catch (e) { throw failed(e) }
  const first = cred && prfOf(cred as PublicKeyCredential)?.results?.first
  if (!first) throw new BiometricUnsupportedError()
  return bytes(first)
}

/**
 * Creates a passkey for this account on this device and stores the vault key wrapped by its PRF
 * secret. Usually one biometric prompt. Some authenticators only report PRF support at creation
 * and hand out the secret on the next assertion; that is asked for at once, and if the browser
 * refuses (Safari wants a fresh tap for it) the passkey is kept as pending and the next call
 * finishes with that assertion alone.
 */
export async function enrollBiometric(email: string, vaultKey: CryptoKey) {
  const user = normalizeEmail(email)
  const pending = pendingFor(email)
  if (pending) {
    const secret = await prfSecret(pending.credentialId, unb64(pending.salt))
    remember({ email: user, credentialId: pending.credentialId, salt: pending.salt, wrapped: await wrapForDevice(vaultKey, secret) })
    localStorage.removeItem(PENDING)
    return
  }
  const salt = random(32)
  let cred: Credential | null
  try {
    cred = await navigator.credentials.create({
      publicKey: {
        rp: { name: "ตู้เซฟ", id: location.hostname },
        // The same user id per account lets the authenticator replace an earlier passkey instead of adding one.
        user: { id: new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`tuseif passkey|${user}`))), name: user, displayName: user },
        challenge: random(32), timeout: 60_000,
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
        extensions: { prf: { eval: { first: salt } } },
      },
    })
  } catch (e) { throw failed(e) }
  if (!cred) throw new BiometricUnsupportedError()
  const pk = cred as PublicKeyCredential
  const prf = prfOf(pk)
  if (!prf?.enabled) throw new BiometricUnsupportedError()
  const credentialId = b64(pk.rawId)
  const first = prf.results?.first
  let secret: ArrayBuffer
  if (first) secret = bytes(first)
  else {
    try { secret = await prfSecret(credentialId, salt) } catch (e) {
      if (!(e instanceof BiometricCancelledError)) throw e
      localStorage.setItem(PENDING, JSON.stringify({ email: user, credentialId, salt: b64(salt) } satisfies Pending))
      throw new BiometricPendingError()
    }
  }
  remember({ email: user, credentialId, salt: b64(salt), wrapped: await wrapForDevice(vaultKey, secret) })
}

/** One biometric prompt, then the vault key. Throws if nothing is enrolled here or the prompt fails. */
export async function unlockBiometric(email: string) {
  const r = biometricRecord(email)
  if (!r) throw new Error("ยังไม่ได้เปิดใช้ Passkey บนอุปกรณ์นี้")
  return unwrapFromDevice(r.wrapped, await prfSecret(r.credentialId, unb64(r.salt)))
}
