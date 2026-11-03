// Pont entre l'app i el servidor propi. Imita l'API window.claude.use(...) de Claude
// (db, assets, sample, downloads) perquè l'app funcioni igual fora de Claude.
(function () {
  "use strict";

  const err = (code, message) => Object.assign(new Error(message || code), { code });

  async function call(method, path, body, headers) {
    let res;
    try {
      res = await fetch(path, { method, credentials: "same-origin", headers: body === undefined ? headers : (headers || { "content-type": "application/json" }), body: body === undefined ? undefined : (headers ? body : JSON.stringify(body)) });
    } catch { throw err("unavailable", "Sense connexió"); }
    if (res.status === 401) { location.reload(); throw err("unauthenticated"); }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw err((data && data.error && data.error.code) || "unavailable", data && data.error && data.error.message);
    return data;
  }

  // ---------------- db (estil Firestore, simplificat) ----------------
  const cache = {};          // col -> Map(id -> data)
  const loaded = {};         // col -> Promise
  const listeners = {};      // col -> Set(fn)

  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function snapDocs(col, q) {
    let arr = [...(cache[col] || new Map()).entries()].map(([id, d]) => ({ id, d }));
    if (q.order) {
      const [f, dir] = q.order; const s = dir === "desc" ? -1 : 1;
      arr.sort((a, b) => { const x = a.d[f], y = b.d[f]; return (x === y ? 0 : x == null ? -1 : y == null ? 1 : x < y ? -1 : 1) * s; });
    }
    if (q.lim) arr = arr.slice(0, q.lim);
    return arr.map(({ id, d }) => ({ id, exists: true, data: () => clone(d) }));
  }
  function notify(col) { for (const fn of listeners[col] || []) { try { fn(); } catch (e) { console.error(e); } } }
  async function fetchCol(col) {
    const r = await call("GET", "/api/db/" + col);
    cache[col] = new Map(r.docs.map(x => [x.id, x.data]));
    notify(col);
  }
  function ensure(col) { if (!loaded[col]) loaded[col] = fetchCol(col).catch(e => { loaded[col] = null; throw e; }); return loaded[col]; }

  // Torna a llegir les dades quan tornes a l'app (per si has canviat alguna cosa des d'un altre aparell).
  let lastSync = Date.now();
  function resync() { if (Date.now() - lastSync < 15000) return; lastSync = Date.now(); for (const col of Object.keys(listeners)) if (listeners[col].size) fetchCol(col).catch(() => {}); }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") resync(); });
  window.addEventListener("focus", resync);
  setInterval(() => { if (document.visibilityState === "visible") resync(); }, 120000);

  function query(col, q) {
    return {
      orderBy(f, dir) { return query(col, { ...q, order: [f, dir || "asc"] }); },
      limit(n) { return query(col, { ...q, lim: n }); },
      async get() { await ensure(col); return { docs: snapDocs(col, q), size: snapDocs(col, q).length, empty: !snapDocs(col, q).length }; },
      onSnapshot(next, onErr) {
        const fn = () => next({ docs: snapDocs(col, q), get size() { return this.docs.length; }, get empty() { return !this.docs.length; } });
        (listeners[col] = listeners[col] || new Set()).add(fn);
        ensure(col).then(() => { if (cache[col]) fn(); }, e => onErr && onErr(e));
        return () => listeners[col].delete(fn);
      },
    };
  }
  function collection(col) {
    const q = query(col, {});
    q.add = async (data) => {
      const r = await call("POST", "/api/db/" + col, { data });
      (cache[col] = cache[col] || new Map()).set(r.id, r.data); notify(col);
      return { id: r.id };
    };
    q.doc = (id) => docRef(col + "/" + (id || newId()));
    return q;
  }
  function newId() { return [...crypto.getRandomValues(new Uint8Array(10))].map(b => b.toString(16).padStart(2, "0")).join(""); }
  function docRef(path) {
    const [col, id] = String(path).split("/");
    return {
      id,
      async get() { const r = await call("GET", "/api/db/" + col + "/" + id).catch(e => { if (e.code === "not_found") return null; throw e; }); return { id, exists: !!r, data: () => r ? r.data : undefined }; },
      async set(data) { const r = await call("PUT", "/api/db/" + col + "/" + id, { data }); (cache[col] = cache[col] || new Map()).set(id, r.data); notify(col); },
      async update(data) { const r = await call("PATCH", "/api/db/" + col + "/" + id, { data }); (cache[col] = cache[col] || new Map()).set(id, r.data); notify(col); },
      async delete() { await call("DELETE", "/api/db/" + col + "/" + id); if (cache[col]) cache[col].delete(id); notify(col); },
    };
  }
  const db = Object.freeze({ collection, doc: docRef });

  // ---------------- assets (fitxers) ----------------
  const assets = Object.freeze({
    async upload(blob, opts) {
      const type = (opts && opts.type) || blob.type || "application/octet-stream";
      if (blob.size > 20 * 1024 * 1024) throw err("too_large");
      return call("POST", "/api/blob" + (opts && opts.id ? "?id=" + encodeURIComponent(opts.id) : ""), blob, { "content-type": type });
    },
    async delete(id) { await call("DELETE", "/api/blob/" + encodeURIComponent(id)); },
    async list() { const r = await call("GET", "/api/blobs"); return { assets: r.blobs.map(b => ({ id: b.id, url: "/_blob/" + b.id, contentType: b.type, sizeBytes: b.size })), usage: {} }; },
  });

  // ---------------- downloads ----------------
  const downloads = Object.freeze({
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename || "fitxer";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      return { saved: true };
    },
  });

  // ---------------- sample (escaneig amb Claude, via el servidor) ----------------
  function blobToB64(b) {
    return new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = () => ko(err("image_rejected")); r.readAsDataURL(b); });
  }
  async function ask(input, opts, asJson) {
    opts = opts || {};
    if (opts.signal && opts.signal.aborted) throw err("cancelled");
    let prompt = input;
    if (Array.isArray(input)) prompt = input.map(m => (m.role === "assistant" ? "Assistent: " : "") + m.content).join("\n\n");
    const images = [];
    for (const b of opts.images || []) {
      let type = b.type || "image/jpeg";
      if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) type = "image/jpeg";
      images.push({ type, data: await blobToB64(b) });
    }
    const content = images.map(im => ({ type: "image", source: { type: "base64", media_type: im.type, data: im.data } }));
    content.push({ type: "text", text: String(prompt) });
    const system = asJson
      ? "Ets l'assistent d'una aplicació de gestió de lloguers. Respon NOMÉS amb JSON vàlid (un objecte o una llista), sense cap text abans ni després i sense blocs de codi."
      : "Ets l'assistent d'una aplicació de gestió de lloguers. Respon en català.";
    const body = JSON.stringify({ model: await aiModel(), max_tokens: 8000, system, messages: [{ role: "user", content }] });
    if (body.length > 30 * 1024 * 1024) throw err("too_large");
    let res;
    try {
      res = await fetch("/api/ai", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body, signal: opts.signal });
    } catch (e) { if (opts.signal && opts.signal.aborted) throw err("cancelled"); throw err("upstream_error"); }
    if (res.status === 401) { location.reload(); throw err("unauthenticated"); }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw err((data && data.error && data.error.code) || "upstream_error", data && data.error && data.error.message);
    if (opts.onText) { try { opts.onText({ text: data.text, delta: data.text }); } catch {} }
    return data;
  }
  let modelP = null;
  function aiModel() { if (!modelP) modelP = call("GET", "/api/ai/config").then(r => r.model).catch(e => { modelP = null; throw e; }); return modelP; }
  function parseJson(text) {
    let t = String(text || "").trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) t = fence[1].trim();
    try { return JSON.parse(t); } catch {}
    const i = t.search(/[\[{]/); if (i < 0) throw Object.assign(err("invalid_json"), { text });
    const open = t[i], close = open === "{" ? "}" : "]";
    const j = t.lastIndexOf(close);
    try { return JSON.parse(t.slice(i, j + 1)); } catch { throw Object.assign(err("invalid_json"), { text }); }
  }
  const sample = async (input, opts) => { const d = await ask(input, opts, false); return { text: d.text, truncated: !!d.truncated }; };
  sample.json = async (input, opts) => { const d = await ask(input, opts, true); return parseJson(d.text); };
  sample.limits = async () => ({ inputBytes: 4000000, images: { maxCount: 20, maxBytes: 5000000 } });
  Object.freeze(sample);

  const caps = { db, assets, downloads, sample };
  window.claude = Object.freeze({ use: (name) => new Promise(r => setTimeout(() => r(caps[name] || null), 0)) });
  window.LLOGUERS_STANDALONE = true;

  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
})();
