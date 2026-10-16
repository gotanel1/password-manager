// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { copyText, loadPrefs, savePrefs } from "../src/lib/prefs"

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear() })
describe("device preferences and clipboard", () => {
  it("stores preferences without vault content and falls back for broken JSON", () => {
    savePrefs({ theme: "dark", autoLockMin: 1, clipboardSec: 15 })
    expect(loadPrefs()).toEqual({ theme: "dark", autoLockMin: 1, clipboardSec: 15 })
    localStorage.setItem("vault-prefs", "broken json")
    expect(loadPrefs().autoLockMin).toBe(5)
  })
  it("clears after the latest copy and tolerates a denied background clear", async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    await copyText("test-one", 15)
    await vi.advanceTimersByTimeAsync(10_000)
    await copyText("test-two", 15)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(writeText).toHaveBeenCalledTimes(2)
    writeText.mockRejectedValueOnce(new Error("denied"))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(writeText).toHaveBeenLastCalledWith("")
  })
  it("reports rejected copy access", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } })
    await expect(copyText("test", 15)).rejects.toThrow("denied")
  })
  it("rejects invalid preference values that could disable auto-lock", () => {
    localStorage.setItem("vault-prefs", JSON.stringify({ theme: "unknown", autoLockMin: "never", clipboardSec: -1 }))
    expect(loadPrefs()).toEqual({ theme: "light", autoLockMin: 5, clipboardSec: 30 })
  })
})
