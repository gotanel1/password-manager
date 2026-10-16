import { describe, expect, it } from "vitest"
import { applyMask, formatCardNumber, formatExpiry } from "../src/lib/masks"
import { validateItem } from "../src/lib/validate"
import { newItem } from "../src/lib/model"

/** Simulates typing one character at a time through the mask. */
const type = (key: string, chars: string) => [...chars].reduce((prev, c) => applyMask(key, prev + c, prev), "")

describe("card number", () => {
  it("groups by 4 and drops non-digits", () => {
    expect(formatCardNumber("4242424242424242")).toBe("4242 4242 4242 4242")
    expect(formatCardNumber("4242-4242 abc 4242")).toBe("4242 4242 4242")
    expect(type("cardNumber", "42424242424242429999")).toBe("4242 4242 4242 4242 999") // capped at 19 digits
  })
  it("uses 4-6-5 for American Express", () => {
    expect(formatCardNumber("378282246310005")).toBe("3782 822463 10005")
  })
  it("still passes validation once formatted", () => {
    const i = newItem("card")
    expect(validateItem({ ...i, title: "x", fields: { ...i.fields, cardNumber: formatCardNumber("4242424242424242") } }, "")).toEqual({})
  })
})

describe("expiry", () => {
  it("adds the slash while typing", () => {
    expect(type("expiry", "0829")).toBe("08/29")
    expect(type("expiry", "1231")).toBe("12/31")
  })
  it("pads single-digit months", () => {
    expect(type("expiry", "429")).toBe("04/29")
  })
  it("never produces an impossible month", () => {
    expect(type("expiry", "3029")).toBe("03/02") // "3" → "03/", then 0, 2; the trailing 9 exceeds MM/YY
    expect(formatExpiry("3029", "")).toBe("03/02") // pasted or typed in one burst behaves the same
    expect(formatExpiry("1229", "")).toBe("12/29")
    expect(type("expiry", "1329")).toBe("12/9") // "13" is rejected, so typing continues from "1"
    expect(type("expiry", "00")).toBe("0")
  })
  it("lets backspace remove the slash", () => {
    expect(formatExpiry("08", "08/")).toBe("08")
    expect(formatExpiry("08/", "08/2")).toBe("08/") // deleting the year digit keeps the slash
    expect(formatExpiry("0", "08")).toBe("0")
  })
})

describe("digit-only fields", () => {
  it("strips letters from a burst without losing later digits", () => {
    expect(applyMask("cvv", "12a345", "")).toBe("1234")
  })
  it("limits CVV and PIN", () => {
    expect(type("cvv", "12a345")).toBe("1234")
    expect(type("pin", "1234567890123")).toBe("123456789012")
  })
  it("keeps account numbers to digits and single dashes", () => {
    expect(applyMask("accountNumber", "123--4 56a7", "")).toBe("123-4567")
  })
  it("leaves unmasked fields alone", () => {
    expect(applyMask("username", "Some Name!", "")).toBe("Some Name!")
  })
})
