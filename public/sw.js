// Service worker mínim: permet instal·lar l'app. Les dades, els documents i la icona sempre vénen del servidor.
const CACHE = "lloguers-v7";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
const SKIP = /^\/(api|_blob|icons)\/|^\/(icon-192\.png|icon-512\.png|apple-touch-icon\.png|favicon\.ico|manifest\.webmanifest|splash\.jpg|splash-wide\.jpg)$/;
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || SKIP.test(url.pathname)) return;
  // Primer la xarxa; si no n'hi ha, la darrera còpia guardada.
  e.respondWith(fetch(req).then(res => { if (res.ok && !(res.headers.get("content-type") || "").includes("text/html")) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return res; }).catch(() => caches.match(req)));
});

// Avisos: el servidor envia una notificació buida i aquí es demana el text (amb la sessió de l'usuari).
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let m = { title: "Els meus lloguers", body: "Tens lloguers pendents d'anotar. Obre l'app." };
    try { const r = await fetch("/api/push/message", { credentials: "same-origin", cache: "no-store" }); if (r.ok) m = await r.json(); } catch {}
    await self.registration.showNotification(m.title, { body: m.body, icon: "/icons/edifici-192.png", badge: "/badge.png", tag: "lloguers", renotify: true, data: { url: "/" } });
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if (new URL(c.url).origin === location.origin) { await c.focus(); return; } }
    await clients.openWindow("/");
  })());
});
