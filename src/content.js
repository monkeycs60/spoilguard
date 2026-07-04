// Content script SpoilGuard — pur câblage DOM.
// Toute la décision vit dans des libs testées : pack.js, matcher.js, safeTitle.js,
// extract.js, reprocess.js. Ici on ne fait qu'observer le DOM et appliquer/révéler
// le voile, synchrone, avant paint.
import { TDF_2026 } from './lib/pack.js';
import { shouldVeil } from './lib/matcher.js';
import { buildLocalSafeTitle } from './lib/safeTitle.js';
import { extractCard, CARD_SELECTOR } from './lib/extract.js';
import { decideReprocess } from './lib/reprocess.js';

const pack = TDF_2026;
// Garde-fou principal contre le re-traitement ; doublé de l'attribut data-spoilguard
// (utile pour le debug/inspection et survivant si la carte est clonée sans le WeakSet).
const processed = new WeakSet();
// Handlers dblclick par carte → permet de garantir un seul listener (anti-accumulation)
// et de le détacher proprement au reset/à la révélation.
const dblHandlers = new WeakMap();

// Retrouve l'élément titre d'une carte (les deux familles de markup).
function findTitleEl(card) {
  return card.querySelector('#video-title, .ytLockupMetadataViewModelTitle');
}

// Attache le listener dblclick une seule fois par carte (correctif anti-accumulation).
function attachReveal(card, titleEl) {
  if (dblHandlers.has(card)) return; // déjà voilée avec un listener → ne pas empiler
  const handler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    reveal(card, titleEl);
  };
  dblHandlers.set(card, { el: titleEl, handler });
  titleEl.addEventListener('dblclick', handler);
}

function detachReveal(card) {
  const rec = dblHandlers.get(card);
  if (rec) {
    rec.el.removeEventListener('dblclick', rec.handler);
    dblHandlers.delete(card);
  }
}

// Retire nos décorations d'une carte voilée.
//   restoreText=true  (révélation, même vidéo) → on remet le titre ET l'aria d'origine.
//   restoreText=false (recyclage YouTube)      → on NE remet PAS le texte (YouTube a
//                       déjà écrit le nouveau titre : le restaurer l'écraserait) et on
//                       retire simplement notre aria (le nom accessible retombe sur le
//                       nouveau texte, avant que processCard ne re-voile si besoin).
function stripVeil(card, titleEl, restoreText) {
  const el = titleEl || findTitleEl(card);
  if (el) {
    if (restoreText && el.dataset.spoilguardOriginal != null) {
      el.textContent = el.dataset.spoilguardOriginal;
    }
    if (el.dataset.spoilguardAriaHad != null) {
      if (restoreText && el.dataset.spoilguardAriaHad === '1') {
        el.setAttribute('aria-label', el.dataset.spoilguardAriaOriginal ?? '');
      } else {
        el.removeAttribute('aria-label');
      }
      delete el.dataset.spoilguardAriaHad;
      delete el.dataset.spoilguardAriaOriginal;
    }
    el.classList.remove('spoilguard-safe-title');
    el.removeAttribute('title');
    delete el.dataset.spoilguardOriginal;
    delete el.dataset.spoilguardSafe;
  }
  card.classList.remove('spoilguard-veiled');
  detachReveal(card);
}

// Révélation par l'utilisateur : on découvre le vrai titre et on marque la carte
// comme révélée. Elle reste dans `processed` : on ne la re-voilera pas tant que la
// vidéo ne change pas (comparaison au titre mémorisé ici).
function reveal(card, titleEl) {
  const el = titleEl || findTitleEl(card);
  stripVeil(card, el, true);
  card.dataset.spoilguardRevealed = '1';
  card.dataset.spoilguardRevealedTitle = (el?.textContent || '').trim();
  card.setAttribute('data-spoilguard', 'revealed');
}

// Reset complet : carte recyclée pour une autre vidéo. On efface tout état (WeakSet,
// attributs data-*, classes, listener) SANS restaurer de texte périmé, puis
// processCard réévaluera le nouveau contenu.
function fullReset(card) {
  stripVeil(card, findTitleEl(card), false);
  processed.delete(card);
  card.removeAttribute('data-spoilguard');
  delete card.dataset.spoilguardSig;
  delete card.dataset.spoilguardRevealed;
  delete card.dataset.spoilguardRevealedTitle;
}

function veil(card, info) {
  card.classList.add('spoilguard-veiled');
  const titleEl = info.titleEl;
  if (!titleEl) return;

  if (titleEl.dataset.spoilguardOriginal == null) {
    titleEl.dataset.spoilguardOriginal = info.title;
  }
  const safe = buildLocalSafeTitle(pack, info.ageText);
  // On mémorise le texte injecté : sert de signature pour distinguer NOTRE écriture
  // (à ignorer) d'un vrai changement de titre par YouTube (recyclage → re-traiter).
  titleEl.dataset.spoilguardSafe = safe;
  // Sauvegarde de l'aria-label d'origine puis neutralisation : sans ça le vrai titre
  // fuite aux lecteurs d'écran (le nom accessible de l'ancre) malgré le voile visuel.
  if (titleEl.dataset.spoilguardAriaHad == null) {
    const origAria = titleEl.getAttribute('aria-label');
    if (origAria != null) titleEl.dataset.spoilguardAriaOriginal = origAria;
    titleEl.dataset.spoilguardAriaHad = origAria != null ? '1' : '0';
  }
  titleEl.setAttribute('aria-label', safe);
  titleEl.textContent = safe;
  titleEl.classList.add('spoilguard-safe-title');
  titleEl.title = 'SpoilGuard — double-clic pour révéler';
  attachReveal(card, titleEl);
}

function processCard(card) {
  if (processed.has(card)) return;
  // Carte révélée mais hors WeakSet (nav SPA : le DOM survit, le WeakSet non).
  // On respecte la révélation tant que la vidéo n'a pas changé ; sinon recyclage.
  if (card.dataset.spoilguardRevealed === '1') {
    const current = (findTitleEl(card)?.textContent || '').trim();
    if (current === (card.dataset.spoilguardRevealedTitle || '')) return;
    fullReset(card);
  }
  const info = extractCard(card);
  if (!info.videoId || !info.title) return; // carte pas encore peuplée, on repassera
  processed.add(card);
  if (shouldVeil(info, pack)) {
    veil(card, info);
    card.setAttribute('data-spoilguard', 'veiled');
  } else {
    card.setAttribute('data-spoilguard', 'clean');
  }
  // Signature de l'état stable : titre voilé injecté (voilée) ou titre d'origine
  // (clean). Sert de référence anti-boucle / détection de recyclage côté observer.
  card.dataset.spoilguardSig = (findTitleEl(card)?.textContent || '').trim();
}

// Appelé quand une mutation (childList ou characterData) touche une carte déjà vue.
// La décision est déléguée à decideReprocess (pure, testée) ; on n'exécute ici que
// l'effet DOM correspondant.
function reprocessCard(card) {
  const titleEl = findTitleEl(card);
  const decision = decideReprocess({
    isProcessed: processed.has(card),
    currentTitle: (titleEl?.textContent || '').trim(),
    safeTitle: card.dataset.spoilguardSig || '',
    revealed: card.dataset.spoilguardRevealed === '1',
    revealedTitle: card.dataset.spoilguardRevealedTitle || '',
  });
  if (decision === 'ignore') return;
  if (decision === 'reset') fullReset(card);
  processCard(card);
}

function scan(root) {
  if (root.matches?.(CARD_SELECTOR)) processCard(root);
  root.querySelectorAll?.(CARD_SELECTOR).forEach(processCard);
}

// Remonte de la cible d'une mutation (souvent un nœud texte) à la carte qui la contient.
function cardOf(target) {
  const el = target.nodeType === 1 ? target : target.parentElement;
  return el?.closest?.(CARD_SELECTOR) || null;
}

new MutationObserver((muts) => {
  for (const m of muts) {
    if (m.type === 'childList') {
      for (const n of m.addedNodes) if (n.nodeType === 1) scan(n);
      // Les titres YouTube sont peuplés/recyclés en remplaçant des nœuds (childList),
      // pas via characterData. Si la mutation vise l'intérieur d'une carte connue,
      // on relance la décision de re-traitement.
      const card = cardOf(m.target);
      if (card) reprocessCard(card);
    } else if (m.type === 'characterData') {
      // Filet complémentaire : édition in-place d'un nœud texte existant.
      const card = cardOf(m.target);
      if (card) reprocessCard(card);
    }
  }
}).observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
});

if (document.body) scan(document.body);
console.log('[SpoilGuard] actif —', pack.label);
