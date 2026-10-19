// @vitest-environment jsdom
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ItemEditor } from "../src/vault"
import { ConfirmProvider, GeneratorOptions } from "../src/ui"
import { VaultContext, type VaultApi } from "../src/state"
import { analyze, emptyVault, newItem } from "../src/lib/model"
import { COMMON_SYMBOLS, DEFAULT_GEN, SYMBOLS, type GenOptions } from "../src/lib/password"

let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

const render = (ui: ReactNode) => act(async () => { root.render(ui) })
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === text)!
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
const field = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
/** Types into a React-controlled input the way the browser would. */
const type = (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
})

describe("generator options", () => {
  it("keeps only symbols in the allowed set and offers the common set as one tap", async () => {
    let value: GenOptions = DEFAULT_GEN
    const Harness = () => <GeneratorOptions value={value} onChange={(o) => { value = o; void render(<Harness />) }} />
    await render(<Harness />)
    expect(field("สัญลักษณ์ที่ใช้ได้").value).toBe(SYMBOLS)

    await type(field("สัญลักษณ์ที่ใช้ได้"), "ab!@ 1!")
    expect(value.symbolSet).toBe("!@")
    expect(field("สัญลักษณ์ที่ใช้ได้").value).toBe("!@")

    await click(button("เฉพาะที่เว็บส่วนใหญ่รับ"))
    expect(value.symbolSet).toBe(COMMON_SYMBOLS)
    await click(button("ทั้งหมด"))
    expect(value.symbolSet).toBe(SYMBOLS)

    await click(button("สัญลักษณ์")) // switching symbols off hides the set
    expect(value.symbols).toBe(false)
    expect(host.querySelector('input[aria-label="สัญลักษณ์ที่ใช้ได้"]')).toBeNull()
  })
})

describe("item editor password generator", () => {
  const api = {
    email: "test@example.invalid", data: emptyVault(), analysis: analyze([]),
    prefs: { theme: "light", autoLockMin: 5, clipboardSec: 30 }, setPrefs: vi.fn(),
    update: vi.fn(), copy: vi.fn(), toast: vi.fn(), lock: vi.fn(), signOut: vi.fn(),
    changeMaster: vi.fn(), rotateRecovery: vi.fn(), importBackup: vi.fn(), exportBackup: vi.fn(), deleteVault: vi.fn(),
  } as unknown as VaultApi
  const password = () => host.querySelector<HTMLInputElement>('input[autocomplete="new-password"]')!

  it("generates with the chosen length and symbols, and still works in one tap", async () => {
    await render(
      <ConfirmProvider><VaultContext.Provider value={api}>
        <ItemEditor initial={newItem("login")} isNew close={() => {}} onSaved={() => {}} />
      </VaultContext.Provider></ConfirmProvider>,
    )
    expect(host.querySelector('input[aria-label="ความยาว"]')).toBeNull() // options stay out of the way until asked for

    await click(button("สร้างรหัสผ่านใหม่"))
    expect(password().value).toHaveLength(20)
    expect(password().type).toBe("text") // shown, so the person sees what the site gets

    await click(button("ตัวเลือกการสุ่ม"))
    await type(field("ความยาว"), "12")
    expect(password().value).toHaveLength(12) // a change regenerates at once

    await type(field("สัญลักษณ์ที่ใช้ได้"), "!@")
    expect(password().value).toMatch(/^[a-zA-Z0-9!@]{12}$/)

    await click(button("สัญลักษณ์"))
    expect(password().value).toMatch(/^[a-zA-Z0-9]{12}$/)

    await click(button("สร้างรหัสผ่านใหม่")) // the one-tap button keeps the chosen options
    expect(password().value).toMatch(/^[a-zA-Z0-9]{12}$/)
  })
})
