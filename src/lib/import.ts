import { newItem, type Item, type VaultData } from "./model"
import { parseTotp } from "./totp"

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
const MAX_ROWS = 10_000
export type CsvImport = { source: "Chrome / CSV" | "Bitwarden CSV"; items: Item[] }

/** Strict CSV reader: quoted commas, escaped quotes, CRLF and multiline values. */
function rows(text: string): string[][] {
  const out: string[][] = []
  let row: string[] = [], field = "", quoted = false, closed = false
  const cell = () => { row.push(field); field = ""; closed = false }
  const line = () => {
    cell()
    if (row.some((v) => v !== "")) out.push(row)
    if (out.length > MAX_ROWS + 1) throw new Error("ไฟล์ต้องมีไม่เกิน 10,000 รายการ")
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else { quoted = false; closed = true }
      } else field += c
    } else if (c === ",") cell()
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++
      line()
    } else if (c === '"' && field === "" && !closed) quoted = true
    else {
      if (closed || c === '"') throw new Error("รูปแบบ CSV ไม่ถูกต้อง กรุณาส่งออกไฟล์ใหม่")
      field += c
    }
  }
  if (quoted) throw new Error("รูปแบบ CSV ไม่ถูกต้อง มีเครื่องหมายคำพูดที่ไม่ปิด")
  line()
  return out
}

export function parsePasswordCsv(text: string): CsvImport {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw new Error("ไฟล์ต้องมีขนาดไม่เกิน 5 MB")
  const [header, ...records] = rows(text.replace(/^\uFEFF/, ""))
  if (!header || !records.length) throw new Error("ไฟล์ไม่มีรายการให้นำเข้า")
  const columns = header.map((v) => v.trim().toLowerCase())
  if (columns.some((v) => !v) || new Set(columns).size !== columns.length) throw new Error("ชื่อคอลัมน์ CSV ว่างหรือซ้ำกัน")
  const bitwarden = columns.includes("login_username") || columns.includes("login_password")
  const required = bitwarden ? ["type", "name", "login_uri", "login_username", "login_password"] : ["url", "username", "password"]
  if (!required.every((v) => columns.includes(v))) throw new Error("ไม่รองรับคอลัมน์นี้ กรุณาใช้ CSV จาก Chrome หรือ Bitwarden")
  const known = new Set(bitwarden
    ? ["type", "name", "folder", "favorite", "notes", "login_uri", "login_username", "login_password", "login_totp"]
    : ["name", "url", "username", "password", "note", "notes"])
  const items = records.map((record, index) => {
    if (record.length !== columns.length) throw new Error(`จำนวนคอลัมน์ไม่ตรงกันที่รายการ ${index + 1}`)
    const get = (key: string) => record[columns.indexOf(key)] ?? ""
    const type = bitwarden ? get("type") : "login"
    if (type !== "login" && type !== "note") throw new Error(`ไม่รองรับประเภทข้อมูลที่รายการ ${index + 1} (รองรับ login และ note)`)
    const item = newItem(type)
    item.title = get("name") || get(bitwarden ? "login_uri" : "url") || "ไม่มีชื่อ"
    const totp = type === "login" && bitwarden ? get("login_totp") : ""
    // A key this app cannot read (e.g. steam://) would block saving the item later, so it goes to the notes.
    const badTotp = totp && !parseTotp(totp) ? totp : ""
    if (type === "login") item.fields = {
      username: get(bitwarden ? "login_username" : "username"),
      password: get(bitwarden ? "login_password" : "password"),
      url: get(bitwarden ? "login_uri" : "url"),
      totp: badTotp ? "" : totp,
    }
    item.notes = [get("note"), get("notes"), ...columns.flatMap((key, i) => !known.has(key) && record[i] ? [`${header[i]}: ${record[i]}`] : []),
      badTotp && `login_totp: ${badTotp}`].filter(Boolean).join("\n")
    item.folder = bitwarden ? get("folder") : ""
    item.favorite = bitwarden && get("favorite") === "1"
    if (item.fields.password) item.passwordChanged = item.created
    return item
  })
  return { source: bitwarden ? "Bitwarden CSV" : "Chrome / CSV", items }
}

// Match exact contents, ignoring IDs, timestamps and password history. Never overwrite entries.
const signature = (item: Item) => JSON.stringify([
  item.type, item.title, Object.entries(item.fields).sort(([a], [b]) => a.localeCompare(b)),
  item.notes, item.folder, item.favorite, [...item.tags].sort(),
])

export function planCsvImport(data: VaultData, incoming: Item[]) {
  const seen = new Set(data.items.filter((i) => !i.deleted).map(signature))
  const added: Item[] = []
  let duplicates = 0
  for (const item of incoming) {
    const key = signature(item)
    if (seen.has(key)) duplicates++
    else { seen.add(key); added.push(item) }
  }
  return { added, duplicates }
}

/** Recheck duplicates inside the serialized save operation against the latest vault. */
export function mergeCsvImport(data: VaultData, incoming: Item[]): VaultData {
  const { added } = planCsvImport(data, incoming)
  return { ...data, items: [...data.items, ...added], folders: [...new Set([...data.folders, ...added.map((i) => i.folder).filter(Boolean)])] }
}
