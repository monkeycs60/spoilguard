// Garde anti-preview au survol (défense JS shadow-DOM-proof).
//
// Contexte : YouTube démarre une preview vidéo au survol d'une carte (soit dans un
// élément GLOBAL `ytd-video-preview`, soit dans un player monté DANS la carte — parfois
// en shadow DOM, hors de portée d'un CSS de content script). Masquer par CSS ne suffit
// donc pas de façon fiable. La vraie garantie : empêcher le survol d'être VU par les
// listeners délégués de YouTube.
//
// Mécanique : on pose sur la carte voilée des intercepteurs en PHASE DE CAPTURE pour les
// évènements déclencheurs du hover-preview. `stopImmediatePropagation()` en capture, au
// niveau de la carte, stoppe la descente (les handlers internes de la miniature ne voient
// rien) ET la remontée (les listeners délégués de YouTube sur les ancêtres ne voient rien)
// → aucune preview ne démarre, quel que soit le markup (light ou shadow DOM).
//
// On n'intercepte QUE des évènements de survol : `dblclick` (notre révélation) et `click`
// (navigation) ne sont pas dans la liste → ils continuent de fonctionner normalement.
export const HOVER_EVENTS = [
  'pointerenter',
  'pointerover',
  'pointermove',
  'mouseover',
  'mouseenter',
  'mousemove',
];

// Handlers par élément → garantit un seul jeu d'intercepteurs et un retrait propre.
const guards = new WeakMap();

// Pose les intercepteurs de survol (idempotent). `el` = la carte voilée/softveil/ad-veiled.
export function addHoverGuard(el) {
  if (!el || typeof el.addEventListener !== 'function') return;
  if (guards.has(el)) return; // déjà gardée → ne pas empiler
  const handler = (e) => {
    e.stopImmediatePropagation();
  };
  for (const type of HOVER_EVENTS) el.addEventListener(type, handler, true);
  guards.set(el, handler);
}

// Retire les intercepteurs de survol (idempotent).
export function removeHoverGuard(el) {
  if (!el) return;
  const handler = guards.get(el);
  if (!handler) return;
  for (const type of HOVER_EVENTS) el.removeEventListener(type, handler, true);
  guards.delete(el);
}

// Testabilité / debug : la carte est-elle actuellement gardée ?
export function hasHoverGuard(el) {
  return !!el && guards.has(el);
}
