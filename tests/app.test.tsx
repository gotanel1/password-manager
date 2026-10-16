// @vitest-environment jsdom
import { webcrypto } from "node:crypto"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { newKey, seal, unseal } from "../src/lib/crypto"
import { deriveForEmail, isEnvelopeV2, newHeader, newRecoveryCode, newVaultKey, openV2, sealV2, unlockWithMaster } from "../src/lib/keys"
import { emptyVault, newItem, type VaultData } from "../src/lib/model"
import { useVault, type VaultApi } from "../src/state"
import App from "../src/App"

const h = vi.hoisted(() => ({
  fetch: vi.fn(), save: vi.fn(), signOut: vi.fn(), download: vi.fn(), copy: vi.fn(), setLogin: vi.fn(), signIn: vi.fn(),
  auth: null as null | ((event: string, session: unknown) => void),
  unlock: null as null | ((pw: string) => Promise<string | null>),
  create: null as null | ((pw: string) => Promise<string | null>),
  complete: null as null | (() => void),
  legacy: null as null | ((email: string, password: string) => void),
  upgrade: null as null | ((accountPw: string, oldMaster: string, newMaster?: string) => Promise<string | null>),
  api: null as VaultApi | null,
}))
vi.mock("../src/lib/sync", async (original) => ({
  ...await original<typeof import("../src/lib/sync")>(),
  fetchVault: h.fetch, saveVault: h.save, setLoginSecret: h.setLogin,
  sb: { auth: { onAuthStateChange: (callback: typeof h.auth) => { h.auth = callback; return { data: { subscription: { unsubscribe() {} } } } }, signOut: h.signOut, signInWithPassword: h.signIn } },
}))
vi.mock("../src/lib/prefs", async (original) => ({ ...await original<typeof import("../src/lib/prefs")>(), download: h.download, copyText: h.copy }))
vi.mock("../src/access", async (original) => ({
  masterChecks: (await original<typeof import("../src/access")>()).masterChecks,
  initials: () => "T",
  AuthScreen: ({ onLegacy }: { onLegacy: typeof h.legacy }) => { h.legacy = onLegacy; return <p>auth screen</p> },
  EmailConfirmation: () => <p>email screen</p>, ForgotScreen: () => <p>forgot screen</p>, RecoverScreen: () => <p>recover screen</p>,
  LegacyScreen: ({ onUpgrade }: { onUpgrade: typeof h.upgrade }) => { h.upgrade = onUpgrade; return <p>legacy screen</p> },
  UnlockScreen: ({ onUnlock }: { onUnlock: typeof h.unlock }) => { h.unlock = onUnlock; return <p>locked screen</p> },
  SetupScreen: ({ onCreate }: { onCreate: typeof h.create }) => { h.create = onCreate; return <p>setup screen</p> },
  KitScreen: ({ onDone, code }: { onDone: typeof h.complete; code: string }) => { h.complete = onDone; return <p>kit screen {code}</p> },
}))
vi.mock("../src/vault", async (original) => ({
  ...await original<typeof import("../src/vault")>(),
  Sidebar: ({ openPage }: { openPage: (page: string) => void }) => <button onClick={() => openPage("settings")}>test settings</button>,
}))
vi.mock("../src/pages", async (original) => ({
  ...await original<typeof import("../src/pages")>(),
  SettingsPage: () => { h.api = useVault(); return <p>settings screen</p> },
}))

const password = "Only-test!Master-2026"
const user = { id: "test-account-a", email: "test@example.invalid" }
let root: Root, host: HTMLDivElement
let stored: { blob: unknown; version: number } | null
/** A v2 (single-password) vault for `email`, as the app would create it. */
async function v2(pw: string, email: string, data = emptyVault()) {
  const vaultKey = await newVaultKey()
  return sealV2(await newHeader(vaultKey, await deriveForEmail(pw, email), newRecoveryCode()), vaultKey, data)
}
/** Opens a stored or exported vault from the password alone, like a fresh device would. */
async function openAny(blob: unknown, pw: string, email = user.email) {
  if (isEnvelopeV2(blob)) return openV2(blob, await unlockWithMaster(blob, await deriveForEmail(pw, email)))
  return (await unseal(blob as Parameters<typeof unseal>[0], pw)).data
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("crypto", webcrypto)
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })))
  vi.clearAllMocks()
  localStorage.clear()
  h.unlock = null; h.create = null; h.complete = null; h.api = null; h.legacy = null; h.upgrade = null
  h.copy.mockResolvedValue(undefined)
  stored = { blob: await v2(password, user.email), version: 1 }
  h.setLogin.mockResolvedValue(undefined)
  h.signIn.mockImplementation(async () => ({ data: { user, session: { user } }, error: null }))
  h.fetch.mockImplementation(async () => stored)
  h.save.mockImplementation(async (_user, remote, blob) => { stored = { blob, version: (remote?.version ?? 0) + 1 }; return stored })
  h.signOut.mockImplementation(async () => { h.auth!("SIGNED_OUT", null); return { error: null } })
  host = document.createElement("div"); document.body.append(host)
  root = createRoot(host)
  await act(async () => { root.render(<App />) })
  await act(async () => { h.auth!("SIGNED_IN", { user }); await new Promise((r) => setTimeout(r, 0)) })
})
afterEach(async () => {
  vi.useRealTimers()
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})
async function unlock() {
  let error: string | null = null
  await act(async () => { error = await h.unlock!(password) })
  expect(error).toBeNull()
  await act(async () => { Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "test settings")!.click() })
  expect(h.api).not.toBeNull()
}
const add = (name: string) => (d: VaultData) => ({ ...d, items: [...d.items, { ...newItem("note"), title: name }] })

describe("App vault integration", () => {
  it("saves edits and reopens the same encrypted data after locking", async () => {
    await unlock()
    await act(async () => { await h.api!.update(add("saved note")) })
    await act(async () => { h.api!.lock() })
    expect(host.textContent).toContain("locked screen")
    expect(host.textContent).not.toContain("saved note")
    await unlock()
    expect(h.api!.data.items[0].title).toBe("saved note")
  })
  it("refuses to open cached data after a failed refresh", async () => {
    h.fetch.mockRejectedValueOnce(new Error("offline"))
    let result: unknown
    await act(async () => { result = await h.unlock!(password) })
    expect(result).toMatch(/โหลดข้อมูลล่าสุดไม่สำเร็จ/)
    expect(host.textContent).toContain("locked screen")
  })
  it("waits for queued edits before downloading the backup", async () => {
    await unlock()
    await act(async () => {
      const pending = h.api!.update(add("latest note"))
      h.api!.exportBackup()
      await pending
    })
    await vi.waitFor(() => expect(h.download).toHaveBeenCalledTimes(1))
    expect(await openAny(JSON.parse(h.download.mock.calls[0][1]), password)).toMatchObject({ items: [{ title: "latest note" }] })
  })
  it("keeps committed state and blocks stale backup after a failed edit", async () => {
    await unlock()
    h.save.mockRejectedValueOnce(new Error("offline"))
    await act(async () => { await expect(h.api!.update(add("not saved"))).rejects.toThrow() })
    expect(h.api!.data.items).toHaveLength(0)
    await act(async () => { h.api!.exportBackup() })
    expect(h.download).not.toHaveBeenCalled()
    expect(host.textContent).toContain("ส่งออกไม่สำเร็จ")
  })
  it("imports a single-password backup made on another account", async () => {
    await unlock()
    const blob = await v2(password, "other@example.invalid", { ...emptyVault(), items: [{ ...newItem("note"), title: "from v2 backup" }] })
    await act(async () => {
      expect(await h.api!.importBackup({ text: async () => JSON.stringify(blob) } as File, "Wrong-test!Master-2026")).toMatch(/ไม่ถูกต้อง/)
      expect(await h.api!.importBackup({ text: async () => JSON.stringify(blob) } as File, password)).toBe("นำเข้า 1 รายการ")
    })
    expect(h.api!.data.items[0].title).toBe("from v2 backup")
  })
  it("imports encrypted data once without replacing existing IDs and rejects invalid files", async () => {
    await unlock()
    const item = { ...newItem("note"), title: "imported" }
    const blob = await seal(await newKey(password), { ...emptyVault(), items: [item] })
    const file = { text: async () => JSON.stringify(blob) } as File
    await act(async () => {
      expect(await h.api!.importBackup(file, "wrong")).toMatch(/ไม่ถูกต้อง/)
      expect(await h.api!.importBackup({ text: async () => "{" } as File, password)).toBe("ไฟล์ไม่ถูกต้อง")
      expect(await h.api!.importBackup(file, password)).toBe("นำเข้า 1 รายการ")
    })
    await act(async () => { expect(await h.api!.importBackup(file, password)).toBe("นำเข้า 0 รายการ") })
    expect(h.api!.data.items).toHaveLength(1)
    const bad = await seal(await newKey(password), { ...emptyVault(), items: [null] })
    await act(async () => { expect(await h.api!.importBackup({ text: async () => JSON.stringify(bad) } as File, password)).toMatch(/เสียหาย/)} )
    expect(h.api!.data.items[0]).toEqual(item)
  })
  it("does not import into another session when locked during file reading", async () => {
    await unlock()
    let resolve!: (text: string) => void
    const file = { text: () => new Promise<string>((r) => { resolve = r }) } as File
    const blob = await seal(await newKey(password), emptyVault())
    let pending!: Promise<string>
    await act(async () => { pending = h.api!.importBackup(file, password); h.api!.lock() })
    let message = ""
    await act(async () => { resolve(JSON.stringify(blob)); message = await pending })
    expect(message).toMatch(/ล็อกแล้ว/)
    expect(h.save).not.toHaveBeenCalled()
  })
  it("drains writes before signing out and leaves the vault locked on sign-out failure", async () => {
    await unlock()
    h.signOut.mockResolvedValueOnce({ error: new Error("offline") })
    await act(async () => { const pending = h.api!.update(add("before sign-out")); h.api!.signOut(true); expect(h.signOut).not.toHaveBeenCalled(); await pending })
    await vi.waitFor(() => expect(h.signOut).toHaveBeenCalledWith({ scope: "global" }))
    expect(host.textContent).toContain("locked screen")
    expect(await openAny(stored!.blob, password)).toMatchObject({ items: [{ title: "before sign-out" }] })
  })
  it("auto-locks and applies dark-mode preferences", async () => {
    await unlock()
    await act(async () => { h.api!.setPrefs({ theme: "dark", autoLockMin: 1, clipboardSec: 15 }) })
    expect(document.documentElement.dataset.theme).toBe("dark")
    vi.useFakeTimers()
    // Reset the inactivity timer using a real listener after switching to fake timers.
    await act(async () => { window.dispatchEvent(new Event("mousemove")); await vi.advanceTimersByTimeAsync(60_000) })
    expect(host.textContent).toContain("locked screen")
  })
  it("creates a vault after proving the password matches the account, then shows the recovery code", async () => {
    stored = null
    await act(async () => { h.auth!("SIGNED_OUT", null); await new Promise((r) => setTimeout(r, 0)); h.auth!("SIGNED_IN", { user }); await new Promise((r) => setTimeout(r, 0)) })
    expect(host.textContent).toContain("setup screen")
    h.signIn.mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: "Invalid login credentials" } })
    await act(async () => { expect(await h.create!("Wrong-test!Master-2026")).toMatch(/ไม่ตรงกับที่ใช้สมัคร/) })
    expect(h.save).not.toHaveBeenCalled()
    await act(async () => { expect(await h.create!(password)).toBeNull() })
    // The account is checked with the derived login secret, never the master password itself.
    expect(h.signIn).toHaveBeenLastCalledWith({ email: user.email, password: (await deriveForEmail(password, user.email)).login })
    expect(host.textContent).toMatch(/kit screen ([A-Z2-9]{5}-){4}[A-Z2-9]{5}/)
    await act(async () => { h.complete!() })
    expect(JSON.stringify(h.save.mock.calls)).not.toContain(password)
    expect(await openAny(stored!.blob, password)).toEqual(emptyVault())
  })
  it("upgrades a two-password vault on unlock and moves the login to the master password", async () => {
    stored = { blob: await seal(await newKey(password), { ...emptyVault(), items: [{ ...newItem("note"), title: "old data" }] }), version: 3 }
    let error: string | null = "unset"
    await act(async () => { error = await h.unlock!(password) })
    expect(error).toBeNull()
    expect(h.setLogin).toHaveBeenCalledWith((await deriveForEmail(password, user.email)).login)
    expect(host.textContent).toContain("kit screen")
    expect(isEnvelopeV2(stored!.blob)).toBe(true)
    expect(stored!.version).toBe(4)
    expect(await openAny(stored!.blob, password)).toMatchObject({ items: [{ title: "old data" }] })
  })
  it("moves the login before upgrading on unlock, so a failed vault write can be retried and still shows the recovery code", async () => {
    stored = { blob: await seal(await newKey(password), { ...emptyVault(), items: [{ ...newItem("note"), title: "old data" }] }), version: 3 }
    h.save.mockRejectedValueOnce(new Error("offline"))
    await act(async () => { expect(await h.unlock!(password)).toMatch(/บันทึกตู้เซฟไม่สำเร็จ/) })
    expect(h.setLogin).toHaveBeenCalledWith((await deriveForEmail(password, user.email)).login)
    expect(isEnvelopeV2(stored!.blob)).toBe(false)
    await act(async () => { expect(await h.unlock!(password)).toBeNull() })
    expect(host.textContent).toMatch(/kit screen ([A-Z2-9]{5}-){4}[A-Z2-9]{5}/)
    expect(isEnvelopeV2(stored!.blob)).toBe(true)
    expect(await openAny(stored!.blob, password)).toMatchObject({ items: [{ title: "old data" }] })
  })
  it("leaves a two-password vault untouched when the login change fails during upgrade", async () => {
    const old = await seal(await newKey(password), emptyVault())
    stored = { blob: old, version: 3 }
    h.setLogin.mockRejectedValueOnce(new Error("auth down"))
    await act(async () => { expect(await h.unlock!(password)).not.toBeNull() })
    expect(h.save).not.toHaveBeenCalled()
    expect(stored).toEqual({ blob: old, version: 3 })
  })
  it("retries an interrupted upgrade from the upgrade screen without the old account password", async () => {
    const oldMaster = "Old-test!Master-2026", newMaster = "Next-test!Master-2026"
    stored = { blob: await seal(await newKey(oldMaster), { ...emptyVault(), items: [{ ...newItem("note"), title: "old data" }] }), version: 2 }
    await act(async () => { h.auth!("SIGNED_OUT", null); await new Promise((r) => setTimeout(r, 0)) })
    await act(async () => { h.legacy!(user.email, oldMaster) })
    expect(host.textContent).toContain("legacy screen")
    h.save.mockRejectedValueOnce(new Error("offline"))
    await act(async () => { expect(await h.upgrade!("Old-test!Account-2026", oldMaster, newMaster)).toMatch(/บันทึกตู้เซฟไม่สำเร็จ/) })
    expect(h.signIn).toHaveBeenCalledTimes(1)
    expect(h.setLogin).toHaveBeenCalledWith((await deriveForEmail(newMaster, user.email)).login)
    expect(isEnvelopeV2(stored!.blob)).toBe(false)
    // The account password is now the new login secret, so the retry must not ask for the old one.
    await act(async () => { expect(await h.upgrade!("", oldMaster, newMaster)).toBeNull() })
    expect(h.signIn).toHaveBeenCalledTimes(1)
    expect(host.textContent).toMatch(/kit screen ([A-Z2-9]{5}-){4}[A-Z2-9]{5}/)
    expect(await openAny(stored!.blob, newMaster)).toMatchObject({ items: [{ title: "old data" }] })
  })
  it("asks for a stronger password before upgrading a weak two-password vault", async () => {
    stored = { blob: await seal(await newKey("weak-old-1"), emptyVault()), version: 1 }
    await act(async () => { expect(await h.unlock!("weak-old-1")).toBeNull() })
    expect(host.textContent).toContain("legacy screen")
    expect(h.save).not.toHaveBeenCalled()
    expect(h.setLogin).not.toHaveBeenCalled()
  })
  it("keeps a pending save bound to its original owner across an account change", async () => {
    await unlock()
    const second = { id: "test-account-b", email: "second@example.invalid" }
    const remoteB = { blob: await v2(password, second.email), version: 1 }
    let finish!: () => void
    const gate = new Promise<void>((resolve) => { finish = resolve })
    h.save.mockImplementationOnce(async (_owner, remote, blob) => { await gate; return { blob, version: remote.version + 1 } })
    h.fetch.mockImplementation(async (owner) => owner.id === second.id ? remoteB : stored)
    let pending!: Promise<void>
    await act(async () => { pending = h.api!.update(add("only account A")); await Promise.resolve() })
    await act(async () => { h.auth!("SIGNED_IN", { user: second }); await new Promise((r) => setTimeout(r, 0)) })
    expect(host.textContent).toContain("locked screen")
    await act(async () => { finish(); await pending })
    expect(h.save.mock.calls[0][0].id).toBe(user.id)
    await unlock()
    expect(h.api!.data.items).toHaveLength(0)
    expect(h.api!.email).toBe(second.email)
  })
  it("ignores a late fetch from the previous account", async () => {
    let finish!: (value: typeof stored) => void
    const late = new Promise<typeof stored>((resolve) => { finish = resolve })
    h.fetch.mockReturnValueOnce(late)
    let pending!: Promise<string | null>
    await act(async () => { pending = h.unlock!(password); await Promise.resolve() })
    const second = { id: "test-account-b", email: "second@example.invalid" }
    await act(async () => { h.auth!("SIGNED_IN", { user: second }); await new Promise((r) => setTimeout(r, 0)) })
    await act(async () => { finish(null); expect(await pending).toMatch(/สถานะบัญชีเปลี่ยน/) })
    expect(host.textContent).toContain("locked screen")
    expect(host.textContent).not.toContain("onboarding screen")
  })
  it("rejects stale UI mutations after locking and reopening", async () => {
    await unlock()
    const oldApi = h.api!
    await act(async () => { oldApi.lock() })
    await unlock()
    await act(async () => { await expect(oldApi.update(add("stale edit"))).rejects.toThrow() })
    expect(h.api!.data.items).toHaveLength(0)
    expect(h.save).not.toHaveBeenCalled()
  })
  it("does not admit generator-history saves after copy finishes in a retired session", async () => {
    await unlock()
    let finish!: () => void
    h.copy.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve }))
    let copy!: Promise<boolean>
    await act(async () => { copy = h.api!.copy("รหัสผ่าน", "test-only-value"); h.api!.lock() })
    await unlock()
    await act(async () => { finish(); expect(await copy).toBe(false) })
  })
  it("recovers a server-committed edit after the response was lost, without exporting stale data", async () => {
    await unlock()
    h.save.mockImplementationOnce(async (_owner, remote, blob) => {
      stored = { blob, version: remote.version + 1 }
      throw new Error("response lost after commit")
    })
    await act(async () => { await expect(h.api!.update(add("committed despite timeout"))).rejects.toThrow() })
    expect(h.api!.data.items).toHaveLength(0)
    await act(async () => { h.api!.exportBackup() })
    expect(h.download).not.toHaveBeenCalled()
    await act(async () => { h.api!.lock() })
    await unlock()
    expect(h.api!.data.items[0].title).toBe("committed despite timeout")
  })
})
