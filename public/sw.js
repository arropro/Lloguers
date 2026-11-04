// Service worker mínim: permet instal·lar l'app. Les dades i els documents sempre vénen del servidor.
const CACHE = "lloguers-v3";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(["/icon-192.png", "/icon-512.png"])).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/_blob/")) return;
  // Primer la xarxa; si no n'hi ha, la darrera còpia guardada.
  e.respondWith(fetch(req).then(res => { if (res.ok && res.headers.get("content-type")?.includes("text/html") === false) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return res; }).catch(() => caches.match(req)));
});
