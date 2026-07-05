// Décision pure : que faire d'une carte DÉJÀ voilée par le pré-filtre (Phase 1)
// lorsque la réponse du backend arrive (via le service worker). Aucune manipulation
// DOM ici — le câblage vit dans content.js. Le service worker et le content script ne
// communiquent que par messages ; cette fonction ne connaît que des données brutes.
//
// `result` est l'entrée du tableau `results` renvoyé par le backend pour ce videoId :
//   { videoId, spoiler: true, safeTitle: '...' }  → vraie carte spoiler, titre neutre backend
//   { videoId, spoiler: false }                   → faux positif du pré-filtre → dé-voiler
//   { videoId, unavailable: true }                → backend indispo/timeout → garder le voile Phase 1
//   null / undefined                              → pas de réponse exploitable → ne rien faire
//
// État de la carte au moment où la réponse arrive (elle a pu changer entre-temps) :
//   veiled   : la carte porte TOUJOURS notre voile générique (data-spoilguard === 'veiled')
//   revealed : l'utilisateur a révélé la carte (dblclic) entre-temps → on respecte son geste
//   videoId  : le videoId courant de la carte (recyclage YouTube → ne pas appliquer une
//              réponse périmée destinée à l'ancienne vidéo)
//
// Sorties :
//   'noop'    → ne rien faire (indispo, réponse périmée, carte révélée ou plus voilée…)
//   'unveil'  → dé-voiler définitivement + marquer clean (spoiler:false)
//   'retitle' → remplacer le titre générique par le safeTitle backend (spoiler:true + safeTitle)
export function backendDecision({ result, veiled, revealed, videoId }) {
  if (!result) return 'noop';
  if (result.unavailable) return 'noop';

  // Réponse destinée à une autre vidéo (carte recyclée depuis l'envoi) → ignorer.
  if (result.videoId != null && videoId != null && result.videoId !== videoId) {
    return 'noop';
  }

  // L'utilisateur a révélé la carte entre-temps : son geste prime, on n'y touche plus.
  if (revealed) return 'noop';

  // La carte n'est plus voilée (déjà dé-voilée, recyclée, révélée…) → rien à faire.
  if (!veiled) return 'noop';

  if (result.spoiler === false) return 'unveil';

  if (result.spoiler === true) {
    const safe = typeof result.safeTitle === 'string' ? result.safeTitle.trim() : '';
    // Titre neutre backend disponible → le substituer ; sinon le voile générique Phase 1
    // reste (aucune régression, dégradation gracieuse).
    return safe ? 'retitle' : 'noop';
  }

  return 'noop';
}
