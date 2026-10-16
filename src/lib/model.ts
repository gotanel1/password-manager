import { strength } from "./password"

export type ItemType = "login" | "card" | "note" | "identity" | "wifi" | "bank"

export type Item = {
  id: string
  type: ItemType
  title: string
  /** Type-specific values keyed by FieldDef.key (username, password, url, totp, cardNumber, …). */
  fields: Record<string, string>
  notes: string
  folder: string
  tags: string[]
  favorite: boolean
  history: { password: string; changed: number }[]
  created: number
  updated: number
  passwordChanged?: number
  deleted?: number
}

export type VaultData = {
  v: 2
  items: Item[]
  folders: string[]
  generatorHistory: { value: string; at: number }[]
}

export type FieldDef = { key: string; label: string; secret?: boolean; mono?: boolean; link?: boolean; multiline?: boolean; placeholder?: string }

export const TYPES: Record<ItemType, { label: string; hint: string; fields: FieldDef[]; subtitle: string }> = {
  login: {
    label: "ข้อมูลเข้าสู่ระบบ", hint: "เว็บไซต์และแอป", subtitle: "username",
    fields: [
      { key: "username", label: "ชื่อผู้ใช้" },
      { key: "password", label: "รหัสผ่าน", secret: true, mono: true },
      { key: "url", label: "เว็บไซต์", link: true, placeholder: "https://" },
      { key: "totp", label: "คีย์ 2FA (TOTP)", secret: true, mono: true, placeholder: "คีย์ base32 หรือ otpauth://" },
    ],
  },
  card: {
    label: "บัตรเครดิต", hint: "บัตรชำระเงิน", subtitle: "cardNumber",
    fields: [
      { key: "cardHolder", label: "ชื่อผู้ถือบัตร" },
      { key: "cardNumber", label: "หมายเลขบัตร", secret: true, mono: true },
      { key: "expiry", label: "วันหมดอายุ", mono: true, placeholder: "MM/YY" },
      { key: "cvv", label: "CVV", secret: true, mono: true },
    ],
  },
  note: { label: "บันทึกปลอดภัย", hint: "ข้อมูลลับทั่วไป", subtitle: "", fields: [] },
  identity: {
    label: "ข้อมูลส่วนตัว", hint: "ที่อยู่และข้อมูลติดต่อ", subtitle: "email",
    fields: [
      { key: "fullName", label: "ชื่อ-นามสกุล" },
      { key: "email", label: "อีเมล" },
      { key: "phone", label: "โทรศัพท์", mono: true },
      { key: "address", label: "ที่อยู่", multiline: true },
    ],
  },
  wifi: {
    label: "Wi-Fi", hint: "ชื่อและรหัสผ่านเครือข่าย", subtitle: "ssid",
    fields: [
      { key: "ssid", label: "ชื่อเครือข่าย (SSID)" },
      { key: "password", label: "รหัสผ่าน", secret: true, mono: true },
      { key: "security", label: "ความปลอดภัย", placeholder: "WPA2 / WPA3" },
    ],
  },
  bank: {
    label: "บัญชีธนาคาร", hint: "ข้อมูลทางการเงิน", subtitle: "accountNumber",
    fields: [
      { key: "bankName", label: "ธนาคาร" },
      { key: "accountName", label: "ชื่อบัญชี" },
      { key: "accountNumber", label: "เลขที่บัญชี", secret: true, mono: true },
      { key: "pin", label: "PIN", secret: true, mono: true },
    ],
  },
}

export const emptyVault = (): VaultData => ({ v: 2, items: [], folders: ["งาน", "ส่วนตัว", "การเงิน"], generatorHistory: [] })

/** v1 vaults were a flat array of {id,title,user,pass,url,notes,created,updated}. */
export function migrate(data: unknown): VaultData {
  if (Array.isArray(data)) {
    if (!data.every((e) => record(e) && ["id", "title", "user", "pass", "url", "notes"].every((k) => e[k] == null || typeof e[k] === "string") && ["created", "updated"].every((k) => e[k] == null || finite(e[k])))) throw new Error("ข้อมูลตู้เซฟเก่าไม่ถูกต้อง")
    const v = emptyVault()
    v.items = data.map((e: Record<string, any>) => ({
      id: String(e.id ?? crypto.randomUUID()),
      type: "login",
      title: String(e.title ?? "ไม่มีชื่อ"),
      fields: { username: e.user ?? "", password: e.pass ?? "", url: e.url ?? "", totp: "" },
      notes: e.notes ?? "",
      folder: "",
      tags: [],
      favorite: false,
      history: [],
      created: e.created ?? Date.now(),
      updated: e.updated ?? Date.now(),
      passwordChanged: e.updated ?? e.created,
    }))
    if (new Set(v.items.map((i) => i.id)).size !== v.items.length) throw new Error("รายการในตู้เซฟมีรหัสซ้ำ")
    return v
  }
  if (!record(data) || data.v !== 2 || !Array.isArray(data.items) || !data.items.every(validItem) || !strings(data.folders)
    || (data.generatorHistory !== undefined && (!Array.isArray(data.generatorHistory) || !data.generatorHistory.every((h) => record(h) && typeof h.value === "string" && finite(h.at))))) {
    throw new Error("ข้อมูลตู้เซฟไม่ถูกต้องหรือไม่รองรับ")
  }
  const v = data as VaultData
  if (new Set(v.items.map((i) => i.id)).size !== v.items.length) throw new Error("รายการในตู้เซฟมีรหัสซ้ำ")
  return { ...emptyVault(), ...v, generatorHistory: v.generatorHistory ?? [] }
}

const record = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === "string")
function validItem(i: unknown): i is Item {
  return record(i) && typeof i.id === "string" && !!i.id && Object.hasOwn(TYPES, i.type)
    && ["title", "notes", "folder"].every((k) => typeof i[k] === "string")
    && record(i.fields) && Object.values(i.fields).every((v) => typeof v === "string")
    && strings(i.tags) && typeof i.favorite === "boolean" && finite(i.created) && finite(i.updated)
    && (i.deleted === undefined || finite(i.deleted)) && (i.passwordChanged === undefined || finite(i.passwordChanged))
    && Array.isArray(i.history) && i.history.every((h) => record(h) && typeof h.password === "string" && finite(h.changed))
}

export function newItem(type: ItemType): Item {
  const now = Date.now()
  return {
    id: crypto.randomUUID(), type, title: "", notes: "", folder: "", tags: [], favorite: false, history: [],
    fields: Object.fromEntries(TYPES[type].fields.map((f) => [f.key, ""])), created: now, updated: now,
  }
}

/** Applies an edit, keeping a history of previous passwords. */
export function applyEdit(prev: Item | undefined, next: Item): Item {
  const now = Date.now()
  const out = { ...next, updated: now }
  const oldPw = prev?.fields.password ?? ""
  const newPw = next.fields.password ?? ""
  if (!prev) out.passwordChanged = newPw ? now : undefined
  else if (oldPw !== newPw) {
    out.passwordChanged = now
    if (oldPw) out.history = [{ password: oldPw, changed: prev.passwordChanged ?? prev.updated }, ...prev.history].slice(0, 20)
  }
  return out
}

// ---------- display helpers ----------
const PALETTE = ["#EA4335", "#4E2A84", "#24292F", "#EE4D2D", "#06C755", "#1877F2", "#2F6FED", "#16825D", "#A15C04", "#C2185B"]
export function iconFor(item: Item) {
  const t = item.title.trim()
  const letters = t ? (/^[a-z0-9]/i.test(t) ? t.replace(/[^a-z0-9]/gi, "").slice(0, 2) : t.slice(0, 1)) : "?"
  let h = 0
  for (const c of item.title) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return { text: letters.length === 2 && /[a-z]/.test(letters[1]) ? letters[0].toUpperCase() : letters.toUpperCase(), color: PALETTE[h % PALETTE.length] }
}

export function domainOf(url: string) {
  if (!url) return ""
  try { return new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "") } catch { return url }
}

export const maskTail = (v: string) => (v.length > 4 ? `•••• ${v.slice(-4)}` : v)

export function subtitleOf(item: Item) {
  const key = TYPES[item.type].subtitle
  if (!key) return item.notes.split("\n")[0].slice(0, 60)
  const v = item.fields[key] ?? ""
  return TYPES[item.type].fields.find((f) => f.key === key)?.secret ? maskTail(v) : v
}

export const headlineOf = (item: Item) =>
  item.type === "login" ? domainOf(item.fields.url) : TYPES[item.type].label

const TH = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" })
const TH_TIME = new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit" })
export function thaiDate(ts: number) {
  const d = new Date(ts)
  if (d.toDateString() === new Date().toDateString()) return `วันนี้ เวลา ${TH_TIME.format(d)}`
  return TH.format(d)
}
export function ago(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return "เมื่อสักครู่"
  if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`
  if (s < 86400) return `${Math.floor(s / 3600)} ชั่วโมงที่แล้ว`
  return thaiDate(ts)
}

// ---------- security analysis ----------
export type Issue = "weak" | "reused" | "old" | "no2fa"
const YEAR = 365 * 24 * 3600 * 1000

export function analyze(items: Item[]) {
  const live = items.filter((i) => !i.deleted)
  const withPw = live.filter((i) => i.fields.password)
  const counts = new Map<string, number>()
  for (const i of withPw) counts.set(i.fields.password, (counts.get(i.fields.password) ?? 0) + 1)
  const issues = new Map<string, Set<Issue>>()
  const add = (id: string, k: Issue) => (issues.get(id) ?? issues.set(id, new Set()).get(id)!).add(k)
  for (const i of withPw) {
    if (strength(i.fields.password).level < 3) add(i.id, "weak")
    if ((counts.get(i.fields.password) ?? 0) > 1) add(i.id, "reused")
    if (Date.now() - (i.passwordChanged ?? i.created) > YEAR) add(i.id, "old")
  }
  for (const i of live) if (i.type === "login" && i.fields.password && !i.fields.totp) add(i.id, "no2fa")
  const count = (k: Issue) => [...issues.values()].filter((s) => s.has(k)).length
  const totals = { weak: count("weak"), reused: count("reused"), old: count("old"), no2fa: count("no2fa") }
  const penalty = withPw.length
    ? (totals.weak * 1 + totals.reused * 0.8 + totals.old * 0.3 + totals.no2fa * 0.15) / withPw.length
    : 0
  const score = Math.max(0, Math.round(100 - penalty * 60))
  return { issues, totals, score, checked: withPw.length }
}

/** The single most important warning for list rows and the detail banner. */
export function primaryWarning(set?: Set<Issue>): "weak" | "reused" | undefined {
  if (set?.has("weak")) return "weak"
  if (set?.has("reused")) return "reused"
}
