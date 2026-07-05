# SpoilGuard

Extension Chrome (Manifest V3) qui masque instantanément les spoilers de résultats sportifs sur YouTube — Tour de France, Wimbledon, Formule 1.

Deux couches : un **pré-filtre local** voile avant le premier paint (chaînes à risque + lexique), puis le **backend IA** (Hono + Cerebras gpt-oss-120b sur VPS, cache partagé par compétition) réécrit les titres proprement (« 🚴 Tour de France 2026 – Résumé étape 2 ») et dé-voile les faux positifs. Miniatures floutées, descriptions et chips « Résumé » IA masqués, `aria-label` neutralisés, titre principal des pages /watch couvert. Vérifié sur YouTube réel (juillet 2026, pendant le Tour).

Composants : `src/` (extension) · `backend/` (API + companion web app mobile `/`) · `landing/` (page de vente).
Prod : `https://o2nn42t9tx9tzfukiamwlrnl.137.74.43.81.sslip.io` (Coolify sur VPS OVH, deploy = push sur master + redeploy Coolify).

## Installation

```bash
npm install && npm run build
```

Puis `chrome://extensions` → activer le **Mode développeur** → **Charger l'extension non empaquetée** → sélectionner ce dossier.

## Utilisation

- Fonctionne automatiquement sur youtube.com : toute vidéo liée au Tour de France de moins de 72 h est voilée (chaîne à risque type Eurosport/France TV, ou mot du lexique dans le titre).
- **Double-clic sur un titre voilé** pour révéler la vidéo (titre + miniature). La révélation persiste tant que la carte affiche la même vidéo.
- Les vidéos anciennes (> 72 h) ne sont pas voilées ; si l'âge n'est pas encore chargé, la vidéo est voilée par prudence puis dé-voilée automatiquement.

## Développement

```bash
npm test        # 63 tests (vitest + fixtures DOM YouTube réelles)
npm run watch   # rebuild esbuild en continu
```

Architecture : toute la logique de décision vit dans `src/lib/` (modules purs testés) ; `src/content.js` n'est que du câblage DOM. Design et plan : `docs/plans/`.
