// Els meus lloguers — servidor (Cloudflare Worker + D1 per a les dades + KV per als fitxers).
// Secrets necessaris (mai al codi): APP_PASSWORD, SESSION_SECRET, ANTHROPIC_API_KEY.
// Variable opcional: AI_MODEL (per defecte claude-sonnet-5-5).
// Les taules es creen soles el primer cop (no cal executar cap SQL a mà).

const SESSION_DAYS = 365;
const COLLECTIONS = new Set(["props", "contracts", "moves", "docs", "inbox"]);
const MAX_BLOB = 20 * 1024 * 1024;          // 20 MB per document
const DEFAULT_MODEL = "claude-sonnet-5-5";

// ---------- utilitats ----------
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });
const err = (code, status, message = "") => json({ error: { code, message } }, status);

const enc = new TextEncoder();
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(text));
  return b64url(new Uint8Array(sig));
}
async function sha256(text) { return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(text)))); }
function b64url(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function sameString(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
async function passwordOk(input, real) { const [a, b] = await Promise.all([sha256(input), sha256(real)]); let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
function newId() { const b = crypto.getRandomValues(new Uint8Array(16)); return [...b].map(x => x.toString(16).padStart(2, "0")).join(""); }
const validId = id => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);

function getCookie(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
async function makeSession(env) { const exp = Date.now() + SESSION_DAYS * 864e5; return `${exp}.${await hmac(env.SESSION_SECRET, String(exp))}`; }
async function isLoggedIn(request, env) {
  const t = getCookie(request, "session"); if (!t) return false;
  const [exp, sig] = t.split("."); if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return sameString(sig, await hmac(env.SESSION_SECRET, exp));
}
const cookie = (v, maxAge) => `session=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// ---------- base de dades ----------
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (col, id))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, type TEXT NOT NULL, size INTEGER NOT NULL, created INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS login_fail (ip TEXT NOT NULL, ts INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, created INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS ai_usage (month TEXT PRIMARY KEY, calls INTEGER NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL)"),
  ]);
  schemaReady = true;
}

async function listCol(env, col) {
  const { results } = await env.DB.prepare("SELECT id, data FROM docs WHERE col = ?").bind(col).all();
  return results.map(r => ({ id: r.id, data: JSON.parse(r.data) }));
}
async function getDoc(env, col, id) {
  const r = await env.DB.prepare("SELECT data FROM docs WHERE col = ? AND id = ?").bind(col, id).first();
  return r ? JSON.parse(r.data) : null;
}
async function putDoc(env, col, id, data) {
  const s = JSON.stringify(data);
  if (s.length > 900000) throw Object.assign(new Error("too_large"), { code: "too_large" });
  await env.DB.prepare("INSERT INTO docs (col, id, data, updated) VALUES (?, ?, ?, ?) ON CONFLICT(col, id) DO UPDATE SET data = excluded.data, updated = excluded.updated")
    .bind(col, id, s, Date.now()).run();
}
// Actualització estil Firestore: les claus amb punts ("a.b") modifiquen camps interns; null no esborra (es desa com a null).
function applyUpdate(base, patch) {
  const out = structuredClone(base || {});
  for (const [k, v] of Object.entries(patch || {})) {
    if (!k.includes(".")) { out[k] = v; continue; }
    const parts = k.split("."); let o = out;
    for (let i = 0; i < parts.length - 1; i++) { if (typeof o[parts[i]] !== "object" || o[parts[i]] === null) o[parts[i]] = {}; o = o[parts[i]]; }
    o[parts[parts.length - 1]] = v;
  }
  return out;
}

// ---------- documents (fitxers) ----------
// Els fitxers es guarden a KV tal qual (sense convertir), i a D1 només la llista (id, tipus, mida).
async function putBlob(env, id, type, body, size) {
  await env.BLOBS.put("b:" + id, body, { metadata: { type } });
  await env.DB.prepare("INSERT INTO blobs (id, type, size, created) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET type = excluded.type, size = excluded.size")
    .bind(id, type, size, Date.now()).run();
}
async function getBlob(env, id) {
  const r = await env.BLOBS.getWithMetadata("b:" + id, { type: "stream" });
  if (!r || !r.value) return null;
  return { type: (r.metadata && r.metadata.type) || "application/octet-stream", body: r.value };
}
async function deleteBlob(env, id) {
  await env.BLOBS.delete("b:" + id);
  await env.DB.prepare("DELETE FROM blobs WHERE id = ?").bind(id).run();
}
const ALLOWED_TYPES = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf|text\/(plain|csv)|application\/json)$/;

// ---------- IA (Claude) ----------
// El navegador prepara la petició sencera per a l'API d'Anthropic; el servidor només hi afegeix la clau
// (que mai surt del servidor) i la reenvia tal qual, sense llegir-la, per no gastar temps de càlcul.
async function askClaude(env, request) {
  if (!env.ANTHROPIC_API_KEY) return err("not_granted", 503, "Falta el secret ANTHROPIC_API_KEY");
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: request.body,
    });
  } catch { return err("upstream_error", 502); }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || "";
    if (res.status === 429 || res.status === 529) return err("rate_limited", 429, msg);
    if (res.status === 401 || res.status === 403) return err("not_granted", 503, "Clau d'Anthropic no vàlida");
    if (res.status === 400 && /credit|balance|billing/i.test(msg)) return err("rate_limited", 402, "Sense saldo a Anthropic");
    if (res.status === 400 && /image/i.test(msg)) return err("image_rejected", 400, msg);
    if (res.status === 413) return err("too_large", 413, msg);
    return err("upstream_error", 502, msg);
  }
  const text = (data.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  if (data.stop_reason === "refusal") return err("refused", 422);
  if (!text.trim()) return err("empty_completion", 422);
  try {
    const u = data.usage || {}; const month = new Date().toISOString().slice(0, 7);
    await env.DB.prepare("INSERT INTO ai_usage (month, calls, input, output) VALUES (?, 1, ?, ?) ON CONFLICT(month) DO UPDATE SET calls = calls + 1, input = input + excluded.input, output = output + excluded.output")
      .bind(month, (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), u.output_tokens || 0).run();
  } catch { /* el comptador no és imprescindible */ }
  return json({ text, truncated: data.stop_reason === "max_tokens" });
}


// ---------- avisos al mòbil (Web Push) ----------
// Les claus VAPID es creen soles el primer cop i es guarden a la base de dades (no cal cap secret).
// Les notificacions s'envien sense contingut; el mòbil demana el text a /api/push/message (amb la sessió).
async function vapidKeys(env){
  const r = await env.DB.prepare("SELECT v FROM settings WHERE k = 'vapid'").first();
  if (r) return JSON.parse(r.v);
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const priv = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const keys = { priv, pub: b64url(pub) };
  await env.DB.prepare("INSERT OR IGNORE INTO settings (k, v) VALUES ('vapid', ?)").bind(JSON.stringify(keys)).run();
  const again = await env.DB.prepare("SELECT v FROM settings WHERE k = 'vapid'").first();
  return JSON.parse(again.v);
}
async function sendPush(env, endpoint){
  const keys = await vapidKeys(env), u = new URL(endpoint);
  const head = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64url(enc.encode(JSON.stringify({ aud: u.origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:avisos@lloguers.app" })));
  const key = await crypto.subtle.importKey("jwk", keys.priv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + body)));
  const res = await fetch(endpoint, { method: "POST", headers: { TTL: "86400", Urgency: "normal", Authorization: `vapid t=${head}.${body}.${b64url(sig)}, k=${keys.pub}` } });
  if (res.status === 404 || res.status === 410) await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(endpoint).run();
  return res.status;
}
const madrid = (d = new Date()) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(d).map(x => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, ym: `${p.year}-${p.month}`, day: +p.day, hour: +p.hour % 24 }; };
const MESOS = ["gener","febrer","març","abril","maig","juny","juliol","agost","setembre","octubre","novembre","desembre"];
const eurCa = n => (Math.round(n * 100) / 100).toLocaleString("ca-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
// Lloguers del mes que encara no s'han anotat com a cobrats.
async function pendingRents(env){
  const t = madrid(), mo = t.ym, td = t.date;
  const props = (await listCol(env, "props")), pmap = Object.fromEntries(props.map(p => [p.id, p.data]));
  const cons = (await listCol(env, "contracts")).filter(c => pmap[c.data.propId]);
  const moves = (await listCol(env, "moves")).map(m => m.data).filter(m => m.type === "ingres" && m.category === "Lloguer" && (m.period || String(m.date || "").slice(0, 7)) === mo);
  const out = [];
  for (const { id, data: c } of cons) {
    if (c.start && c.start > td) continue;
    if (c.end && (c.end < td || (c.ended && c.end <= td))) continue;
    if ((c.unpaid || []).includes(mo)) continue;
    if (moves.some(m => m.contractId ? m.contractId === id : m.propId === c.propId)) continue;
    let rent = +c.rent || 0; (c.rents || []).filter(x => x && x.from && x.from <= mo).sort((a, b) => a.from.localeCompare(b.from)).forEach(x => { if (+x.amount > 0) rent = +x.amount; });
    const extra = (c.extras || []).filter(x => x && x.freq === "mensual").reduce((a, x) => a + (+x.amount || 0), 0);
    out.push({ name: pmap[c.propId].name || "Pis", amount: c.priceMode === "total" ? 0 : rent + extra });
  }
  return { mo, items: out };
}
async function reminderText(env){
  const { mo, items } = await pendingRents(env), mes = MESOS[+mo.slice(5, 7) - 1];
  if (!items.length) return null;
  const list = items.map(i => i.amount ? `${i.name} (${eurCa(i.amount)})` : i.name).join(", ");
  return { title: `Lloguers de ${mes}`, body: `Pendents d'anotar: ${list}. Si ja els has cobrat, toca ✓ a l'app.` };
}
async function dailyReminder(env){
  const t = madrid();
  if (t.hour !== 10 || t.day < 5 || t.day > 10) return;          // del dia 5 al 10, a les 10:30 (hora de Madrid)
  const msg = await reminderText(env); if (!msg) return;
  await env.DB.prepare("INSERT INTO settings (k, v) VALUES ('push_msg', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify(msg)).run();
  const { results } = await env.DB.prepare("SELECT endpoint FROM push_subs").all();
  for (const r of results) { try { await sendPush(env, r.endpoint); } catch {} }
}

// ---------- pàgina d'entrada ----------
const LOGIN_HTML = (msg = "") => `<!doctype html><html lang="ca"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Els meus lloguers</title><meta name="theme-color" content="#0B1430"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="icon" href="/icon-192.png">
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(160deg,#1B2A5C,#0B1430);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#E8EDFB;padding:24px}
form{width:100%;max-width:340px;text-align:center}img{width:96px;height:96px;border-radius:24px;box-shadow:0 10px 30px #0006}h1{font-size:22px;margin:18px 0 6px}p{margin:0 0 22px;color:#9FB0DD;font-size:14px}
input{width:100%;padding:14px 16px;border-radius:14px;border:1px solid #33457f;background:#0E1838;color:#fff;font-size:16px;outline:none}input:focus{border-color:#FFC23D}
button{margin-top:12px;width:100%;padding:14px;border:0;border-radius:14px;background:#FFC23D;color:#1a1300;font-weight:700;font-size:16px;cursor:pointer}.e{color:#ff9a8a;margin-top:12px;font-size:14px;min-height:1em}</style></head>
<body><form method="post" action="/api/login"><img src="/icon-512.png" alt=""><h1>Els meus lloguers</h1><p>Escriu la contrasenya per entrar</p>
<input type="password" name="password" autocomplete="current-password" placeholder="Contrasenya" required autofocus><button>Entrar</button><div class="e">${msg}</div></form></body></html>`;
const html = (s, status = 200) => new Response(s, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

const PUBLIC_PATHS = new Set(["/sw.js", "/badge.png", "/icons/edifici-192.png"]);

// ---------- icona de l'app (es pot canviar des de "Còpia de seguretat") ----------
const ICONS = ["skyline", "empire-dia", "empire-capvespre", "edifici"];
const DEFAULT_ICON = "skyline";
// Color de fons de cada icona (el fa servir Android a la pantalla que surt just en obrir l'app).
const ICON_BG = { "skyline": "#384250", "empire-dia": "#8A7272", "empire-capvespre": "#4B5156", "edifici": "#0B1430" };
const ICON_FILES = { "/icon-512.png": "512.png", "/icon-192.png": "192.png", "/apple-touch-icon.png": "180.png", "/favicon.ico": "48.png", "/splash.jpg": "splash.jpg", "/splash-wide.jpg": "wide.jpg" };
async function currentIcon(env) {
  try { const r = await env.DB.prepare("SELECT v FROM settings WHERE k = 'icon'").first(); if (r && ICONS.includes(r.v)) return r.v; } catch {}
  return DEFAULT_ICON;
}
function manifest(icon) {
  const v = "?i=" + icon + "&v=2";
  return JSON.stringify({
    name: "Els meus lloguers", short_name: "Lloguers", description: "Gestió dels meus pisos de lloguer", lang: "ca",
    id: "/", start_url: "/", scope: "/", display: "standalone", background_color: ICON_BG[icon] || "#0B1430", theme_color: "#0B1430",
    icons: [
      { src: "/icon-192.png" + v, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png" + v, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png" + v, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  });
}

async function login(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "?";
  const since = Date.now() - 15 * 60e3;
  const fails = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_fail WHERE ip = ? AND ts > ?").bind(ip, since).first();
  if (fails && fails.n >= 8) return html(LOGIN_HTML("Massa intents. Espera 15 minuts."), 429);
  let password = "";
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) password = String((await request.json().catch(() => ({}))).password || "");
  else password = String((await request.formData().catch(() => new FormData())).get("password") || "");
  if (!password || !(await passwordOk(password, env.APP_PASSWORD))) {
    await env.DB.prepare("INSERT INTO login_fail (ip, ts) VALUES (?, ?)").bind(ip, Date.now()).run();
    await env.DB.prepare("DELETE FROM login_fail WHERE ts < ?").bind(since).run();
    await new Promise(r => setTimeout(r, 600));
    return html(LOGIN_HTML("Contrasenya incorrecta."), 401);
  }
  return new Response(null, { status: 303, headers: { location: "/", "set-cookie": cookie(await makeSession(env), SESSION_DAYS * 86400) } });
}

// ---------- rutes ----------
async function api(request, env, url) {
  const p = url.pathname, m = request.method;
  // Dades: /api/db/<col> i /api/db/<col>/<id>
  let r = p.match(/^\/api\/db\/([a-z]+)(?:\/([A-Za-z0-9_-]+))?$/);
  if (r) {
    const [, col, id] = r;
    if (!COLLECTIONS.has(col)) return err("not_found", 404);
    if (!id) {
      if (m === "GET") return json({ docs: await listCol(env, col) });
      if (m === "POST") {
        const body = await request.json().catch(() => null);
        if (!body || typeof body.data !== "object") return err("invalid_request", 400);
        const nid = body.id && validId(body.id) ? body.id : newId();
        await putDoc(env, col, nid, body.data);
        return json({ id: nid, data: body.data });
      }
      return err("method", 405);
    }
    if (m === "GET") { const d = await getDoc(env, col, id); return d ? json({ id, data: d }) : err("not_found", 404); }
    if (m === "PUT") { const body = await request.json().catch(() => null); if (!body || typeof body.data !== "object") return err("invalid_request", 400); await putDoc(env, col, id, body.data); return json({ id, data: body.data }); }
    if (m === "PATCH") {
      const body = await request.json().catch(() => null); if (!body || typeof body.data !== "object") return err("invalid_request", 400);
      const cur = await getDoc(env, col, id); if (!cur) return err("not_found", 404);
      const next = applyUpdate(cur, body.data); await putDoc(env, col, id, next); return json({ id, data: next });
    }
    if (m === "DELETE") { await env.DB.prepare("DELETE FROM docs WHERE col = ? AND id = ?").bind(col, id).run(); return json({ ok: true }); }
    return err("method", 405);
  }
  // Fitxers: POST /api/blob (cos binari), DELETE /api/blob/<id>
  if (p === "/api/blob" && m === "POST") {
    const type = (request.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.test(type)) return err("unsupported_type", 415);
    const len = Number(request.headers.get("content-length") || 0);
    if (!len) return err("invalid_request", 400, "Falta la mida del fitxer");
    if (len > MAX_BLOB) return err("too_large", 413);
    const want = url.searchParams.get("id");
    const id = want && validId(want) ? want : newId();
    await putBlob(env, id, type, request.body, len);
    return json({ id, url: "/_blob/" + id, contentType: type, sizeBytes: len });
  }
  r = p.match(/^\/api\/blob\/([A-Za-z0-9_-]+)$/);
  if (r && m === "DELETE") { await deleteBlob(env, r[1]); return json({ ok: true }); }
  if (p === "/api/blobs" && m === "GET") {
    const { results } = await env.DB.prepare("SELECT id, type, size FROM blobs").all();
    return json({ blobs: results });
  }
  // IA
  if (p === "/api/ai" && m === "POST") return askClaude(env, request);
  if (p === "/api/ai/config" && m === "GET") return json({ model: env.AI_MODEL || DEFAULT_MODEL });
  if (p === "/api/ai/usage" && m === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM ai_usage ORDER BY month DESC LIMIT 12").all();
    return json({ usage: results, model: env.AI_MODEL || DEFAULT_MODEL });
  }
  if (p === "/api/settings" && m === "GET") { const icon = await currentIcon(env); return json({ icon, icons: ICONS, bg: ICON_BG[icon] }); }
  if (p === "/api/settings" && m === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || !ICONS.includes(body.icon)) return err("invalid_request", 400);
    await env.DB.prepare("INSERT INTO settings (k, v) VALUES ('icon', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(body.icon).run();
    return json({ icon: body.icon });
  }
  if (p === "/api/push/key" && m === "GET") return json({ key: (await vapidKeys(env)).pub });
  if (p === "/api/push/subscribe" && m === "POST") {
    const body = await request.json().catch(() => null);
    const ep = body && body.endpoint; if (!ep || !/^https:\/\//.test(ep)) return err("invalid_request", 400);
    await env.DB.prepare("INSERT OR IGNORE INTO push_subs (endpoint, created) VALUES (?, ?)").bind(ep, Date.now()).run();
    return json({ ok: true });
  }
  if (p === "/api/push/unsubscribe" && m === "POST") {
    const body = await request.json().catch(() => null); if (body && body.endpoint) await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(body.endpoint).run();
    return json({ ok: true });
  }
  if (p === "/api/push/test" && m === "POST") {
    const msg = (await reminderText(env)) || { title: "Avisos activats", body: "Així t'arribaran els recordatoris dels lloguers, del dia 5 al 10 de cada mes a les 10:30." };
    await env.DB.prepare("INSERT INTO settings (k, v) VALUES ('push_msg', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify(msg)).run();
    const { results } = await env.DB.prepare("SELECT endpoint FROM push_subs").all(); let ok = 0;
    for (const r of results) { try { const st = await sendPush(env, r.endpoint); if (st < 300) ok++; } catch {} }
    return json({ sent: ok, total: results.length });
  }
  if (p === "/api/push/message" && m === "GET") {
    const r = await env.DB.prepare("SELECT v FROM settings WHERE k = 'push_msg'").first();
    return json(r ? JSON.parse(r.v) : { title: "Els meus lloguers", body: "Obre l'app per veure els avisos." });
  }
  if (p === "/api/logout" && m === "POST") return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  return err("not_found", 404);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => { await ensureSchema(env); await dailyReminder(env); })());
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (!env.APP_PASSWORD || !env.SESSION_SECRET) return html("<h1>Falta configurar</h1><p>Cal posar els secrets APP_PASSWORD i SESSION_SECRET a Cloudflare.</p>", 500);
    if (PUBLIC_PATHS.has(p)) return env.ASSETS.fetch(request);
    try {
      await ensureSchema(env);
      if (ICON_FILES[p] || p === "/manifest.webmanifest") {
        const icon = await currentIcon(env);
        if (p === "/manifest.webmanifest") return new Response(manifest(icon), { headers: { "content-type": "application/manifest+json", "cache-control": "no-cache" } });
        const f = ICON_FILES[p];
        const r = await env.ASSETS.fetch(new Request(url.origin + "/icons/" + icon + "-" + f));
        return new Response(r.body, { status: r.status, headers: { "content-type": f.endsWith(".jpg") ? "image/jpeg" : "image/png", "cache-control": "no-cache" } });
      }
      if (p === "/api/login" && request.method === "POST") return await login(request, env);
      if (p === "/login") return html(LOGIN_HTML());
      const ok = await isLoggedIn(request, env);
      if (!ok) {
        if (p.startsWith("/api/") || p.startsWith("/_blob/")) return err("unauthenticated", 401);
        return html(LOGIN_HTML());
      }
      // Protecció bàsica contra peticions d'altres webs (les escriptures han de venir d'aquesta mateixa web).
      if (request.method !== "GET" && request.method !== "HEAD") {
        const origin = request.headers.get("origin");
        if (origin && origin !== url.origin) return err("forbidden", 403);
      }
      if (p.startsWith("/_blob/")) {
        const id = decodeURIComponent(p.slice(7));
        if (!validId(id)) return err("not_found", 404);
        const b = await getBlob(env, id);
        if (!b) return new Response("No trobat", { status: 404 });
        return new Response(b.body, { headers: { "content-type": b.type, "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
      }
      if (p.startsWith("/api/")) return await api(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (e) {
      return err(e && e.code || "unavailable", 500, String(e && e.message || e).slice(0, 200));
    }
  },
};
