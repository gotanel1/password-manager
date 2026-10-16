import { describe, expect, it, vi } from "vitest"
import { MAX_IMPORT_BYTES, mergeCsvImport, parsePasswordCsv, planCsvImport } from "../src/lib/import"
import { emptyVault, migrate } from "../src/lib/model"
import { deriveForEmail, headerOf, newHeader, newVaultKey, openV2, sealV2 } from "../src/lib/keys"
import { VaultSession } from "../src/lib/session"

const chrome = 'name,url,username,password,note\r\nExample,https://example.invalid,user,test-only-secret,note'
const bwHeader = "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp"

describe("CSV import", () => {
  it("reads Chrome fields, BOM, multiline notes, quoted commas and escaped quotes without trimming secrets", () => {
    const parsed = parsePasswordCsv('\uFEFFname,url,username,password,note\r\n"Thai ไทย, name",https://example.invalid," user "," a,""b"" ","line 1\r\nline 2"\r\n')
    expect(parsed.source).toBe("Chrome / CSV")
    expect(parsed.items[0]).toMatchObject({ title: "Thai ไทย, name", fields: { username: " user ", password: ' a,"b" ', url: "https://example.invalid", totp: "" }, notes: "line 1\r\nline 2" })
    expect(migrate(mergeCsvImport(emptyVault(), parsed.items)).items).toHaveLength(1)
  })
  it("preserves Bitwarden folders, favorites, TOTP, notes and custom columns", () => {
    const parsed = parsePasswordCsv(`${bwHeader}\nWork,1,login,Example,memo,custom: value,1,https://example.invalid,user,pw,ABCDEF\n,,note,Private,memo,,,,,,`)
    expect(parsed.items[0]).toMatchObject({ folder: "Work", favorite: true, fields: { totp: "ABCDEF" }, notes: "memo\nfields: custom: value\nreprompt: 1" })
    expect(parsed.items[1]).toMatchObject({ type: "note", title: "Private", notes: "memo", fields: {} })
    expect(mergeCsvImport(emptyVault(), parsed.items).folders).toContain("Work")
  })
  it.each([
    "", "name,url,username,password", "name,url,username,password\n\"unclosed",
    "name,url,username,password\na,b,c", "name,url,username,password\na,b,c,d,e",
    'name,url,username,password\n"a"bad,b,c,d', 'name,url,username,password\na,b,c,d"',
    "name,url,username,password,password\na,b,c,d,e", "name,,username,password\na,b,c,d",
    "title,user,pass\na,b,c", `${bwHeader}\n,,card,Card,,,,,,,`,
  ])("rejects malformed or unsupported files without returning partial data", (text) => {
    expect(() => parsePasswordCsv(text)).toThrow()
  })
  it("bounds file size and number of rows", () => {
    expect(() => parsePasswordCsv("x".repeat(MAX_IMPORT_BYTES + 1))).toThrow("5 MB")
    expect(() => parsePasswordCsv("url,username,password\n" + "a,b,c\n".repeat(10_001))).toThrow("10,000")
  })
  it("deduplicates exact contents within the file and against the latest live vault", () => {
    const incoming = parsePasswordCsv(chrome).items
    const data = mergeCsvImport(emptyVault(), [...incoming, ...incoming])
    expect(data.items).toHaveLength(1)
    // A second parse has a different ID, but still matches existing contents.
    expect(planCsvImport(data, parsePasswordCsv(chrome).items)).toMatchObject({ added: [], duplicates: 1 })
    const changed = parsePasswordCsv(chrome.replace("test-only-secret", "changed-test-secret")).items
    expect(planCsvImport(data, changed).added).toHaveLength(1)
    expect(mergeCsvImport(data, changed).items[0]).toEqual(data.items[0])
    expect(planCsvImport({ ...data, items: data.items.map((i) => ({ ...i, deleted: 1 })) }, incoming).added).toHaveLength(1)
  })
  it("saves imported content through encryption and preserves existing data on a failed save", async () => {
    const key = await newVaultKey()
    const master = await deriveForEmail("Test-only-Master!2026", "test@example.invalid")
    const header = await newHeader(key, master, "ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ2")
    const data = emptyVault()
    const blob = await sealV2(header, key, data)
    const save = vi.fn(async (_previous, next) => ({ blob: next, version: 2 }))
    const session = new VaultSession(key, headerOf(blob), data, { blob, version: 1 }, save)
    const incoming = parsePasswordCsv(chrome).items
    await session.update((latest) => mergeCsvImport(latest, incoming))
    const stored = save.mock.calls[0][1]
    expect(JSON.stringify(stored)).not.toContain("test-only-secret")
    expect(await openV2(stored, key)).toMatchObject({ items: [{ fields: { password: "test-only-secret" } }] })
    save.mockRejectedValueOnce(new Error("offline"))
    const before = session.data
    await expect(session.update((latest) => mergeCsvImport(latest, parsePasswordCsv(chrome.replace("Example,", "Other,")).items))).rejects.toThrow("offline")
    expect(session.data).toBe(before)
  })
})
