# SpoilGuard Phases 2-4 — Backend, companion, multi-compétitions

> Suite du design `2026-07-04-spoilguard-design.md`. Phase 1 (extension chaînes connues) livrée et vérifiée.

## Contrat d'API (FIGÉ — le backend et l'extension s'y conforment)

Base URL configurable côté extension (`chrome.storage.local.backendUrl`), défaut dev `http://localhost:8787`.

### POST /classify
```json
// requête
{ "competitions": ["tdf-2026"], "videos": [{ "videoId": "abc", "title": "...", "channel": "..." }] }
// réponse 200
{ "results": [{ "videoId": "abc", "spoiler": true, "safeTitle": "🚴 Tour de France 2026 – Résumé étape 2" }] }
```
- Batch max 30, rate limit par IP (60 req/min), validation zod.
- Cache in-memory TTL 24h clé `videoId` (le titre suffit, pas de multi-compétition en cache v1 — YAGNI).
- LLM : Vercel AI SDK + `@ai-sdk/cerebras`, `gpt-oss-120b`, `generateObject` (schéma zod) + 1 retry.
- Si le LLM échoue après retry → `spoiler: true` + safeTitle générique (prudence, jamais de 5xx pour ça).

### GET /competitions
```json
{ "competitions": [{ "id": "tdf-2026", "label": "Tour de France", "emoji": "🚴", "active": true,
  "maxAgeHours": 72, "channels": ["..."], "lexicon": ["..."] }] }
```
Source de vérité des packs = backend (`backend/src/data/competitions.ts`). L'extension garde son pack
en dur comme fallback offline.

### GET /feed/:competitionId (Phase 3)
```json
{ "videos": [{ "videoId": "...", "safeTitle": "...", "publishedAt": "ISO", "channel": "..." }] }
```
Construit depuis les flux RSS publics YouTube des chaînes à risque
(`https://www.youtube.com/feeds/videos.xml?channel_id=UC...`) — aucun quota, aucune clé.
Titres passés par le même pipeline classify/cache. Cache feed 10 min.

## Phase 2 — Backend + intégration extension

**Backend** `backend/` (Hono + @hono/node-server, Node, port 8787 local / 3000 prod, TypeScript) :
mêmes conventions que recall-people-2026/backend (Hono, zod, Vercel AI SDK). Tests vitest, LLM mocké.
Pas de DB : cache in-memory TTL (Map) — se reconstruit pour quelques centimes, Postgres seulement si besoin réel.

**Extension** : service worker `src/background.js` (batch + debounce 150ms, cache `chrome.storage.session`,
fetch backend, silence total si backend down) ; content script : les cartes voilées par pré-filtre envoient
`{videoId,title,channel}` au SW ; à la réponse, `spoiler:false` → dé-voiler, `spoiler:true` → remplacer le
titre générique par `safeTitle` (metadata inchangée). `manifest.json` : `background.service_worker`,
`host_permissions` backend, `storage`.

**Déploiement** : repo GitHub public `monkeycs60/spoilguard` (pattern recall), app Coolify Nixpacks
Base Directory `/backend`, `npm install` / `npm start`, port 3000, env `CEREBRAS_API_KEY`.
Domaine sslip.io généré par Coolify (pas de DNS à toucher pour l'instant).

## Phase 3 — Companion web app (mobile)

Servie PAR le backend (route `/` statique) : page unique (HTML/JS vanilla ou Preact léger, pas de build
séparé) qui liste les compétitions, puis le feed sans spoiler (`GET /feed/:id`), lecture en embed
`youtube-nocookie.com`. Zéro nouveau déploiement.

## Phase 4 — Multi-compétitions + options

- `backend/src/data/competitions.ts` : ajouter Wimbledon 2026 (beIN SPORTS France…), F1 2026.
- Extension : page options (compétitions cochables depuis `GET /competitions`, cache local, fallback pack
  en dur), popup (on/off global + « révéler 10 min »), badge compteur de vidéos voilées.
- Le pré-filtre local fusionne les packs des compétitions actives.

## Landing page

`landing/index.html` statique (autonome, zéro dépendance) : promesse, démo avant/après, CTA install.
Déploiement décidé plus tard (Vercel comme recall, ou servie par le backend).
