// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { SettingsPage } from "../src/pages"
import { VaultContext, type VaultApi } from "../src/state"
import { ConfirmProvider } from "../src/ui"
import { emptyVault, analyze } from "../src/lib/model"

let host: HTMLDivElement, root: Root, api: VaultApi
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("confirm", vi.fn(() => true))
  api = {
    email: "test@example.invalid", data: emptyVault(), analysis: analyze([]),
    prefs: { theme: "light", autoLockMin: 5, clipboardSec: 30 }, setPrefs: vi.fn(),
    update: vi.fn(), copy: vi.fn(), toast: vi.fn(), lock: vi.fn(), signOut: vi.fn(),
    changeMaster: vi.fn(), rotateRecovery: vi.fn(), importBackup: vi.fn(), exportBackup: vi.fn(), deleteVault: vi.fn(),
  }
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  await act(async () => {
    root.render(<ConfirmProvider><VaultContext.Provider value={api}><SettingsPage /></VaultContext.Provider></ConfirmProvider>)
  })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })) })

it("signs out everywhere only after the in-app dialog is confirmed", async () => {
  await click(button("ออกทั้งหมด"))
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain("ออกจากระบบทุกอุปกรณ์?")
  expect(api.signOut).not.toHaveBeenCalled()
  expect(confirm).not.toHaveBeenCalled() // never falls back to the native dialog

  await click(button("ยกเลิก"))
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(api.signOut).not.toHaveBeenCalled()

  await click(button("ออกทั้งหมด"))
  await click(button("ออกจากระบบทั้งหมด"))
  expect(api.signOut).toHaveBeenCalledWith(true)
})

it("focuses Cancel so Enter does not confirm by accident", async () => {
  await click(button("ออกทั้งหมด"))
  expect(document.activeElement?.textContent).toBe("ยกเลิก")
})
