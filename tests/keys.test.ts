import { describe, expect, it } from "vitest"
import { b64, unb64 } from "../src/lib/crypto"
import {
  deriveForEmail, emailSalt, headerOf, isEnvelopeV2, newHeader, newRecoveryCode, newVaultKey, normalizeRecoveryCode, openV2,
  recoveryWrapKey, sealV2, unlockWithMaster, unwrap, wrap,
} from "../src/lib/keys"
import { emptyVault } from "../src/lib/model"

const password = "Only-test!Master-2026"
const email = "Test@Example.invalid"

describe("single-password key derivation", () => {
  it("is deterministic per email and password, case-insensitive on email", async () => {
    const a = await deriveForEmail(password, email)
    const b = await deriveForEmail(password, " test@example.INVALID ")
    expect(a.login).toBe(b.login)
    expect((await deriveForEmail(password, "other@example.invalid")).login).not.toBe(a.login)
    expect((await deriveForEmail(password + "x", email)).login).not.toBe(a.login)
  })

  it("produces a login secret that reveals neither the password nor the wrapping key", async () => {
    const m = await deriveForEmail(password, email)
    expect(m.login).not.toContain(password)
    expect(m.login).toMatch(/^tz2!/)
    expect(m.login.length).toBeLessThanOrEqual(72) // bcrypt limit used by Supabase Auth
    expect(/[a-z]/.test(m.login) && /[A-Z]/.test(m.login) && /\d/.test(m.login) && /[^a-zA-Z\d]/.test(m.login)).toBe(true)
    // The wrapping key is a separate, non-extractable key.
    expect(m.wrap.extractable).toBe(false)
  })

  it("uses a 32-byte email salt", async () => {
    expect((await emailSalt(email)).length).toBe(32)
  })
})

describe("vault key wrapping", () => {
  it("round trips data through master and recovery slots", async () => {
    const vaultKey = await newVaultKey()
    const master = await deriveForEmail(password, email)
    const code = newRecoveryCode()
    const blob = await sealV2(await newHeader(vaultKey, master, code), vaultKey, emptyVault())
    expect(isEnvelopeV2(blob)).toBe(true)
    expect(JSON.stringify(blob)).not.toContain(password)

    const viaMaster = await unlockWithMaster(blob, await deriveForEmail(password, email))
    expect(await openV2(blob, viaMaster)).toEqual(emptyVault())
    const viaRecovery = await unwrap(blob.keys.recovery!, await recoveryWrapKey(code.toLowerCase().replace(/-/g, " ")))
    expect(await openV2(blob, viaRecovery)).toEqual(emptyVault())
  })

  it("rejects the wrong master password and the wrong recovery code", async () => {
    const vaultKey = await newVaultKey()
    const blob = await sealV2(await newHeader(vaultKey, await deriveForEmail(password, email), newRecoveryCode()), vaultKey, emptyVault())
    await expect(unlockWithMaster(blob, await deriveForEmail("Wrong-test!Master-2026", email))).rejects.toThrow()
    await expect(unwrap(blob.keys.recovery!, await recoveryWrapKey(newRecoveryCode()))).rejects.toThrow()
  })

  it("accepts the previous master slot during a password change", async () => {
    const vaultKey = await newVaultKey()
    const oldM = await deriveForEmail(password, email)
    const newM = await deriveForEmail("New-test!Master-2027", email)
    const header = { ...await newHeader(vaultKey, newM, newRecoveryCode()), keys: { master: await wrap(vaultKey, newM.wrap), masterPrev: await wrap(vaultKey, oldM.wrap) } }
    const blob = await sealV2(header, vaultKey, emptyVault())
    expect(await openV2(blob, await unlockWithMaster(blob, oldM))).toEqual(emptyVault())
    expect(await openV2(blob, await unlockWithMaster(blob, newM))).toEqual(emptyVault())
    expect(headerOf(blob)).not.toHaveProperty("ct")
  })

  it("detects tampering", async () => {
    const vaultKey = await newVaultKey()
    const master = await deriveForEmail(password, email)
    const blob = await sealV2(await newHeader(vaultKey, master, newRecoveryCode()), vaultKey, emptyVault())
    const ct = unb64(blob.ct); ct[0] ^= 1
    await expect(openV2({ ...blob, ct: b64(ct) }, vaultKey)).rejects.toThrow()
  })

  it("validates the envelope shape", async () => {
    const vaultKey = await newVaultKey()
    const blob = await sealV2(await newHeader(vaultKey, await deriveForEmail(password, email), newRecoveryCode()), vaultKey, emptyVault())
    for (const patch of [{ v: 1 }, { iter: 1 }, { salt: b64(new Uint8Array(16)) }, { keys: {} }, { keys: { master: { iv: "AA==", ct: "AA==" } } }]) {
      expect(isEnvelopeV2({ ...blob, ...patch })).toBe(false)
    }
  })
})

describe("recovery code", () => {
  it("is 5 groups of 5 from an unambiguous alphabet and normalizes user input", () => {
    const code = newRecoveryCode()
    expect(code).toMatch(/^([A-HJ-NP-Z2-9]{5}-){4}[A-HJ-NP-Z2-9]{5}$/)
    expect(normalizeRecoveryCode(` ${code.toLowerCase()} `)).toBe(code.replace(/-/g, ""))
    expect(normalizeRecoveryCode("O0I1L-AAAAA-AAAAA-AAAAA-AAAAA")).toBeNull()
    expect(normalizeRecoveryCode("short")).toBeNull()
  })
})
