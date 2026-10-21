import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url))
const text = (path: string) => read(path).toString("utf8")
const pngSize = (path: string) => { const png = read(path); return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}` }

describe("installable app (PWA)", () => {
  const manifest = JSON.parse(text("public/manifest.webmanifest"))

  it("has the manifest fields browsers need to install it", () => {
    expect(manifest).toMatchObject({ id: "/", start_url: "/", scope: "/", display: "standalone", lang: "th" })
    expect(manifest.name).toBeTruthy()
    expect(manifest.short_name.length).toBeLessThanOrEqual(12)
  })

  it("ships every icon at the size the manifest declares", () => {
    for (const icon of manifest.icons) expect(pngSize(`public${icon.src}`)).toBe(icon.sizes)
    const any = manifest.icons.filter((icon: { purpose: string }) => icon.purpose === "any").map((icon: { sizes: string }) => icon.sizes)
    expect(any).toEqual(expect.arrayContaining(["192x192", "512x512"]))
    expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === "maskable")).toBe(true)
  })

  it("links the manifest and Apple icon from the page", () => {
    const html = text("index.html")
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
    const apple = html.match(/rel="apple-touch-icon" href="([^"]+)"/)?.[1]
    expect(pngSize(`public${apple}`)).toBe("180x180")
  })

  it("keeps fields at 16px on phones so iOS does not zoom into them, without disabling zoom", () => {
    const viewport = text("index.html").match(/name="viewport" content="([^"]+)"/)![1]
    expect(viewport).not.toMatch(/user-scalable|maximum-scale/)
    const phone = text("src/index.css").match(/@media \(max-width: 740px\) \{\s*input, textarea, select,[^}]*font-size: 16px;/)
    expect(phone).not.toBeNull()
  })

  it("lets the CSP load the manifest and the worker", () => {
    const csp = text("netlify.toml").match(/Content-Security-Policy = "([^"]+)"/)![1]
    expect(csp).toContain("manifest-src 'self'")
    expect(csp).toContain("worker-src 'self'")
    // The worker inherits this CSP, so it needs connect-src 'self' to fetch /offline.html and pages
    expect(csp).toMatch(/connect-src 'self' /)
  })
})

describe("service worker", () => {
  type Listener = (event: any) => void
  function load(network: () => Promise<Response>) {
    const listeners: Record<string, Listener> = {}
    const cached = new Map<string, Response>()
    const caches = {
      open: async () => ({ add: async (req: Request) => { cached.set(new URL(req.url).pathname, new Response("offline page")) } }),
      keys: async () => ["offline-v1"],
      delete: async () => true,
      match: async (path: string) => cached.get(path),
    }
    const self = {
      addEventListener: (type: string, fn: Listener) => { listeners[type] = fn },
      skipWaiting: () => {},
      registration: { navigationPreload: { enable: async () => {} } },
      clients: { claim: async () => {} },
    }
    const RequestAt = class extends Request { constructor(url: string, init?: RequestInit) { super(new URL(url, "https://vault.test"), init) } }
    runInNewContext(text("public/sw.js"), { self, caches, fetch: network, Request: RequestAt, Response })
    const fire = async (type: string, extra: object = {}) => {
      let waited: Promise<unknown> | undefined
      let responded: Promise<Response> | undefined
      listeners[type]({ waitUntil: (p: Promise<unknown>) => { waited = p }, respondWith: (p: Promise<Response>) => { responded = p }, ...extra })
      await waited
      return responded
    }
    return { fire, cached }
  }

  it("precaches only the offline page", async () => {
    const sw = load(() => Promise.reject(new Error("offline")))
    await sw.fire("install")
    expect([...sw.cached.keys()]).toEqual(["/offline.html"])
  })

  it("always loads pages from the network when online", async () => {
    const sw = load(async () => new Response("current build"))
    await sw.fire("install")
    const response = await sw.fire("fetch", { request: { mode: "navigate" }, preloadResponse: Promise.resolve(undefined) })
    expect(await response!.text()).toBe("current build")
  })

  it("shows the offline page only when the network fails", async () => {
    const sw = load(() => Promise.reject(new TypeError("Failed to fetch")))
    await sw.fire("install")
    const response = await sw.fire("fetch", { request: { mode: "navigate" }, preloadResponse: Promise.resolve(undefined) })
    expect(await response!.text()).toBe("offline page")
  })

  it("leaves scripts and Supabase requests alone", async () => {
    const sw = load(async () => new Response("unused"))
    expect(await sw.fire("fetch", { request: { mode: "cors" } })).toBeUndefined()
    expect(await sw.fire("fetch", { request: { mode: "no-cors" } })).toBeUndefined()
  })
})
