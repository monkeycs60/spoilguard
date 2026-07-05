// Décision pure : le voilage est-il actif ? Combine l'interrupteur global (enabled,
// défaut true) et la pause temporaire (« révéler tout pendant 10 min » → pauseUntil,
// un timestamp ms). Utilisé par le content script pour ne plus voiler de nouvelles
// cartes pendant une pause / quand l'extension est coupée.

export function veilingEnabled({ enabled, pauseUntil, now = Date.now() } = {}) {
  if (enabled === false) return false;
  if (typeof pauseUntil === 'number' && Number.isFinite(pauseUntil) && pauseUntil > now) {
    return false;
  }
  return true;
}

// Millisecondes restantes avant la fin d'une pause (0 si aucune / expirée). Sert au
// popup pour afficher un décompte éventuel.
export function pauseRemainingMs({ pauseUntil, now = Date.now() } = {}) {
  if (typeof pauseUntil !== 'number' || !Number.isFinite(pauseUntil)) return 0;
  return Math.max(0, pauseUntil - now);
}
