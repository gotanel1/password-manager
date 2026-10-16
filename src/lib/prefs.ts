// Per-device, non-secret preferences. Never put vault contents here.
export type Prefs = { theme: "light" | "dark" | "system"; autoLockMin: number; clipboardSec: number }

const KEY = "vault-prefs"
const DEFAULTS: Prefs = { theme: "light", autoLockMin: 5, clipboardSec: 30 }

export function loadPrefs(): Prefs {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") } } catch { return DEFAULTS }
}
export function savePrefs(p: Prefs) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* private mode: keep in memory */ }
}

let clipTimer: number | undefined
export async function copyText(text: string, clearAfterSec: number) {
  await navigator.clipboard.writeText(text)
  window.clearTimeout(clipTimer)
  clipTimer = window.setTimeout(() => navigator.clipboard.writeText("").catch(() => {}), clearAfterSec * 1000)
}

export function download(name: string, content: string, type = "application/json") {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(new Blob([content], { type }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}
