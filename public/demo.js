// Mode demostració: l'app mostra pisos, inquilins i números inventats.
// Les dades reals no es llegeixen ni es toquen: totes les peticions al servidor es contesten aquí mateix, en memòria.
(function () {
  "use strict";
  let on = false;
  try { on = localStorage.getItem("lloguers-demo") === "1"; } catch (e) {}
  window.LLOGUERS_DEMO = on;
  window.setDemo = function (v) { try { v ? localStorage.setItem("lloguers-demo", "1") : localStorage.removeItem("lloguers-demo"); } catch (e) {} location.href = "/"; };
  if (!on || location.pathname !== "/") return;

  // ---------- dades inventades ----------
  const pad = n => String(n).padStart(2, "0");
  const now = new Date(), Y = now.getFullYear(), M = now.getMonth() + 1, D = now.getDate();
  const ym = (y, m) => { while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${pad(m)}`; };
  const cur = ym(Y, M), addM = (s, k) => ym(+s.slice(0, 4), +s.slice(5, 7) + k);
  const day = (s, d) => `${s}-${pad(d)}`;
  const r2 = x => Math.round(x * 100) / 100;
  let seq = 0; const id = p => `demo${p}${(++seq).toString(36)}`;
  const DB = { props: new Map(), contracts: new Map(), moves: new Map(), docs: new Map(), inbox: new Map() };
  const put = (col, data, key) => { const k = key || id(col[0]); DB[col].set(k, { createdAt: Date.now(), ...data }); return k; };
  const lastMonths = (from, to) => { const out = []; let m = from; while (m <= to) { out.push(m); m = addM(m, 1); } return out; };
  const start24 = addM(cur, -23);

  // 1. Pis Girona: lloguer tradicional amb hipoteca
  const girona = put("props", { name: "Pis Girona", type: "Pis", rentalMode: "tradicional", address: "C/ de la Rutlla 18, 2n 1a, Girona", surface: "78", price: "145000", value: "198000", purchaseDate: "2019-06-14",
    insurer: "Assegurances Exemple", policyNumber: "DEMO-001", policyRenewal: day(addM(cur, 5), 1),
    mortgage: { bank: "Banc Exemple", kind: "Fix", principal: 110000, rate: 2.1, years: 25, start: "2019-08", payment: 471.6 },
    fixed: [{ concept: "IBI", category: "IBI i taxes", amount: 420, freq: "anual", month: 10 }, { concept: "Assegurança de la llar", category: "Assegurança", amount: 215, freq: "anual", month: 4 }] });
  const cGirona = put("contracts", { propId: girona, tenantName: "Laura Puig Serra", tenantType: "particular", start: "2022-03-01", firstEnd: "2023-02-28", end: "2027-02-28", rent: "850", deposit: "850", incasol: true, priceMode: "mensual", unitLabel: "Pis sencer", people: "1 arrendatària",
    rents: [{ from: "2023-03", amount: 876.35, note: "IPC +3,1 %" }, { from: "2024-03", amount: 902.64, note: "IPC +3 %" }, { from: "2025-03", amount: 921.6, note: "IPC +2,1 %" }, { from: "2026-03", amount: 939.11, note: "IRAV +1,9 %" }] });

  // 2. Àtic Sabadell: tradicional, sense hipoteca, amb una derrama
  const sabadell = put("props", { name: "Àtic Sabadell", type: "Àtic", rentalMode: "tradicional", address: "C/ de la Indústria 42, àtic, Sabadell", surface: "64", price: "189000", value: "230000", purchaseDate: "2021-10-05",
    insurer: "Assegurances Exemple", policyNumber: "DEMO-002",
    fixed: [{ concept: "IBI", category: "IBI i taxes", amount: 510, freq: "anual", month: 9 },
      { concept: "Derrama façana · termini 2 de 4", category: "Derrama", amount: 180, freq: "once", ym: addM(cur, 1), month: +addM(cur, 1).slice(5) },
      { concept: "Derrama façana · termini 3 de 4", category: "Derrama", amount: 180, freq: "once", ym: addM(cur, 3), month: +addM(cur, 3).slice(5) },
      { concept: "Derrama façana · termini 4 de 4", category: "Derrama", amount: 180, freq: "once", ym: addM(cur, 5), month: +addM(cur, 5).slice(5) }] });
  const cSabadell = put("contracts", { propId: sabadell, tenantName: "Jordi Ferrer i Marta Vidal", tenantType: "particular", start: "2024-09-01", firstEnd: "2025-08-31", end: "2029-08-31", rent: "1050", deposit: "2100", incasol: true, priceMode: "mensual", unitLabel: "Pis sencer", people: "2 arrendataris",
    rents: [{ from: "2025-09", amount: 1077.3, note: "IPC +2,6 %" }, { from: "2026-09", amount: 1097.77, note: "IRAV +1,9 %" }] });
  const cSabadellOld = put("contracts", { propId: sabadell, tenantName: "Albert Costa Rius", tenantType: "particular", start: "2022-01-01", end: "2024-07-31", rent: "980", deposit: "980", incasol: true, priceMode: "mensual", unitLabel: "Pis sencer", ended: true });

  // 3. Pis Reus: lloguer a empreses a través d'una plataforma
  const reus = put("props", { name: "Pis Reus", type: "Pis", rentalMode: "empresa", address: "Av. de Prat de la Riba 7, 3r 2a, Reus", surface: "70", price: "98000", value: "125000", purchaseDate: "2023-04-20",
    platform: "StayWork", feePct: "10", feeVat: "21", insurer: "Assegurances Exemple", policyNumber: "DEMO-003",
    mortgage: { bank: "Banc Exemple", kind: "Variable", principal: 70000, rate: 3.2, years: 20, start: "2023-06", payment: 395.4 },
    inv: { next: "", emName: "Nom Exemple", emNif: "00000000T", emAddr: "Av. de Prat de la Riba 7, Reus", pl1: "Inmueble sito en España - Catalunya - Reus", pl2: "Av. de Prat de la Riba 7, 3r 2a, Reus" } });
  const oldStart = addM(cur, -14), oldEnd = addM(cur, -9), newStart = addM(cur, -8);
  const endOf = s => { const d = new Date(+s.slice(0, 4), +s.slice(5, 7), 0); return `${s}-${pad(d.getDate())}`; };
  const cReusOld = put("contracts", { propId: reus, tenantName: "Muntatges Ebre S.L.", tenantType: "empresa", cif: "B00000001", start: day(oldStart, 1), end: endOf(oldEnd), rent: "1150", deposit: "1150", priceMode: "mensual", platform: "StayWork", feePct: "10", feeVat: "21", people: "3 treballadors", unitLabel: "Pis sencer", email: "admin@muntatges-exemple.com" });
  const cReus = put("contracts", { propId: reus, tenantName: "Instal·lacions Delta S.L.", tenantType: "empresa", cif: "B00000002", start: day(newStart, 1), end: endOf(addM(newStart, 11)), rent: "1200", deposit: "1200", priceMode: "mensual", platform: "StayWork", feePct: "10", feeVat: "21", people: "4 treballadors", unitLabel: "Pis sencer", email: "factures@delta-exemple.com", mailLang: "es" });

  // 4. Pis Lleida: per habitacions
  const lleida = put("props", { name: "Pis Lleida", type: "Pis", rentalMode: "habitacions", address: "C/ Major 55, 1r, Lleida", surface: "92", price: "82000", value: "105000", purchaseDate: "2022-02-10", insurer: "Assegurances Exemple", policyNumber: "DEMO-004",
    fixed: [{ concept: "IBI", category: "IBI i taxes", amount: 280, freq: "anual", month: 6 }] });
  const rooms = [["Habitació 1 · Pau Roca", 380, "2024-10-01", `${Y + 1}-09-30`], ["Habitació 2 · Aina Soler", 360, "2025-01-15", `${Y + 1}-01-14`], ["Habitació 3 · Marc Llobet", 400, "2025-06-01", `${Y + 1}-05-31`]]
    .map(([n, r, s, e]) => put("contracts", { rents: [{ from: ym(+s.slice(0, 4) + 1, +s.slice(5, 7)), amount: Math.round(r * 1.022 * 100) / 100, note: "IPC +2,2 %" }], propId: lleida, tenantName: n.split(" · ")[1], unitLabel: n.split(" · ")[0], tenantType: "particular", start: s, end: e, rent: String(r), deposit: String(r), incasol: true, priceMode: "mensual" }));

  // Moviments: lloguers cobrats (aquest mes en falta algun perquè es vegi el botó de cobrar)
  const rentOf = (c, m) => { let r = +c.rent; (c.rents || []).forEach(x => { if (x.from <= m) r = x.amount; }); return r; };
  const addRents = (cid, payDay, skipCur) => { const c = DB.contracts.get(cid); const s = c.start.slice(0, 7), e = (c.end || "9999").slice(0, 7);
    lastMonths(s, cur).forEach(m => { if (m > e) return; if (m === cur && (skipCur || D < payDay)) return;
      put("moves", { ...(c.platform && m === s ? { okExtra: true } : {}), type: "ingres", category: "Lloguer", amount: rentOf(c, m), date: day(m, Math.min(payDay, 28)), period: m, propId: c.propId, contractId: cid, provider: c.tenantName, concept: "Lloguer " + ["gener", "febrer", "març", "abril", "maig", "juny", "juliol", "agost", "setembre", "octubre", "novembre", "desembre"][+m.slice(5) - 1], source: "marcat", vat: 0 }); }); };
  addRents(cGirona, 3); addRents(cSabadell, 5, true); addRents(cSabadellOld, 2); addRents(cReusOld, 2); addRents(cReus, 2); rooms.forEach((r, i) => addRents(r, 1 + i, i === 2));
  // comissions de la plataforma (s'avancen a l'inici de cada estada)
  [cReusOld, cReus].forEach(cid => { const c = DB.contracts.get(cid); const months = lastMonths(c.start.slice(0, 7), c.end.slice(0, 7)).length;
    put("moves", { type: "despesa", category: "Comissió plataforma", amount: r2(+c.rent * months * 0.1 * 1.21), vat: r2(+c.rent * months * 0.1 * 0.21), date: day(c.start.slice(0, 7), 3), period: c.start.slice(0, 7), propId: c.propId, contractId: cid, provider: "StayWork S.L.", concept: "Serveis d'intermediació" }); });
  // despeses del dia a dia
  const com = { [girona]: 65, [sabadell]: 82, [reus]: 48, [lleida]: 55 };
  lastMonths(start24, cur).forEach(m => { Object.entries(com).forEach(([pid, a]) => { if (m === cur && D < 10) return; put("moves", { type: "despesa", category: "Comunitat", amount: a, date: day(m, 10), period: m, propId: pid, provider: "Comunitat de propietaris", concept: "Quota comunitat" }); }); });
  const once = (pid, date, category, amount, concept, provider) => { if (date.slice(0, 7) < start24 || date > `${cur}-${pad(D)}`) return; put("moves", { type: "despesa", category, amount, date, period: date.slice(0, 7), propId: pid, concept, provider: provider || "" }); };
  [Y - 1, Y].forEach(y => {
    once(girona, `${y}-10-15`, "IBI i taxes", 420, "IBI " + y, "Ajuntament"); once(girona, `${y}-04-02`, "Assegurança", 215, "Assegurança de la llar", "Assegurances Exemple");
    once(sabadell, `${y}-09-20`, "IBI i taxes", 510, "IBI " + y, "Ajuntament"); once(sabadell, `${y}-03-05`, "Assegurança", 240, "Assegurança de la llar", "Assegurances Exemple");
    once(reus, `${y}-07-12`, "IBI i taxes", 310, "IBI " + y, "Ajuntament"); once(reus, `${y}-05-08`, "IBI i taxes", 95, "Taxa d'escombraries " + y, "Ajuntament");
    once(lleida, `${y}-06-18`, "IBI i taxes", 280, "IBI " + y, "Ajuntament"); once(lleida, `${y}-11-03`, "Assegurança", 190, "Assegurança de la llar", "Assegurances Exemple");
  });
  once(girona, day(addM(cur, -9), 14), "Reparació i manteniment", 340, "Reparació de la caldera", "Fontaneria Exemple");
  once(lleida, day(addM(cur, -14), 22), "Mobiliari i millores", 450, "Pintar l'habitació 3", "Pintures Exemple");
  once(sabadell, day(addM(cur, -1), 12), "Derrama", 180, "Derrama façana · termini 1 de 4", "Comunitat de propietaris");
  // Reus: llum i aigua pagades i refacturades a l'empresa
  const INV = "Subministraments refacturats"; let invNo = 1;
  lastMonths(addM(cur, -12), addM(cur, -1)).forEach((m, i) => { if (i % 2) return;
    const amt = r2(55 + (i * 7) % 30), w = r2(22 + (i * 3) % 9), cid = m >= newStart ? cReus : m <= oldEnd ? cReusOld : null; if (!cid) return;
    once(reus, day(m, 9), "Subministraments", amt, "Factura llum", "Elèctrica Exemple"); once(reus, day(m, 11), "Subministraments", w, "Factura aigua", "Aigües Exemple");
    const c = DB.contracts.get(cid), late = m === addM(cur, -1) || m === addM(cur, -2);
    [["Llum", amt], ["Aigua", w]].forEach(([k, a]) => { const d = day(addM(m, 0), 20); if (d > `${cur}-${pad(D)}`) return;
      put("moves", { type: "ingres", category: INV, amount: a, date: d, period: m, propId: reus, contractId: cid, provider: c.tenantName, concept: `Factura ${invNo} · ${k} ${day(m, 1).split("-").reverse().join("/")}–${endOf(m).split("-").reverse().join("/")}`, invNo: String(invNo), invKind: k, vat: 0, docName: `Factura ${invNo} ${k} ${c.tenantName}.pdf`,
        ...(late && k === "Aigua" ? {} : { sentAt: new Date(d + "T10:00:00").toISOString(), sentTo: c.email }) }); invNo++; }); });
  DB.props.get(reus).inv.next = String(invNo);

  let left = 0;
  for (const [k, mv] of DB.moves) { if (mv.type !== "despesa" || mv.docId) continue; if (mv.propId === lleida && mv.category === "Mobiliari i millores" && left < 1) { left++; continue; } mv.docId = "demodoc" + k; mv.docMime = "application/pdf"; mv.docName = (mv.concept || "Factura") + ".pdf"; }
  for (const [k, mv] of DB.moves) if (mv.category === INV && !mv.docId) { mv.docId = "demodoc" + k; mv.docMime = "application/pdf"; }
  // ---------- servidor fals ----------
  const realFetch = window.fetch.bind(window);
  const J = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
  const E = (code, message, status) => J({ error: { code, message } }, status || 400);
  const clone = x => JSON.parse(JSON.stringify(x));
  const blobs = new Map();
  window.fetch = async function (input, init) {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (url.origin !== location.origin) return realFetch(input, init);
    const p = url.pathname, m = ((init && init.method) || (typeof input !== "string" && input.method) || "GET").toUpperCase();
    const body = async () => { const b = init && init.body; if (!b) return {}; if (typeof b === "string") { try { return JSON.parse(b); } catch { return {}; } } return b; };
    let mt;
    if ((mt = p.match(/^\/api\/db\/([a-z]+)\/?$/))) {
      const col = DB[mt[1]] || (DB[mt[1]] = new Map());
      if (m === "GET") return J({ docs: [...col.entries()].map(([id, data]) => ({ id, data: clone(data) })) });
      if (m === "POST") { const b = await body(); const k = id("n"); col.set(k, b.data || {}); return J({ id: k, data: clone(col.get(k)) }); }
    }
    if ((mt = p.match(/^\/api\/db\/([a-z]+)\/([^/]+)$/))) {
      const col = DB[mt[1]] || (DB[mt[1]] = new Map()), k = decodeURIComponent(mt[2]);
      if (m === "GET") return col.has(k) ? J({ id: k, data: clone(col.get(k)) }) : E("not_found", "", 404);
      if (m === "PUT") { const b = await body(); col.set(k, b.data || {}); return J({ id: k, data: clone(col.get(k)) }); }
      if (m === "PATCH") { const b = await body(); const d = { ...(col.get(k) || {}) }; Object.entries(b.data || {}).forEach(([f, v]) => { if (v === null) delete d[f]; else d[f] = v; }); col.set(k, d); return J({ id: k, data: clone(d) }); }
      if (m === "DELETE") { col.delete(k); return J({ ok: true }); }
    }
    if (p === "/api/blob" && m === "POST") { const b = init && init.body; const k = "demo" + Math.random().toString(16).slice(2, 14); blobs.set(k, b instanceof Blob ? b : new Blob([b || ""])); return J({ id: k, url: "/_blob/" + k, contentType: (b && b.type) || "application/octet-stream" }); }
    if (p.startsWith("/api/blob/")) return J({ ok: true });
    if (p === "/api/blobs") return J({ blobs: [] });
    if (p.startsWith("/_blob/")) { const k = decodeURIComponent(p.slice(7)); return blobs.has(k) ? new Response(blobs.get(k)) : new Response(demoPdf(), { headers: { "content-type": "application/pdf" } }); }
    if (p === "/api/ai/config") return J({ model: "demo" });
    if (p === "/api/ai") return E("unavailable", "En mode demostració no es llegeixen documents", 503);
    if (p === "/api/ai/balance") return J({ balance: 10, spent: 1.2, remaining: 8.8, low: false, empty: false });
    if (p === "/api/mail/config") return J({ user: "exemple@gmail.com", name: "Nom Exemple", configured: true });
    if (p === "/api/mail/send") { const b = await body(); toastDemo("Mode demostració: no s'ha enviat cap correu"); return J({ ok: true, to: [String(b.to || "")] }); }
    if (p.startsWith("/api/dl/")) return J({ ok: true, url: "/dl/demo/factura.pdf" });
    if (p.startsWith("/api/push")) return J({ ok: true, publicKey: "", subscribed: false });
    if (p.startsWith("/api/")) return J({ ok: true });
    return realFetch(input, init);
  };
  function demoPdf() {
    const t = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length 60>>stream\nBT /F1 22 Tf 150 420 Td (Document d'exemple) Tj ET\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
    return new Blob([t], { type: "application/pdf" });
  }
  function toastDemo(msg) { setTimeout(() => { try { window.toast && window.toast(msg); } catch {} }, 600); }

  // ---------- franja per saber que és una demostració ----------
  function banner() {
    if (document.getElementById("demo-band")) return;
    const b = document.createElement("div"); b.id = "demo-band"; b.setAttribute("data-notr", "");
    b.innerHTML = `<span>🎭 <b>${(window.LLOGUERS_LANG === "es") ? "Demostración" : "Demostració"}</b><span class="dsub"> · ${(window.LLOGUERS_LANG === "es") ? "datos inventados" : "dades inventades"}</span></span><button type="button">${(window.LLOGUERS_LANG === "es") ? "Salir" : "Sortir"}</button>`;
    b.querySelector("button").onclick = () => window.setDemo(false);
    const st = document.createElement("style");
    st.textContent = "#demo-band{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(76px + env(safe-area-inset-bottom));z-index:60;display:flex;align-items:center;gap:10px;background:#F5B841;color:#1a1300;font:600 .8rem/1 system-ui,sans-serif;padding:7px 8px 7px 12px;border-radius:999px;box-shadow:0 6px 18px rgb(0 0 0/.25)}#demo-band{white-space:nowrap}@media (max-width:420px){#demo-band .dsub{display:none}}#demo-band button{font:inherit;border:0;background:#1a1300;color:#F5B841;border-radius:999px;padding:6px 10px;cursor:pointer}@media (min-width:900px){#demo-band{bottom:18px}}";
    document.head.appendChild(st); document.body.appendChild(b);
  }
  if (document.body) banner(); else document.addEventListener("DOMContentLoaded", banner);
})();
