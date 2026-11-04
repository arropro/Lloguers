#!/usr/bin/env python3
"""Genera public/index.html a partir de l'app de Claude (lloguers.html).
Ús: python3 build.py /ruta/a/lloguers.html
Així, qualsevol canvi fet a la versió de Claude es pot passar a l'app pròpia."""
import re, sys, pathlib

src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "lloguers.html").read_text(encoding="utf-8")

# 1) Treure les icones/manifest incrustats (aquí es fan servir els fitxers de /public).
src = re.sub(r'\n<meta name="application-name".*?<link rel="manifest" href="data:[^"]*">', "", src, count=1, flags=re.S)
assert "data:application/manifest" not in src

def rep(old, new, count=1):
    global src
    assert old in src, "No trobat: " + old[:80]
    src = src.replace(old, new, count)

# 2) Textos que només tenien sentit dins de Claude.
rep("<h2>Obre aquesta pàgina a Claude</h2><p>Les teves dades es guarden al teu compte de Claude. Obre l'enllaç des de claude.ai, amb la sessió iniciada.</p>",
    "<h2>No s'han pogut carregar les dades</h2><p>Comprova la connexió i torna a obrir l'app.</p>")
rep("No has permès que la pàgina faci servir Claude, així que omple les dades a mà.",
    "L'escaneig amb IA no està configurat (falta la clau d'Anthropic). Omple les dades a mà.")
rep("Has arribat al límit d'ús de Claude per ara. Omple les dades a mà o torna-ho a provar més tard.",
    "Ara mateix no es pot fer servir la IA (límit d'ús o sense saldo a Anthropic). Omple les dades a mà o torna-ho a provar més tard.")
rep("Has arribat al límit d'ús de Claude per ara.", "Ara mateix no es pot fer servir la IA (límit d'ús o sense saldo a Anthropic).")
rep("La pàgina no té permís per fer servir Claude, així que no pot llegir els documents.",
    "L'escaneig amb IA no està configurat (falta la clau d'Anthropic), així que no es poden llegir els documents.")
rep("Privat · només hi tens accés tu</div>",
    'Privat · només hi tens accés tu</div><a class="rail-foot" href="/copia.html" style="text-decoration:none;color:inherit;margin-top:6px">⚙︎ Còpia de seguretat</a>')
rep('<b>Els meus lloguers</b></header>',
    '<b>Els meus lloguers</b><a href="/copia.html" aria-label="Còpia de seguretat" style="margin-left:auto;color:inherit;opacity:.7;display:grid;place-items:center;width:34px;height:34px"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg></a></header>')

head = """<!doctype html>
<html lang="ca">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0B1430">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Lloguers">
<style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;padding:0}</style>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script src="/shim.js"></script>
<style>
#splash{position:fixed;inset:0;z-index:9999;background:#0B1430;transition:opacity .5s ease}
#splash img{width:100%;height:100%;object-fit:cover;display:block}
#splash.hide{opacity:0;pointer-events:none}
</style>
</head>
<body>
<div id="splash" aria-hidden="true"><picture><source media="(orientation: landscape)" srcset="/splash-wide.jpg"><img src="/splash.jpg" alt=""></picture></div>
<script>
(function () {
  // Pantalla d'inici: la imatge de la icona a pantalla completa uns instants en obrir l'app.
  var s = document.getElementById("splash"), seen = false;
  try { seen = sessionStorage.getItem("lloguers-splash") === "1"; sessionStorage.setItem("lloguers-splash", "1"); } catch (e) {}
  if (seen) { s.remove(); return; }
  var t0 = Date.now(), done = false;
  function hide() { if (done) return; done = true; s.classList.add("hide"); setTimeout(function () { s.remove(); }, 600); }
  s.addEventListener("click", hide);
  window.addEventListener("load", function () { setTimeout(hide, Math.max(0, 1600 - (Date.now() - t0))); });
  setTimeout(hide, 4000);
})();
</script>
"""
out = head + src + "\n</body>\n</html>\n"
pathlib.Path(__file__).with_name("public").joinpath("index.html").write_text(out, encoding="utf-8")
print("public/index.html generat:", len(out), "bytes")
