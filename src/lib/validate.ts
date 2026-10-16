// Form validation for vault items and folders. Pure functions: messages are Thai, keyed by field.
import { TYPES, type Item } from "./model"
import { parseTotp } from "./totp"

export type Errors = Record<string, string>

export const LIMITS = { title: 100, field: 1000, notes: 10_000, tag: 30, tags: 20, folder: 40 }

const digits = (v: string) => v.replace(/[\s-]/g, "")

export function luhn(num: string) {
  let sum = 0
  for (let i = 0; i < num.length; i++) {
    let d = Number(num[num.length - 1 - i])
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9 }
    sum += d
  }
  return sum % 10 === 0
}

export function isValidUrl(v: string) {
  try {
    const u = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(v) ? v : `https://${v}`)
    return (u.protocol === "https:" || u.protocol === "http:") && (u.hostname.includes(".") || u.hostname === "localhost")
  } catch {
    return false
  }
}

/** Returns "expired" for a well-formed date in the past, so callers can warn without blocking. */
export function checkExpiry(v: string, now = new Date()): "ok" | "invalid" | "expired" {
  const m = v.trim().match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/)
  if (!m) return "invalid"
  const month = Number(m[1])
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2])
  if (month < 1 || month > 12) return "invalid"
  // A card is valid through the last day of its expiry month.
  return new Date(year, month, 1) <= now ? "expired" : "ok"
}

/** Per-field checks; empty values are allowed unless the field is required. */
const FIELD_RULES: Record<string, (v: string) => string | null> = {
  url: (v) => (isValidUrl(v) ? null : "รูปแบบเว็บไซต์ไม่ถูกต้อง เช่น https://example.com"),
  totp: (v) => (parseTotp(v) ? null : "คีย์ 2FA ไม่ถูกต้อง ใช้คีย์ base32 หรือลิงก์ otpauth://"),
  cardNumber: (v) => {
    const d = digits(v)
    if (!/^\d+$/.test(d)) return "หมายเลขบัตรต้องเป็นตัวเลขเท่านั้น"
    if (d.length < 12 || d.length > 19) return "หมายเลขบัตรต้องมี 12–19 หลัก"
    return luhn(d) ? null : "หมายเลขบัตรไม่ถูกต้อง กรุณาตรวจอีกครั้ง"
  },
  expiry: (v) => (checkExpiry(v) === "invalid" ? "ใช้รูปแบบ MM/YY เช่น 08/29" : null),
  cvv: (v) => (/^\d{3,4}$/.test(v.trim()) ? null : "CVV ต้องเป็นตัวเลข 3–4 หลัก"),
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : "รูปแบบอีเมลไม่ถูกต้อง"),
  phone: (v) => {
    if (!/^[\d\s+()-]+$/.test(v)) return "เบอร์โทรใช้ได้เฉพาะตัวเลข เว้นวรรค + - ( )"
    const n = v.replace(/\D/g, "").length
    return n >= 9 && n <= 15 ? null : "เบอร์โทรต้องมี 9–15 หลัก"
  },
  accountNumber: (v) => {
    const d = digits(v)
    if (!/^\d+$/.test(d)) return "เลขที่บัญชีต้องเป็นตัวเลขเท่านั้น"
    return d.length >= 6 && d.length <= 20 ? null : "เลขที่บัญชีต้องมี 6–20 หลัก"
  },
  pin: (v) => (/^\d{4,12}$/.test(v.trim()) ? null : "PIN ต้องเป็นตัวเลข 4–12 หลัก"),
  ssid: (v) => (new TextEncoder().encode(v).length <= 32 ? null : "ชื่อเครือข่ายยาวเกิน 32 ไบต์"),
}

export function parseTags(text: string) {
  return [...new Set(text.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean))]
}

export function validateItem(item: Item, tagText: string): Errors {
  const e: Errors = {}
  const title = item.title.trim()
  if (!title) e.title = "กรุณาใส่ชื่อรายการ"
  else if (title.length > LIMITS.title) e.title = `ชื่อรายการยาวได้ไม่เกิน ${LIMITS.title} ตัวอักษร`

  for (const f of TYPES[item.type].fields) {
    const v = item.fields[f.key] ?? ""
    if (!v.trim()) continue
    if (v.length > LIMITS.field) { e[f.key] = `ยาวได้ไม่เกิน ${LIMITS.field} ตัวอักษร`; continue }
    const rule = FIELD_RULES[f.key]
    const msg = rule?.(v)
    if (msg) e[f.key] = msg
  }

  // WPA/WPA2/WPA3 passphrases are 8–63 characters; open networks have none.
  const wifiPw = item.type === "wifi" ? item.fields.password ?? "" : ""
  if (wifiPw && (wifiPw.length < 8 || wifiPw.length > 63)) e.password = "รหัส Wi-Fi ต้องยาว 8–63 ตัวอักษร"

  if (item.type === "note" && !item.notes.trim()) e.notes = "กรุณาใส่เนื้อหาบันทึก"
  if (item.notes.length > LIMITS.notes) e.notes = `บันทึกยาวได้ไม่เกิน ${LIMITS.notes.toLocaleString("th-TH")} ตัวอักษร`

  const tags = parseTags(tagText)
  if (tags.length > LIMITS.tags) e.tags = `ใส่แท็กได้ไม่เกิน ${LIMITS.tags} แท็ก`
  else if (tags.some((t) => t.length > LIMITS.tag)) e.tags = `แต่ละแท็กยาวได้ไม่เกิน ${LIMITS.tag} ตัวอักษร`
  return e
}

/** Non-blocking hints shown under a field. */
export function itemWarnings(item: Item): Errors {
  const w: Errors = {}
  if (item.type === "card" && item.fields.expiry?.trim() && checkExpiry(item.fields.expiry) === "expired") w.expiry = "บัตรนี้หมดอายุแล้ว"
  return w
}

export function validateFolderName(name: string, folders: string[]): string | null {
  const n = name.trim()
  if (!n) return "กรุณาใส่ชื่อโฟลเดอร์"
  if (n.length > LIMITS.folder) return `ชื่อโฟลเดอร์ยาวได้ไม่เกิน ${LIMITS.folder} ตัวอักษร`
  if (folders.some((f) => f.toLocaleLowerCase("th") === n.toLocaleLowerCase("th"))) return "มีโฟลเดอร์ชื่อนี้แล้ว"
  return null
}
