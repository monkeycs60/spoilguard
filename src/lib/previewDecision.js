// Décisions pures autour des fuites HORS carte (overlays/éléments globaux que YouTube
// positionne par-dessus une carte voilée). Aucune manipulation DOM ici — le câblage
// (observers) vit dans content.js. Ces fonctions verrouillent le contrat par des tests.

// Extrait le videoId (11 caractères) d'un href YouTube interne ou absolu.
//   /watch?v=Y8lwQN3ezqs&pp=…            → 'Y8lwQN3ezqs'
//   https://www.youtube.com/watch?v=…    → idem
//   /shorts/Y8lwQN3ezqs                  → 'Y8lwQN3ezqs'
// Retourne null si aucun id exploitable (contrat : jamais de chaîne vide).
export function parseVideoIdFromHref(href) {
  const s = href || '';
  const m = s.match(/[?&]v=([\w-]{11})/) || s.match(/shorts\/([\w-]{11})/);
  return m ? m[1] : null;
}

// La preview vidéo globale (ytd-video-preview), ou une tuile de mur de fin de lecture,
// doit-elle être bloquée ? `videoId` est l'id que l'élément s'apprête à afficher/jouer,
// `veiledIds` le registre des videoIds actuellement voilés (Set-like : expose .has()).
// Retourne true (→ bloquer : la miniature / les 1res secondes fuiteraient une vidéo
// voilée) ou false (→ débloquer : rien de sensible, ne pas masquer). Id absent → false
// (on ne bloque jamais sans certitude, pas de sur-masquage).
export function previewDecision(videoId, veiledIds) {
  if (!videoId) return false;
  if (!veiledIds || typeof veiledIds.has !== 'function') return false;
  return veiledIds.has(videoId);
}
