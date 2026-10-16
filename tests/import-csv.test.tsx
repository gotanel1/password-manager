// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ImportCsvModal } from "../src/ImportCsvModal"
import { VaultContext, type VaultApi } from "../src/state"
import { analyze, emptyVault } from "../src/lib/model"
import { mergeCsvImport, parsePasswordCsv } from "../src/lib/import"

let host: HTMLDivElement, root: Root, api: VaultApi
const close = vi.fn()
const csv = "name,url,username,password\nExample,https://example.invalid,user,test-only-secret"
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  close.mockReset()
  api = {
    email: "test@example.invalid", data: emptyVault(), analysis: analyze([]),
    prefs: { theme: "light", autoLockMin: 5, clipboardSec: 30 }, setPrefs: vi.fn(),
    update: vi.fn(async (change) => { api.data = change(api.data) }), copy: vi.fn(), toast: vi.fn(), lock: vi.fn(), signOut: vi.fn(),
    changeMaster: vi.fn(), rotateRecovery: vi.fn(), importBackup: vi.fn(), exportBackup: vi.fn(), deleteVault: vi.fn(),
  }
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  await render()
})
async function render() {
  await act(async () => { root.render(<VaultContext.Provider value={api}><ImportCsvModal close={close} /></VaultContext.Provider>) })
}
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function choose(text = csv) {
  const file = new File([text], "test.csv", { type: "text/csv" })
  Object.defineProperty(file, "text", { value: async () => text })
  const input = host.querySelector('input[type="file"]')!
  Object.defineProperty(input, "files", { configurable: true, value: [file] })
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })) })
}
async function submit() {
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
}
it("previews titles without exposing secrets and only saves after explicit confirmation", async () => {
  await choose()
  expect(host.textContent).toContain("เพิ่มใหม่ 1 รายการ")
  expect(host.textContent).toContain("Example")
  expect(host.innerHTML).not.toContain("test-only-secret")
  expect(api.update).not.toHaveBeenCalled()
  await submit()
  expect(api.update).toHaveBeenCalledTimes(1)
  const change = vi.mocked(api.update).mock.calls[0][0]
  const latest = mergeCsvImport(emptyVault(), parsePasswordCsv(csv).items)
  expect(change(latest).items).toHaveLength(1)
  expect(close).toHaveBeenCalledTimes(1)
  expect(api.toast).toHaveBeenCalledWith("นำเข้า 1 รายการแล้ว")
})
it("disables confirmation when everything is a duplicate and cancel does not save", async () => {
  api.data = mergeCsvImport(emptyVault(), parsePasswordCsv(csv).items)
  await render()
  await choose()
  expect(host.textContent).toContain("ข้ามรายการซ้ำ 1 รายการ")
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
  await submit()
  await act(async () => { [...host.querySelectorAll("button")].find((b) => b.textContent === "ยกเลิก")!.click() })
  expect(api.update).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledTimes(1)
})
it("rejects bad files, clears the previous preview and allows selecting a replacement", async () => {
  await choose()
  await choose("invalid")
  expect(host.querySelector('[role="alert"]')).not.toBeNull()
  expect(host.textContent).not.toContain("Example")
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
  await choose()
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(host.textContent).toContain("Example")
})
it("keeps the preview after a failed save and allows retry", async () => {
  vi.mocked(api.update).mockRejectedValueOnce(new Error("offline"))
  await choose()
  await submit()
  expect(host.querySelector('[role="alert"]')!.textContent).toContain("นำเข้าไม่สำเร็จ")
  expect(close).not.toHaveBeenCalled()
  expect(api.toast).not.toHaveBeenCalled()
  await submit()
  expect(close).toHaveBeenCalledTimes(1)
})
it("blocks repeated submissions and dismissal while saving", async () => {
  let finish!: () => void
  vi.mocked(api.update).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
  await choose()
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
  await submit()
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })) })
  expect(api.update).toHaveBeenCalledTimes(1)
  expect(close).not.toHaveBeenCalled()
  await act(async () => { finish() })
  expect(close).toHaveBeenCalledTimes(1)
})
