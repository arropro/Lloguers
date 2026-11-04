// Service worker mínim: permet instal·lar l'app. Les dades, els documents i la icona sempre vénen del servidor.
const CACHE = "lloguers-v5";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
const SKIP = /^\/(api|_blob|icons)\/|^\/(icon-192\.png|icon-512\.png|apple-touch-icon\.png|favicon\.ico|manifest\.webmanifest|splash\.jpg|splash-wide\.jpg)$/;
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || SKIP.test(url.pathname)) return;
  // Primer la xarxa; si no n'hi ha, la darrera còpia guardada.
  e.respondWith(fetch(req).then(res => { if (res.ok && !(res.headers.get("content-type") || "").includes("text/html")) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return res; }).catch(() => caches.match(req)));
});
