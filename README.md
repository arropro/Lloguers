# Els meus lloguers

App personal per gestionar els pisos de lloguer (Granollers, Bailén, Canals i Tarragona). Instal·lable al mòbil (PWA) i usable a l'ordinador.

## Peces

- `src/index.js`: servidor (Cloudflare Worker). Contrasenya, dades, fitxers i escaneig amb IA.
- `public/index.html`: l'app (generada amb `build.py` a partir de la versió de Claude).
- `public/shim.js`: pont entre l'app i el servidor.
- `public/copia.html`: còpia de seguretat (descarregar / recuperar).
- `wrangler.jsonc`: configuració de Cloudflare. La base de dades D1 (dades) i el KV (fitxers) es creen sols en publicar.

## Secrets (a Cloudflare, mai al codi)

- `APP_PASSWORD`: contrasenya per entrar a l'app.
- `SESSION_SECRET`: text llarg i aleatori per signar les sessions.
- `ANTHROPIC_API_KEY`: clau de l'API d'Anthropic (escaneig de documents amb Claude).

Variable opcional: `AI_MODEL` (per defecte `claude-sonnet-5-5`).
