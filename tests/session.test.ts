import { describe, expect, it, vi } from "vitest"
import { deriveForEmail, headerOf, isEnvelopeV2, newHeader, newRecoveryCode, newVaultKey, openV2, recoveryWrapKey, sealV2, unlockWithMaster, unwrap, type EnvelopeV2 } from "../src/lib/keys"
import { emptyVault, newItem } from "../src/lib/model"
import { VaultSession } from "../src/lib/session"
import { ConflictError } from "../src/lib/sync"
import { WrongPasswordError } from "../src/lib/vaultkeys"
import type { Envelope } from "../src/lib/crypto"

const password = "Test-only!Strong-Master-2026"
const newPassword = "New-test!Master-2026"
const email = "test@example.invalid"

async function setup() {
  const vaultKey = await newVaultKey()
  const recoveryCode = newRecoveryCode()
  const header = await newHeader(vaultKey, await deriveForEmail(password, email), recoveryCode)
  const data = emptyVault()
  const remote: { blob: EnvelopeV2 | Envelope; version: number } = { blob: await sealV2(header, vaultKey, data), version: 1 }
  const save = vi.fn(async (previous: typeof remote, blob: EnvelopeV2) => ({ blob: blob as EnvelopeV2 | Envelope, version: previous.version + 1 }))
  return { session: new VaultSession(vaultKey, header, data, remote, save), save, recoveryCode }
}
const add = (title: string) => (data: ReturnType<typeof emptyVault>) => ({ ...data, items: [...data.items, { ...newItem("login"), title }] })
/** Opens a stored envelope the way a fresh unlock would: from the password alone. */
const open = async (blob: unknown, pw: string) => {
  if (!isEnvelopeV2(blob)) throw new Error("not v2")
  return openV2(blob, await unlockWithMaster(blob, await deriveForEmail(pw, email)))
}

describe("vault save lifecycle", () => {
  it("serializes edits against the last committed version", async () => {
    const { session, save } = await setup()
    await Promise.all([session.update(add("one")), session.update(add("two"))])
    const backup = await session.backup()
    expect(save.mock.calls.map(([remote]) => remote.version)).toEqual([1, 2])
    expect(await open(backup, password)).toMatchObject({ items: [{ title: "one" }, { title: "two" }] })
  })
  it("drains admitted edits on close and rejects new work", async () => {
    const { session, save } = await setup()
    const pending = session.update(add("before lock"))
    const closing = session.close()
    await expect(session.update(add("after lock"))).rejects.toThrow()
    await Promise.all([pending, closing])
    expect(save).toHaveBeenCalledTimes(1)
    expect(await open(save.mock.calls[0][1], password)).toMatchObject({ items: [{ title: "before lock" }] })
    await expect(session.backup()).rejects.toThrow()
  })
  it("does not commit or export a stale success after a failed save; a retry recovers", async () => {
    const { session, save } = await setup()
    save.mockRejectedValueOnce(new Error("offline"))
    await expect(session.update(add("one"))).rejects.toThrow("offline")
    await expect(session.backup()).rejects.toThrow("offline")
    expect(session.data.items).toHaveLength(0)
    await session.update(add("one"))
    expect(await open(await session.backup(), password)).toMatchObject({ items: [{ title: "one" }] })
  })
  it("stops queued saves after a version conflict", async () => {
    const { session, save } = await setup()
    save.mockRejectedValueOnce(new ConflictError())
    const results = await Promise.allSettled([session.update(add("one")), session.update(add("two"))])
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"])
    expect(save).toHaveBeenCalledTimes(1)
  })
  it("exports only after all earlier saves finish", async () => {
    const { session } = await setup()
    const pending = session.update(add("latest"))
    const backup = session.backup()
    await pending
    expect(await open(await backup, password)).toMatchObject({ items: [{ title: "latest" }] })
  })
})

/** Two devices unlocked on the same vault, saving to one version-checked server. */
async function twoDevices(data = emptyVault()) {
  const vaultKey = await newVaultKey()
  const header = await newHeader(vaultKey, await deriveForEmail(password, email), newRecoveryCode())
  let server: { blob: EnvelopeV2 | Envelope; version: number } = { blob: await sealV2(header, vaultKey, data), version: 1 }
  const save = vi.fn(async (previous: typeof server, blob: EnvelopeV2) => {
    if (previous.version !== server.version) throw new ConflictError()
    server = { blob, version: server.version + 1 }
    return server
  })
  const load = vi.fn(async () => server)
  const device = () => new VaultSession(vaultKey, header, data, server, save, undefined, undefined, load)
  return { a: device(), b: device(), server: () => server, setServer: (s: typeof server) => { server = s } }
}
const rename = (item: ReturnType<typeof newItem>, title: string) => (d: ReturnType<typeof emptyVault>) =>
  ({ ...d, items: d.items.map((i) => (i.id === item.id ? { ...item, title } : i)) })

describe("saving after another device saved", () => {
  it("applies the edit on top of the newer vault instead of locking", async () => {
    const { a, b, server } = await twoDevices()
    await a.update(add("from A"))
    await b.update(add("from B"))
    expect(await open(server().blob, password)).toMatchObject({ items: [{ title: "from A" }, { title: "from B" }] })
    expect(b.data.items.map((i) => i.title)).toEqual(["from A", "from B"])
    // The rebased device keeps saving normally afterwards.
    await b.update(add("again"))
    expect(server().version).toBe(4)
  })
  it("refuses to overwrite an item the other device changed", async () => {
    const item = { ...newItem("login"), title: "shared" }
    const { a, b, server } = await twoDevices({ ...emptyVault(), items: [item] })
    await a.update(rename(item, "renamed on A"))
    await expect(b.update(rename(item, "renamed on B"))).rejects.toBeInstanceOf(ConflictError)
    expect(await open(server().blob, password)).toMatchObject({ items: [{ title: "renamed on A" }] })
  })
  it("refuses when the newer vault no longer opens with this key", async () => {
    const { b, setServer } = await twoDevices()
    const otherKey = await newVaultKey()
    const other = await newHeader(otherKey, await deriveForEmail(password, email), newRecoveryCode())
    setServer({ blob: await sealV2(other, otherKey, emptyVault()), version: 2 })
    await expect(b.update(add("stale"))).rejects.toBeInstanceOf(ConflictError)
  })
})

describe("master password change (single password)", () => {
  it("re-wraps between queued edits, moves the login, and drops the old slot", async () => {
    const { session } = await setup()
    const setLogin = vi.fn(async (_secret: string) => {})
    await Promise.all([session.update(add("one")), session.changeMaster(password, newPassword, setLogin), session.update(add("two"))])
    expect(setLogin).toHaveBeenCalledWith((await deriveForEmail(newPassword, email)).login)
    const backup = await session.backup() as EnvelopeV2
    expect(await open(backup, newPassword)).toMatchObject({ items: [{ title: "one" }, { title: "two" }] })
    expect(backup.keys.masterPrev).toBeUndefined()
    await expect(open(backup, password)).rejects.toThrow()
  })
  it("keeps the recovery code working after a change", async () => {
    const { session, recoveryCode } = await setup()
    await session.changeMaster(password, newPassword, async () => {})
    const backup = await session.backup() as EnvelopeV2
    const vk = await unwrap(backup.keys.recovery!, await recoveryWrapKey(recoveryCode))
    expect(await openV2(backup, vk)).toEqual(emptyVault())
  })
  it("keeps both passwords working if the login change fails, since the server may have applied it", async () => {
    const { session, save } = await setup()
    await expect(session.changeMaster(password, newPassword, async () => { throw new Error("response lost") })).rejects.toThrow("response lost")
    expect(save).toHaveBeenCalledTimes(1)
    const stored = save.mock.calls[0][1]
    expect(await open(stored, password)).toEqual(emptyVault())
    expect(await open(stored, newPassword)).toEqual(emptyVault())
    // Later edits keep both slots until the next successful change.
    await session.update(add("after"))
    const later = save.mock.calls[1][1]
    expect(await open(later, password)).toMatchObject({ items: [{ title: "after" }] })
    expect(await open(later, newPassword)).toMatchObject({ items: [{ title: "after" }] })
  })
  it("drops the old slot on the next save when the cleanup write fails", async () => {
    const { session, save } = await setup()
    save.mockImplementationOnce(async (previous, blob) => ({ blob, version: previous.version + 1 }))
      .mockRejectedValueOnce(new Error("offline"))
    await session.changeMaster(password, newPassword, async () => {})
    await session.update(add("next"))
    const next = save.mock.calls[2][1]
    expect(next.keys.masterPrev).toBeUndefined()
    expect(await open(next, newPassword)).toMatchObject({ items: [{ title: "next" }] })
    await expect(open(next, password)).rejects.toThrow()
  })
  it("treats a conflict on the cleanup write as a conflict for later saves", async () => {
    const { session, save } = await setup()
    save.mockImplementationOnce(async (previous, blob) => ({ blob, version: previous.version + 1 }))
      .mockRejectedValueOnce(new ConflictError())
    await session.changeMaster(password, newPassword, async () => {})
    await expect(session.update(add("stale"))).rejects.toBeInstanceOf(ConflictError)
    expect(save).toHaveBeenCalledTimes(2)
  })
  it("keeps the old key after a failed write and permits retry", async () => {
    const { session, save } = await setup()
    save.mockRejectedValueOnce(new Error("offline"))
    const setLogin = vi.fn(async () => {})
    await expect(session.changeMaster(password, newPassword, setLogin)).rejects.toThrow("offline")
    expect(setLogin).not.toHaveBeenCalled()
    await session.update(add("retry"))
    expect(await open(await session.backup(), password)).toMatchObject({ items: [{ title: "retry" }] })
  })
  it("rejects the wrong old password without writing or touching the login", async () => {
    const { session, save } = await setup()
    const setLogin = vi.fn(async () => {})
    await expect(session.changeMaster("Wrong-test!Master-2026", newPassword, setLogin)).rejects.toBeInstanceOf(WrongPasswordError)
    expect(save).not.toHaveBeenCalled()
    expect(setLogin).not.toHaveBeenCalled()
    // A typo is not a failed save: the session stays healthy.
    expect(session.hasError).toBe(false)
  })
})

describe("recovery code rotation", () => {
  it("issues a new code and retires the old one", async () => {
    const { session, recoveryCode } = await setup()
    const fresh = await session.rotateRecovery()
    expect(fresh).not.toBe(recoveryCode)
    const backup = await session.backup() as EnvelopeV2
    expect(await openV2(backup, await unwrap(backup.keys.recovery!, await recoveryWrapKey(fresh)))).toEqual(emptyVault())
    await expect(unwrap(backup.keys.recovery!, await recoveryWrapKey(recoveryCode))).rejects.toThrow()
    expect(await open(backup, password)).toEqual(emptyVault())
    expect(headerOf(backup).keys.master).toBeTruthy()
  })
})
