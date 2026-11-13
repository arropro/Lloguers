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
FLAG = ('<button type="button" class="langbtn" data-notr onclick="setLang(window.LLOGUERS_LANG===\'es\'?\'ca\':\'es\')" aria-label="Idioma / Idioma">'
  '<span class="flag"></span><span class="lc"></span></button>')
rep('<div class="brand"><div class="mark" aria-hidden="true">', '<div class="brand"><a href="/copia.html" class="mark" aria-label="Ajustos" title="Ajustos">')
rep('<header class="mtop"><div class="mark" aria-hidden="true">', '<header class="mtop"><a href="/copia.html" class="mark" aria-label="Ajustos" title="Ajustos">')
# tancar els <a> de les cases: la primera </div> després de cada </svg> del mark
for tag in ('<div class="brand"><a href="/copia.html"', '<header class="mtop"><a href="/copia.html"'):
    i = src.index(tag); j = src.index('</svg></div>', i)
    src = src[:j] + '</svg></a>' + src[j+len('</svg></div>'):]
rep('<b>Els meus lloguers</b></header>', '<b>Els meus lloguers</b>' + FLAG.replace('class="langbtn"', 'class="langbtn" style="margin-left:auto"') + '</header>')
rep("Privat · només hi tens accés tu</div>", "Privat · només hi tens accés tu</div>" + FLAG.replace('class="langbtn"', 'class="langbtn rail-lang"'))

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
<script src="/i18n.js?v=5"></script>
<script src="/shim.js"></script>
<link rel="stylesheet" href="/lang.css?v=1">
<style>
#splash{position:fixed;inset:0;z-index:9999;background:var(--sbg,#0B1430);transition:opacity .45s ease;display:grid;place-items:center}
#splash img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;
  clip-path:inset(calc(50% - 64px) calc(50% - 64px) round 28px);transition:clip-path .75s cubic-bezier(.6,0,.2,1)}
#splash.open img{clip-path:inset(0 round 0)}
#splash picture{position:absolute;inset:0}
#splash .ic{position:relative;z-index:1;width:128px;height:128px;border-radius:28px;object-fit:cover;clip-path:none;inset:auto;transition:transform .75s cubic-bezier(.6,0,.2,1),opacity .5s ease}
#splash.open .ic{transform:scale(2.4);opacity:0}
#splash.hide{opacity:0;pointer-events:none}
</style>
</head>
<body>
<div id="splash" aria-hidden="true"><img class="ic" src="/icon-512.png" alt=""><picture><source media="(orientation: landscape)" srcset="/splash-wide.jpg"><img src="/splash.jpg" alt=""></picture></div>
<script>
(function () {
  // Pantalla d'inici: comença igual que la d'Android (color de fons + icona petita al mig)
  // i la imatge s'obre fins a ocupar tota la pantalla.
  var s = document.getElementById("splash"), seen = false;
  try { seen = sessionStorage.getItem("lloguers-splash") === "1"; sessionStorage.setItem("lloguers-splash", "1"); } catch (e) {}
  if (seen) { s.remove(); return; }
  try { var bg = localStorage.getItem("lloguers-splash-bg"); if (bg) s.style.setProperty("--sbg", bg); } catch (e) {}
  fetch("/api/settings", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (d && d.bg) { s.style.setProperty("--sbg", d.bg); try { localStorage.setItem("lloguers-splash-bg", d.bg); } catch (e) {} }
  }).catch(function () {});
  var img = s.querySelector("picture img"), done = false;
  function open() { requestAnimationFrame(function () { s.classList.add("open"); }); setTimeout(hide, 1900); }
  function hide() { if (done) return; done = true; s.classList.add("hide"); setTimeout(function () { s.remove(); }, 500); }
  s.addEventListener("click", hide);
  if (img.complete) setTimeout(open, 150); else { img.addEventListener("load", function () { setTimeout(open, 150); }); img.addEventListener("error", hide); }
  setTimeout(hide, 5000);
})();
</script>
"""
out = head + src + "\n</body>\n</html>\n"
pathlib.Path(__file__).with_name("public").joinpath("index.html").write_text(out, encoding="utf-8")
print("public/index.html generat:", len(out), "bytes")
