// Shows public/offline.html when a page load fails without a network connection.
// Never caches app code or vault data: every page load still fetches the current build,
// so an outdated copy of the encryption code can never be served from this device.
const CACHE = "offline-v1"
const OFFLINE = "/offline.html"

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE, { cache: "reload" }))))
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    await self.registration.navigationPreload?.enable()
    await self.clients.claim()
  })())
})

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return
  event.respondWith((async () => {
    try {
      return (await event.preloadResponse) ?? await fetch(event.request)
    } catch {
      return (await caches.match(OFFLINE)) ?? Response.error()
    }
  })())
})
