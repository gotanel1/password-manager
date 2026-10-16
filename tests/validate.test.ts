import { describe, expect, it } from "vitest"
import { newItem } from "../src/lib/model"
import { checkExpiry, isValidUrl, itemWarnings, luhn, parseTags, validateFolderName, validateItem } from "../src/lib/validate"

const withFields = (type: Parameters<typeof newItem>[0], fields: Record<string, string>, extra: Partial<ReturnType<typeof newItem>> = {}) => {
  const i = newItem(type)
  return { ...i, title: "Test", ...extra, fields: { ...i.fields, ...fields } }
}

describe("validateItem", () => {
  it("requires a trimmed title within the length limit", () => {
    expect(validateItem(withFields("login", {}, { title: "   " }), "").title).toBeTruthy()
    expect(validateItem(withFields("login", {}, { title: "x".repeat(101) }), "").title).toMatch(/100/)
    expect(validateItem(withFields("login", {}), "")).toEqual({})
  })

  it("skips empty optional fields and checks filled ones", () => {
    expect(validateItem(withFields("login", { url: "", totp: "" }), "")).toEqual({})
    const e = validateItem(withFields("login", { url: "not a url", totp: "hello!" }), "")
    expect(Object.keys(e).sort()).toEqual(["totp", "url"])
    expect(validateItem(withFields("login", { url: "github.com", totp: "JBSWY3DPEHPK3PXP" }), "")).toEqual({})
  })

  it("validates card number with Luhn, expiry format and CVV", () => {
    expect(validateItem(withFields("card", { cardNumber: "4111 1111 1111 1111", expiry: "08/29", cvv: "123" }), "")).toEqual({})
    const e = validateItem(withFields("card", { cardNumber: "4111 1111 1111 1112", expiry: "13/29", cvv: "12" }), "")
    expect(Object.keys(e).sort()).toEqual(["cardNumber", "cvv", "expiry"])
    expect(validateItem(withFields("card", { cardNumber: "4111-abcd" }), "").cardNumber).toMatch(/ตัวเลข/)
  })

  it("checks identity, bank and Wi-Fi formats", () => {
    expect(validateItem(withFields("identity", { email: "a@b", phone: "12" }), "")).toMatchObject({ email: expect.any(String), phone: expect.any(String) })
    expect(validateItem(withFields("identity", { email: "a@b.co", phone: "+66 81-234-5678" }), "")).toEqual({})
    expect(validateItem(withFields("bank", { accountNumber: "123-4-56789-0", pin: "12ab" }), "")).toEqual({ pin: expect.any(String) })
    expect(validateItem(withFields("wifi", { password: "short" }), "").password).toMatch(/8–63/)
    expect(validateItem(withFields("wifi", { password: "" }), "")).toEqual({})
    expect(validateItem(withFields("wifi", { ssid: "ก".repeat(11) }), "").ssid).toBeTruthy() // 33 bytes in UTF-8
  })

  it("requires content for secure notes and limits tags", () => {
    expect(validateItem(withFields("note", {}), "").notes).toBeTruthy()
    expect(validateItem(withFields("login", {}), Array.from({ length: 21 }, (_, i) => `t${i}`).join(",")).tags).toMatch(/20/)
    expect(validateItem(withFields("login", {}), "x".repeat(31)).tags).toMatch(/30/)
  })
})

describe("helpers", () => {
  it("implements Luhn", () => {
    expect(luhn("4111111111111111")).toBe(true)
    expect(luhn("4111111111111112")).toBe(false)
  })
  it("accepts URLs with or without a scheme", () => {
    expect(isValidUrl("https://mail.google.com/x")).toBe(true)
    expect(isValidUrl("scb.co.th")).toBe(true)
    expect(isValidUrl("javascript:alert(1)")).toBe(false)
    expect(isValidUrl("hello")).toBe(false)
  })
  it("treats a card as valid through its expiry month", () => {
    const now = new Date(2026, 9, 16) // October 2026
    expect(checkExpiry("10/26", now)).toBe("ok")
    expect(checkExpiry("09/26", now)).toBe("expired")
    expect(checkExpiry("1/2030", now)).toBe("ok")
    expect(checkExpiry("0/30", now)).toBe("invalid")
    expect(itemWarnings(withFields("card", { expiry: "01/20" })).expiry).toBeTruthy()
  })
  it("dedupes tags and strips #", () => {
    expect(parseTags(" #งาน, งาน ,dev,, ")).toEqual(["งาน", "dev"])
  })
  it("validates folder names case-insensitively", () => {
    expect(validateFolderName("  ", [])).toBeTruthy()
    expect(validateFolderName("Work", ["work"])).toMatch(/มีโฟลเดอร์/)
    expect(validateFolderName("x".repeat(41), [])).toMatch(/40/)
    expect(validateFolderName("ครอบครัว", ["งาน"])).toBeNull()
  })
})
