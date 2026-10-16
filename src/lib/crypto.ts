// Client-side vault encryption. The server only ever stores the sealed envelope.
export const ITER = 600_000

export type Envelope = { v: 1; kdf: "PBKDF2-SHA256"; iter: number; salt: string; iv: string; ct: string }
export type Key = { key: CryptoKey; salt: Uint8Array<ArrayBuffer> }

const enc = new TextEncoder()
const dec = new TextDecoder()

export const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = new Uint8Array(buf)
  let binary = ""
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iter = ITER): Promise<Key> {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"])
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
  return { key, salt }
}

export const newKey = (password: string) => deriveKey(password, crypto.getRandomValues(new Uint8Array(16)))

export async function seal({ key, salt }: Key, data: unknown): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(data)))
  return { v: 1, kdf: "PBKDF2-SHA256", iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) }
}

/** Throws if the password is wrong (AES-GCM authentication fails). */
export async function unseal(blob: Envelope, password: string): Promise<{ key: Key; data: unknown }> {
  if (!isEnvelope(blob)) throw new Error("รูปแบบไฟล์เข้ารหัสไม่ถูกต้องหรือไม่รองรับ")
  const key = await deriveKey(password, unb64(blob.salt), blob.iter)
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, key.key, unb64(blob.ct))
  return { key, data: JSON.parse(dec.decode(pt)) }
}

export function isEnvelope(x: unknown): x is Envelope {
  if (!x || typeof x !== "object") return false
  const v = x as Record<string, unknown>
  if (v.v !== 1 || v.kdf !== "PBKDF2-SHA256" || v.iter !== ITER) return false
  if (!["ct", "iv", "salt"].every((k) => typeof v[k] === "string")) return false
  try {
    return unb64(v.salt as string).length === 16 && unb64(v.iv as string).length === 12 && unb64(v.ct as string).length >= 16
  } catch { return false }
}
