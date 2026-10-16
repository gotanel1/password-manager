import { describe, expect, it } from "vitest"
import { b64, isEnvelope, newKey, seal, unb64, unseal } from "../src/lib/crypto"
import { analyze, applyEdit, emptyVault, migrate, newItem, TYPES, type ItemType } from "../src/lib/model"
import { applyFilter } from "../src/vault"
import { randomPassword, passphrase, pin } from "../src/lib/password"
import { parseTotp, totpAt } from "../src/lib/totp"

const password = "Only-test!Master-2026"
describe("encrypted backups", () => {
  it("round trips a large Thai vault without overflowing base64 conversion", async () => {
    const data = { ...emptyVault(), items: [{ ...newItem("note"), notes: "ข้อความทดสอบ".repeat(20_000) }] }
    const key = await newKey(password)
    const blob = await seal(key, data)
    expect(JSON.stringify(blob)).not.toContain("ข้อความทดสอบ")
    expect((await unseal(blob, password)).data).toEqual(data)
    expect((await seal(key, data)).iv).not.toBe(blob.iv)
  })
  it("rejects wrong passwords and tampering", async () => {
    const blob = await seal(await newKey(password), emptyVault())
    await expect(unseal(blob, "wrong")).rejects.toThrow()
    const ct = unb64(blob.ct)
    ct[0] ^= 1
    await expect(unseal({ ...blob, ct: b64(ct) }, password)).rejects.toThrow()
  })
  it("rejects invalid/unsupported envelopes before deriving keys", async () => {
    const blob = await seal(await newKey(password), emptyVault())
    for (const patch of [{ v: 9 }, { kdf: "unknown" }, { iter: Infinity }, { iter: 1 }, { iter: 99_999_999 }, { salt: "bad!" }, { iv: "AA==" }, { ct: "AA==" }]) {
      expect(isEnvelope({ ...blob, ...patch })).toBe(false)
    }
    expect(isEnvelope(blob)).toBe(true)
  })
})

describe("vault data compatibility and validation", () => {
  it("reads legacy vaults and current vaults without generator history", () => {
    expect(migrate([{ id: "legacy", title: "old", user: "test", pass: "example" }]).items[0]).toMatchObject({ type: "login", fields: { username: "test", password: "example" } })
    const { generatorHistory: _, ...old } = emptyVault()
    expect(migrate(old).generatorHistory).toEqual([])
    expect(migrate(emptyVault())).toEqual(emptyVault())
  })
  it.each([null, {}, { v: 99 }, [null], { ...emptyVault(), folders: [null] }, { ...emptyVault(), items: [{ ...newItem("login"), fields: { password: 123 } }] }, { ...emptyVault(), items: [{ ...newItem("login"), type: "__proto__" }] }, { ...emptyVault(), generatorHistory: [{ value: "test", at: "yesterday" }] }])("rejects invalid data %#", (value) => {
    expect(() => migrate(value)).toThrow()
  })
  it("rejects duplicate item IDs", () => {
    const item = newItem("note")
    expect(() => migrate({ ...emptyVault(), items: [item, item] })).toThrow()
  })
  it.each(Object.keys(TYPES) as ItemType[])("preserves edits, folders, tags, favorites, trash and restore: %s", (type) => {
    const item = newItem(type)
    const edited = applyEdit(item, { ...item, title: "ทดสอบ", notes: "รายละเอียด", favorite: true, folder: "งาน", tags: ["ทดสอบ"] })
    const vault = migrate({ ...emptyVault(), items: [edited] })
    const issues = analyze(vault.items).issues
    expect(applyFilter(vault.items, `type:${type}`, issues)).toEqual([edited])
    for (const filter of ["folder:งาน", "tag:ทดสอบ", "favorites"]) expect(applyFilter(vault.items, filter, issues)).toEqual([edited])
    const deleted = { ...edited, deleted: Date.now() }
    expect(applyFilter([deleted], "all", issues)).toEqual([])
    expect(applyFilter([deleted], "trash", issues)).toEqual([deleted])
    expect(applyFilter([{ ...deleted, deleted: undefined }], "all", issues)).toHaveLength(1)
  })
  it("records previous passwords and ignores trash in security analysis", () => {
    const item = { ...newItem("login"), fields: { password: "password1234" } }
    expect(applyEdit(item, { ...item, fields: { password: "Different-test!2026" } }).history[0].password).toBe("password1234")
    const second = { ...item, id: "second" }
    expect(analyze([item, second]).totals.reused).toBe(2)
    expect(analyze([{ ...item, deleted: 1 }]).checked).toBe(0)
  })
})

describe("password and TOTP generators", () => {
  it("obeys password options, PIN length and passphrase word count", () => {
    for (let i = 0; i < 20; i++) {
      const value = randomPassword({ length: 24, upper: true, numbers: true, symbols: true, avoidAmbiguous: true })
      expect(value).toHaveLength(24)
      expect(value).toMatch(/[a-z]/)
      expect(value).toMatch(/[A-Z]/)
      expect(value).toMatch(/[2-9]/)
      expect(value).toMatch(/[^a-zA-Z0-9]/)
      expect(value).not.toMatch(/[IlO01]/)
    }
    expect(randomPassword({ length: 18, upper: false, numbers: false, symbols: false, avoidAmbiguous: false })).toMatch(/^[a-z]{18}$/)
    expect(pin(8)).toMatch(/^\d{8}$/)
    expect(passphrase(7).split("-")).toHaveLength(7)
  })
  it("matches published RFC 6238 SHA-1 vectors", async () => {
    const p = parseTotp("otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8")!
    expect(await totpAt(p, 59_000)).toBe("94287082")
    expect(await totpAt(p, 1_111_111_109_000)).toBe("07081804")
  })
  it.each(["A", "bad!", "otpauth://hotp/Test?secret=JBSWY3DP", "otpauth://totp/Test?secret=JBSWY3DP&period=0", "otpauth://totp/Test?secret=JBSWY3DP&digits=999", "otpauth://totp/Test?secret=JBSWY3DP&algorithm=MD5"])("rejects unusable TOTP input: %s", (value) => {
    expect(parseTotp(value)).toBeNull()
  })
})
