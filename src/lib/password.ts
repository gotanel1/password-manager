/** Unbiased random integer in [0, max). */
export function randInt(max: number) {
  const lim = Math.floor(0x1_0000_0000 / max) * max
  const a = new Uint32Array(1)
  do crypto.getRandomValues(a)
  while (a[0] >= lim)
  return a[0] % max
}

/** Every symbol the generator can use. */
export const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?"
/** The symbols most sign-up forms accept, for sites that reject brackets and punctuation. */
export const COMMON_SYMBOLS = "!@#$%*-_"

/** Keeps only symbols (no letters, digits or spaces), each once, in the order typed. */
export const cleanSymbols = (s: string) => [...new Set([...s])].filter((c) => /^[^\sa-zA-Z0-9]$/.test(c)).join("")

/** `symbolSet` narrows the symbols to the ones a site accepts; an empty set means no symbols. */
export type GenOptions = { length: number; upper: boolean; numbers: boolean; symbols: boolean; avoidAmbiguous: boolean; symbolSet?: string }

export const DEFAULT_GEN: GenOptions = { length: 20, upper: true, numbers: true, symbols: true, avoidAmbiguous: true, symbolSet: SYMBOLS }

export function randomPassword(o: GenOptions) {
  const sets = [o.avoidAmbiguous ? "abcdefghijkmnpqrstuvwxyz" : "abcdefghijklmnopqrstuvwxyz"]
  if (o.upper) sets.push(o.avoidAmbiguous ? "ABCDEFGHJKLMNPQRSTUVWXYZ" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ")
  if (o.numbers) sets.push(o.avoidAmbiguous ? "23456789" : "0123456789")
  const symbols = cleanSymbols(o.symbolSet ?? SYMBOLS)
  if (o.symbols && symbols) sets.push(symbols)
  const all = sets.join("")
  const out = sets.map((s) => s[randInt(s.length)]) // at least one of each enabled class
  while (out.length < o.length) out.push(all[randInt(all.length)])
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.slice(0, o.length).join("")
}

// Short, common, unambiguous English words: easy to type on any keyboard layout.
const WORDS = (
  "acid aged also arch area army atom aunt away axis baby back bake ball band bank barn base bath bead beam bean bear beef bell belt bend best bike bird blue boat body bold bolt bone book boot born boss bowl bulb bush busy cafe cage cake calm camp cape card care cart case cash cast cave cell chef chin chip city clay clip club coal coat code coin cold cone cook cool cord corn cost crab crew crop crow cube cure dark dart dash dawn deck deer desk dial dice dish dock dome door dose dove draw drum duck dune dust echo edge envy epic face fact fair farm fern film fire fish flag flat fog foil folk fork form fox frog fuel gate gear gift glow glue goat gold golf gown grid grip gulf hair half hall hand harp hawk heat herb hero hill hint hive hook horn host hour hunt iron isle jade jail jazz jeep joke jump jury kale keen kelp kick kind king kite kiwi knee knot lace lady lake lamp land lane lava lawn leaf lens lily lime line lion list loaf lock loft loop lord luck lung mail malt mane map mask mast maze meal mesh mile milk mill mint mist mode mole moon moss moth mule myth nail navy neck nest news node noon note oak oath oboe odor oven owl pack page palm park path peak pear pine pink pipe plan plum poem pole pond pony pool port pump quiz raft rail rain ramp reef rice ring road robe rock roof root rope rose ruby rule sage sail salt sand seal seed ship shoe silk sink size sled snow soap sock sofa soil song soup star stem step swan tale tank taxi team tent tide tile time toad tool tour town tree trio tube tuna twig vase veil vest view vine void vote wage wall wand wave wax well whip wick wind wing wolf wood wool yard yarn year yoga zinc zone"
).split(" ")

export function passphrase(words: number) {
  const parts = Array.from({ length: words }, () => WORDS[randInt(WORDS.length)])
  parts[randInt(parts.length)] += String(randInt(100))
  return parts.join("-")
}

export const pin = (length: number) => Array.from({ length }, () => randInt(10)).join("")

export function bits(p: string) {
  if (!p) return 0
  if (/^[a-z]+(?:\d+)?(?:-[a-z]+(?:\d+)?)+$/.test(p)) {
    // passphrase from our list: count words, not characters
    return p.split("-").length * Math.log2(WORDS.length) + Math.log2(100)
  }
  let pool = 0
  if (/[a-z]/.test(p)) pool += 26
  if (/[A-Z]/.test(p)) pool += 26
  if (/\d/.test(p)) pool += 10
  if (/[^a-zA-Z\d]/.test(p)) pool += 33
  let b = p.length * Math.log2(pool || 1)
  // Penalise obvious patterns: repeats, sequences, common words
  if (/(.)\1{2,}/.test(p)) b *= 0.8
  if (/(?:1234|abcd|qwer|asdf|password|admin|letmein|1111|0000)/i.test(p)) b *= 0.5
  if (/^[A-Za-z]+(?:19|20)\d{2}\W?$/.test(p)) b *= 0.6 // Word + year, e.g. Summer2025!
  return b
}

export type Strength = { level: 0 | 1 | 2 | 3 | 4; label: string; crack: string }

export function strength(p: string): Strength {
  const b = bits(p)
  const level = (!p ? 0 : b < 40 ? 1 : b < 60 ? 2 : b < 80 ? 3 : 4) as Strength["level"]
  const label = ["", "อ่อน", "พอใช้", "แข็งแรง", "แข็งแรงมาก"][level]
  return { level, label, crack: crackTime(b) }
}

/** Offline attack at 10^10 guesses/s, average case. */
function crackTime(b: number) {
  const s = Math.pow(2, b) / 2 / 1e10
  if (s < 1) return "คาดเดาได้ทันที"
  const units: [number, string][] = [[60, "วินาที"], [60, "นาที"], [24, "ชั่วโมง"], [365, "วัน"], [100, "ปี"]]
  let v = s
  for (const [n, name] of units) {
    if (v < n) return `ใช้เวลาคาดเดาประมาณ ${Math.max(1, Math.round(v))} ${name}`
    v /= n
  }
  v *= 100 // back to years
  if (v < 1e6) return `ใช้เวลาคาดเดาประมาณ ${Math.round(v).toLocaleString("th-TH")} ปี`
  return "ใช้เวลาคาดเดามากกว่า 1 ล้านปี"
}
