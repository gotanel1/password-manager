import { describe, expect, it, vi } from "vitest"
import { newKey, seal, unseal } from "../src/lib/crypto"
import { emptyVault, newItem } from "../src/lib/model"
import { VaultSession } from "../src/lib/session"
import { ConflictError } from "../src/lib/sync"

const password = "Test-only!Strong-Master-2026"
async function setup() {
  const key = await newKey(password)
  const data = emptyVault()
  const remote = { blob: await seal(key, data), version: 1 }
  const save = vi.fn(async (previous: typeof remote, blob: typeof remote.blob) => ({ blob, version: previous.version + 1 }))
  return { session: new VaultSession(key, data, remote, save), save, data, remote }
}
const add = (title: string) => (data: ReturnType<typeof emptyVault>) => ({ ...data, items: [...data.items, { ...newItem("login"), title }] })

describe("vault save lifecycle", () => {
  it("serializes edits against the last committed version", async () => {
    const { session, save } = await setup()
    await Promise.all([session.update(add("one")), session.update(add("two"))])
    const backup = await session.backup()
    expect(save.mock.calls.map(([remote]) => remote.version)).toEqual([1, 2])
    expect((await unseal(backup, password)).data).toMatchObject({ items: [{ title: "one" }, { title: "two" }] })
  })
  it("drains admitted edits on close and rejects new work", async () => {
    const { session, save } = await setup()
    const pending = session.update(add("before lock"))
    const closing = session.close()
    await expect(session.update(add("after lock"))).rejects.toThrow()
    await Promise.all([pending, closing])
    expect(save).toHaveBeenCalledTimes(1)
    expect((await unseal(save.mock.calls[0][1], password)).data).toMatchObject({ items: [{ title: "before lock" }] })
    await expect(session.backup()).rejects.toThrow()
  })
  it("does not commit or export a stale success after a failed save; a retry recovers", async () => {
    const { session, save } = await setup()
    save.mockRejectedValueOnce(new Error("offline"))
    await expect(session.update(add("one"))).rejects.toThrow("offline")
    await expect(session.backup()).rejects.toThrow("offline")
    expect(session.data.items).toHaveLength(0)
    await session.update(add("one"))
    expect((await unseal(await session.backup(), password)).data).toMatchObject({ items: [{ title: "one" }] })
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
    expect((await unseal(await backup, password)).data).toMatchObject({ items: [{ title: "latest" }] })
  })
  it("changes master password between queued edits without mixing keys", async () => {
    const { session } = await setup()
    await Promise.all([session.update(add("one")), session.changeMaster(password, "New-test!Master-2026"), session.update(add("two"))])
    const backup = await session.backup()
    expect((await unseal(backup, "New-test!Master-2026")).data).toMatchObject({ items: [{ title: "one" }, { title: "two" }] })
    await expect(unseal(backup, password)).rejects.toThrow()
  })
  it("keeps the old key after failed rotation and permits retry", async () => {
    const { session, save } = await setup()
    save.mockRejectedValueOnce(new Error("offline"))
    await expect(session.changeMaster(password, "New-test!Master-2026")).rejects.toThrow("offline")
    await session.update(add("retry"))
    expect((await unseal(await session.backup(), password)).data).toMatchObject({ items: [{ title: "retry" }] })
  })
  it("rejects the wrong old password without writing", async () => {
    const { session, save } = await setup()
    await expect(session.changeMaster("wrong", "New-test!Master-2026")).rejects.toThrow()
    expect(save).not.toHaveBeenCalled()
  })
})
