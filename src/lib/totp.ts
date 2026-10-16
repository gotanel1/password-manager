// RFC 6238 TOTP, computed locally with WebCrypto. Secrets never leave the vault.
export type TotpParams = { secret: Uint8Array<ArrayBuffer>; digits: number; period: number; algorithm: "SHA-1" | "SHA-256" | "SHA-512" }

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function base32Decode(input: string) {
  const s = input.toUpperCase().replace(/[\s=-]/g, "")
  if (!s || /[^A-Z2-7]/.test(s)) throw new Error("invalid base32")
  const out: number[] = []
  let buf = 0, n = 0
  for (const c of s) {
    buf = (buf << 5) | B32.indexOf(c)
    n += 5
    if (n >= 8) { n -= 8; out.push((buf >> n) & 0xff) }
  }
  return new Uint8Array(out)
}

/** Accepts a raw base32 secret or an otpauth://totp/... URI. Returns null if unusable. */
export function parseTotp(value: string): TotpParams | null {
  const v = value.trim()
  if (!v) return null
  try {
    if (v.startsWith("otpauth://")) {
      const u = new URL(v)
      if (u.host !== "totp") return null
      const alg = (u.searchParams.get("algorithm") ?? "SHA1").toUpperCase().replace("SHA", "SHA-") as TotpParams["algorithm"]
      const secret = base32Decode(u.searchParams.get("secret") ?? "")
      const digits = Number(u.searchParams.get("digits") ?? 6)
      const period = Number(u.searchParams.get("period") ?? 30)
      if (!secret.length || ![6, 8].includes(digits) || !Number.isInteger(period) || period <= 0 || !["SHA-1", "SHA-256", "SHA-512"].includes(alg)) return null
      return { secret, digits, period, algorithm: alg }
    }
    const secret = base32Decode(v)
    return secret.length ? { secret, digits: 6, period: 30, algorithm: "SHA-1" } : null
  } catch {
    return null
  }
}

export async function totpAt(p: TotpParams, time = Date.now()) {
  const counter = Math.floor(time / 1000 / p.period)
  const msg = new ArrayBuffer(8)
  new DataView(msg).setBigUint64(0, BigInt(counter))
  const key = await crypto.subtle.importKey("raw", p.secret, { name: "HMAC", hash: p.algorithm }, false, ["sign"])
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg))
  const o = h[h.length - 1] & 0xf
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(bin % 10 ** p.digits).padStart(p.digits, "0")
}

export const secondsLeft = (p: TotpParams, time = Date.now()) => p.period - (Math.floor(time / 1000) % p.period)
