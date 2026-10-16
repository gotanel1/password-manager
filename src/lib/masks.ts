// Input masks: reformat a field as the user types. Each takes the new raw value and the previous
// formatted value (to tell typing from deleting) and returns what the input should show.
type Mask = (next: string, prev: string) => string

const onlyDigits = (v: string, max: number) => v.replace(/\D/g, "").slice(0, max)

/** American Express groups 4-6-5; everything else groups by 4. */
export function formatCardNumber(v: string) {
  const d = onlyDigits(v, 19)
  const groups = /^3[47]/.test(d) ? [4, 6, 5] : [4, 4, 4, 4, 3]
  const out: string[] = []
  let i = 0
  for (const g of groups) {
    if (i >= d.length) break
    out.push(d.slice(i, i + g))
    i += g
  }
  return out.join(" ")
}

/** MM/YY: pads single-digit months ("4" → "04/"), never lets the month exceed 12. */
export function formatExpiry(next: string, prev = "") {
  const deleting = next.length < prev.length
  // Feed digits one at a time, so pasting "3029" behaves like typing it: 3 → 03, then 0, 2.
  let d = ""
  for (const c of next.replace(/\D/g, "")) {
    if (d.length === 0) d = Number(c) > 1 ? `0${c}` : c
    else if (d.length === 1) { const m = Number(d + c); if (m >= 1 && m <= 12) d += c }
    else if (d.length < 4) d += c
  }
  if (d.length < 2) return d
  // Add the slash while typing, but let backspace remove it instead of re-adding it.
  if (d.length === 2) return deleting && !next.includes("/") ? d : `${d}/`
  return `${d.slice(0, 2)}/${d.slice(2)}`
}

export const MASKS: Record<string, Mask> = {
  cardNumber: (v) => formatCardNumber(v),
  expiry: formatExpiry,
  cvv: (v) => onlyDigits(v, 4),
  pin: (v) => onlyDigits(v, 12),
  accountNumber: (v) => v.replace(/[^\d-]/g, "").replace(/-{2,}/g, "-").slice(0, 24),
  phone: (v) => v.replace(/[^\d\s+()-]/g, "").slice(0, 20),
}

export const applyMask = (key: string, next: string, prev: string) => (MASKS[key] ? MASKS[key](next, prev) : next)
