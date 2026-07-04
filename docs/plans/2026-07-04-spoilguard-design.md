# SpoilGuard — Design (2026-07-04)

> Nom de travail. Extension Chrome + companion web app qui neutralisent les spoilers
> de résultats sportifs sur YouTube : titres réécrits par LLM, miniatures floutées,
> centrés sur les compétitions que l'utilisateur suit.

## Problème

Pendant une compétition (Tour de France, Wimbledon, F1…), impossible d'aller chercher
le résumé du jour sur YouTube sans se faire spoiler le résultat par les titres,
miniatures (bras levés, maillot), et vidéos recommandées. Les extensions existantes
(No Spoilers ~1 000 users, YouTube Spoiler Blocker 38 users, Anti-Spoiler 18 users)
sont toutes à base de mots-clés manuels : elles ratent les spoils implicites
(« L'échappée va au bout ! », « Incroyable numéro du Slovène 🇸🇮 ») et rendent le feed
inutilisable (floutage aveugle) au lieu de le rendre navigable.

## Positionnement

- **Niche sport**, onboarding = « quelles compétitions tu suis ? » (pas de mots-clés à gérer).
- **Réécriture de titre** (pas juste du floutage) : « Pogačar ÉCRASE tout le monde au
  Ventoux 🤯 » → « 🚴 Tour de France 2026 – Résumé étape 14 ». YouTube reste utilisable :
  on identifie le résumé qu'on cherche sans connaître le résultat.
- **Détection sémantique LLM** : comprend les spoils implicites, zéro maintenance de
  listes de coureurs/équipes.
- Marché de niche saisonnier : side project passion + vitrine, pas une machine à cash.

## Architecture

3 briques + 1 companion :

### 1. Extension Chrome (Manifest V3)

- **Content script** sur `youtube.com` : `MutationObserver` sur `document.body`
  (YouTube = SPA). Cartes ciblées : `ytd-rich-item-renderer` (accueil),
  `ytd-video-renderer` (recherche), `ytd-compact-video-renderer` (sidebar /watch),
  `yt-lockup-view-model` (markup 2025+), notifications, abonnements, Shorts.
- Extraction par carte : `videoId` (lien `watch?v=`), titre, nom de chaîne.
- **Jamais de modification structurelle du DOM** (le renderer YouTube écraserait) :
  uniquement `textContent` du titre + classes CSS (blur miniature `filter: blur(16px)`).
  Re-render géré par `WeakSet` + attribut `data-spoilguard`.
- **Service worker** : batching (débounce ~150 ms), cache local
  `chrome.storage.session` par `videoId`, appels backend.
- **Page d'options** : toggle par compétition du catalogue, période d'activité auto
  (le Tour s'active en juillet), bouton « révéler tout pendant 10 min ».

### 2. Anti-flash : masquer d'abord, révéler ensuite

Le vrai titre ne doit JAMAIS être peint, même 200 ms.

1. `t=0` — carte détectée → **pré-filtre local synchrone (<1 ms)** :
   - **Chaînes à haut risque** (cœur du système) : liste courte par compétition
     (Tour de France, Eurosport, France TV Sport, beIN SPORTS France…). Toute vidéo
     < 72 h de ces chaînes est **voilée d'office sans LLM** ; le LLM ne sert qu'à
     fournir le `safeTitle` propre. Zéro flash possible, marche même backend down
     (titre voilé générique), économise Cerebras.
   - **Lexique** de la compétition (tour, étape, stage, TDF, maillot…) pour la longue
     traîne (chaînes généralistes, vlogueurs).
   - Match → skeleton gris sur le titre + blur miniature, avant le paint.
2. `t≈50 ms` — cache hit (local ou partagé) → titre neutre posé ou voile retiré.
3. `t≈300 ms` — cache miss → Cerebras tranche : `spoiler: false` → révèle l'original ;
   `spoiler: true` → écrit `safeTitle`, miniature reste floutée, badge 🛡️ cliquable
   pour révéler volontairement.

### 3. Backend — Hono sur le VPS perso

(Même stack que recall-people-2026 / vibereport / coworker-malin.)

- `POST /classify` : `{competitions: ["tdf-2026"], videos: [{videoId, title, channel}]}`
  → `[{videoId, spoiler, safeTitle}]`. Batch max 30, rate limit par IP (pas de comptes en V1).
- `GET /competitions` : catalogue (id, nom, période) + **pack local** par compétition
  (chaînes à risque + lexique), généré une fois via LLM/à la main, stocké en base.
- `GET /feed/:competitionId` : flux « vidéos sûres » pour le companion web app
  (videoId, safeTitle, date, chaîne) — alimenté par YouTube Data API sur les chaînes
  à risque + le même cache de classification.
- **Cache partagé** Postgres : `classifications(video_id, competition_id, spoiler,
  safe_title, created_at)`, PK composite, TTL ~24 h (titres éditables par les chaînes).
  Le premier utilisateur qui croise une vidéo paie l'appel LLM ; tous les autres ont
  la réponse en ~30 ms. En régime de croisière : quelques centaines d'appels/jour
  pour tous les utilisateurs.

### 4. LLM — gpt-oss-120b via Cerebras (~3000 tok/s)

- Batch de titres → JSON structuré `{spoiler, safeTitle}` en ~300 ms.
- Prompt : détecter ce qui révèle OU laisse deviner un résultat (vainqueur, classement,
  nationalité, ton émotionnel révélateur — les spoils implicites sont explicitement
  dans le prompt). `safeTitle` : conserver compétition, étape/journée, parcours, type
  de contenu (résumé, interview) — sans indice de résultat.

### 5. Companion web app (mobile — dès la V1)

L'app native YouTube est intouchable et les extensions mobiles (Firefox Android,
Safari iOS) ne touchent qu'une audience marginale. Réponse mobile : une page
« mode sans spoiler » sur le VPS — liste des résumés des compétitions suivies avec
titres neutres (via `GET /feed/:competitionId`), lecture en embed YouTube.
Ne modifie pas YouTube, offre une destination alternative + vitrine marketing.
Stack : Vite/React (préférence side projects).

## Privacy

Le pré-filtre local fait que seuls les titres plausiblement sportifs partent au
backend — jamais l'historique YouTube complet. Argument pour la fiche Store.

## Ordre de build

1. Extension, mode « chaînes connues » seul, pack Tour de France 2026 en dur —
   utilisable perso en quelques jours, pendant le Tour.
2. Backend Hono + Cerebras + cache partagé (longue traîne + safeTitles propres).
3. Companion web app (feed sans spoiler, mobile).
4. Catalogue multi-compétitions + page d'options complète.
5. Publication Chrome Web Store.

## Concurrence (état au 2026-07-04)

| Extension | Users | Détection | Titres |
|---|---|---|---|
| No Spoilers | 1 000, 4.7★, Featured | mots-clés manuels | flou des cartes |
| YouTube Spoiler Blocker | 38 | mots-clés (générés par IA) | overlay bloquant |
| Anti-Spoiler for YouTube | 18 | aucune | non (durées/barres seulement) |

Personne ne fait : détection sémantique, réécriture de titre, ciblage par compétition.
