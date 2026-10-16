// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { SettingsPage } from "../src/pages"
import { VaultContext, type VaultApi } from "../src/state"
import { emptyVault, analyze } from "../src/lib/model"

let host: HTMLDivElement, root: Root, api: VaultApi
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("prompt", vi.fn(() => null))
  api = {
    email: "test@example.invalid", data: emptyVault(), analysis: analyze([]),
    prefs: { theme: "light", autoLockMin: 5, clipboardSec: 30 }, setPrefs: vi.fn(),
    update: vi.fn(), copy: vi.fn(), toast: vi.fn(), lock: vi.fn(), signOut: vi.fn(),
    changeMaster: vi.fn(), rotateRecovery: vi.fn(), importBackup: vi.fn().mockResolvedValue("นำเข้า 1 รายการ"), exportBackup: vi.fn(), deleteVault: vi.fn(),
  }
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  await act(async () => { root.render(<VaultContext.Provider value={api}><SettingsPage /></VaultContext.Provider>) })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function chooseFile() {
  const input = host.querySelector('input[type="file"]')!
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["{}"], "test-backup.json", { type: "application/json" })] })
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })) })
}
async function fillPassword(value: string) {
  const input = host.querySelector('[role="dialog"] input[type="password"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
async function submit() {
  await act(async () => { host.querySelector('[role="dialog"] form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
}
it("imports through an in-app password dialog without native prompt", async () => {
  await chooseFile()
  expect(host.querySelector('[role="dialog"]')).not.toBeNull()
  await fillPassword("test-only-password")
  await submit()
  expect(api.importBackup).toHaveBeenCalledWith(expect.any(File), "test-only-password")
  expect(api.toast).toHaveBeenCalledWith("นำเข้า 1 รายการ")
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(prompt).not.toHaveBeenCalled()
})
it("keeps the dialog open after failure and allows retry", async () => {
  vi.mocked(api.importBackup).mockResolvedValueOnce("รหัสผ่านไม่ถูกต้อง หรือไฟล์เสียหาย")
  await chooseFile()
  await fillPassword("wrong")
  await submit()
  expect(host.querySelector('[role="dialog"]')!.textContent).toContain("รหัสผ่านไม่ถูกต้อง")
  expect(api.toast).not.toHaveBeenCalled()
  await fillPassword("correct")
  await submit()
  expect(host.querySelector('[role="dialog"]')).toBeNull()
})
