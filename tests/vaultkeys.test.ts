import { describe, expect, it, vi } from "vitest"
import { newKey, seal } from "../src/lib/crypto"
import { deriveForEmail, isEnvelopeV2, openV2, recoveryWrapKey, sealV2, unlockWithMaster, unwrap, type EnvelopeV2 } from "../src/lib/keys"
import { emptyVault, newItem } from "../src/lib/model"
import { NoRecoveryError, WrongPasswordError, createVault, openVault, recoverVault, upgradeVault } from "../src/lib/vaultkeys"

const email = "test@example.invalid"
const password = "Only-test!Master-2026"
const newPassword = "Recovered-test!Master-2027"
const saver = () => vi.fn(async (remote: { version: number } | null, blob: EnvelopeV2) => ({ blob, version: (remote?.version ?? 0) + 1 }))
const withNote = { ...emptyVault(), items: [{ ...newItem("note"), title: "keep me" }] }

describe("create and open", () => {
  it("creates a v2 vault that opens with the password and rejects a wrong one", async () => {
    const save = saver()
    const c = await createVault(await deriveForEmail(password, email), save)
    expect(save).toHaveBeenCalledWith(null, expect.anything())
    const r = await openVault(c.remote, password)
    expect(r.legacy).toBe(false)
    await expect(openVault(c.remote, "Wrong-test!Master-2026")).rejects.toBeInstanceOf(WrongPasswordError)
  })
  it("reuses keys already derived for sign-in when the salt matches, and derives otherwise", async () => {
    const master = await deriveForEmail(password, email)
    const c = await createVault(master, saver())
    // The password argument is ignored when matching keys are supplied.
    expect((await openVault(c.remote, "not-used", master)).legacy).toBe(false)
    const other = await deriveForEmail(password, "other@example.invalid")
    expect((await openVault(c.remote, password, other)).legacy).toBe(false)
    await expect(openVault(c.remote, "Wrong-test!Master-2026", other)).rejects.toBeInstanceOf(WrongPasswordError)
  })
  it("reports a two-password vault as legacy and upgrades it in one version-checked write", async () => {
    const remote = { blob: await seal(await newKey(password), withNote), version: 7 }
    const r = await openVault(remote, password)
    expect(r).toMatchObject({ legacy: true, data: withNote })
    const save = saver()
    const up = await upgradeVault(r.data, remote, await deriveForEmail(password, email), save)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0]).toBe(remote)
    expect(up.remote.version).toBe(8)
    expect(isEnvelopeV2(up.remote.blob)).toBe(true)
    expect((await openVault(up.remote, password)).data).toEqual(withNote)
  })
})

describe("forgot master password", () => {
  /** A stored v2 vault holding one note, plus its recovery code. */
  async function stored() {
    const c = await createVault(await deriveForEmail(password, email), saver())
    return { remote: { blob: await sealV2(c.header, c.vaultKey, withNote), version: 1 }, code: c.recoveryCode }
  }

  it("re-wraps for a new password and a new code, moving the login before writing", async () => {
    const { remote, code } = await stored()
    const order: string[] = []
    const save = vi.fn(async (r: { version: number } | null, blob: EnvelopeV2) => { order.push("save"); return { blob, version: (r?.version ?? 0) + 1 } })
    const r = await recoverVault(remote, code, newPassword, email, save, async (m) => {
      order.push("login")
      expect(m.login).toBe((await deriveForEmail(newPassword, email)).login)
    })
    expect(order).toEqual(["login", "save"])
    expect(r.recoveryCode).not.toBe(code)
    const blob = r.remote.blob as EnvelopeV2
    expect(await openV2(blob, await unlockWithMaster(blob, await deriveForEmail(newPassword, email)))).toEqual(withNote)
    await expect(unlockWithMaster(blob, await deriveForEmail(password, email))).rejects.toThrow()
    await expect(unwrap(blob.keys.recovery!, await recoveryWrapKey(code))).rejects.toThrow() // used code retired
    expect(await openV2(blob, await unwrap(blob.keys.recovery!, await recoveryWrapKey(r.recoveryCode)))).toEqual(withNote)
  })

  it("rejects a wrong code without touching the login or the vault", async () => {
    const { remote } = await stored()
    const save = saver()
    const login = vi.fn(async () => {})
    await expect(recoverVault(remote, "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE", newPassword, email, save, login)).rejects.toThrow(/รหัสกู้คืนไม่ถูกต้อง/)
    expect(login).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it("leaves the vault openable with the same code if the write fails after the login moved", async () => {
    const { remote, code } = await stored()
    const save = vi.fn(async () => { throw new Error("offline") })
    await expect(recoverVault(remote, code, newPassword, email, save, async () => {})).rejects.toThrow("offline")
    // Nothing was written, so the original code still opens the original vault: recovery can be retried.
    expect(await openV2(remote.blob, await unwrap(remote.blob.keys.recovery!, await recoveryWrapKey(code)))).toEqual(withNote)
  })

  it("explains that a two-password vault has no recovery code", async () => {
    const remote = { blob: await seal(await newKey(password), emptyVault()), version: 1 }
    await expect(recoverVault(remote, "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE", newPassword, email, saver(), async () => {})).rejects.toBeInstanceOf(NoRecoveryError)
  })
})
