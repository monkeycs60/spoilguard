// Content script SpoilGuard — pur câblage DOM.
// Toute la décision vit dans des libs testées : pack.js, matcher.js, safeTitle.js,
// extract.js, reprocess.js. Ici on ne fait qu'observer le DOM et appliquer/révéler
// le voile, synchrone, avant paint.
import { PACKS, mergePacks } from './lib/pack.js';
import { shouldVeil } from './lib/matcher.js';
import { buildLocalSafeTitle } from './lib/safeTitle.js';
import { pickVeilPack } from './lib/veilPack.js';
import { veilingEnabled } from './lib/gate.js';
import { extractCard, CARD_SELECTOR } from './lib/extract.js';
import { decideReprocess, decideAgeUpdate, videoIdChanged } from './lib/reprocess.js';
import { backendDecision } from './lib/backendDecision.js';
import { previewDecision, parseVideoIdFromHref } from './lib/previewDecision.js';
import { shouldVeilAd } from './lib/adDecision.js';
import { addHoverGuard, removeHoverGuard } from './lib/hoverGuard.js';

// État mutable des compétitions actives + interrupteurs (pause / on-off). Rechargé
// depuis chrome.storage.local au démarrage et à chaque changement (sans reload).
// merged = pack fusionné (décide du voilage), packs = membres (choix de l'emoji).
const DEFAULT_COMPETITIONS = ['tdf-2026'];
const state = {
  competitions: DEFAULT_COMPETITIONS,
  packs: DEFAULT_COMPETITIONS.map((id) => PACKS[id]).filter(Boolean),
  merged: mergePacks(DEFAULT_COMPETITIONS),
  enabled: true,
  pauseUntil: 0,
};
// Filet de sécurité si le service worker ne répond jamais (MV3 endormi, contexte
// d'extension invalidé…) : au-delà de ce délai on abandonne silencieusement et le
// voile générique Phase 1 reste en place (dégradation gracieuse).
const BACKEND_TIMEOUT_MS = 5000;
// Page /watch : le h1 principal spoile aussi. On le traite comme une pseudo-carte
// (même logique shouldVeil + titre neutre + dblclic) via un sélecteur dédié. On ne
// touche JAMAIS au lecteur (#movie_player) : notre voile ne cible que ytd-watch-metadata.
const WATCH_SELECTOR = 'ytd-watch-metadata';
const WATCH_AGE_RE = /il y a|\bago\b/i;

function isWatchCard(card) {
  return !!card.matches?.(WATCH_SELECTOR);
}

// videoId RÉEL de la page /watch courante, relu à chaque appel depuis location.href :
// la navigation SPA (suggestion cliquée) change l'URL SANS reload ni recréation de la
// pseudo-carte, donc l'id doit être ré-évalué à chaque (re)traitement, jamais mis en
// cache. Réutilise le parseur testé de previewDecision. null si l'URL n'expose pas de v=.
function watchVideoId() {
  return parseVideoIdFromHref(globalThis.location?.href || '');
}

// Extraction spécifique à la pseudo-carte /watch (structure différente des cartes de
// liste). Le videoId est le VRAI id lu dans l'URL (et non un sentinelle) : la pseudo-carte
// est ainsi une carte à part entière → classifiable par le backend (retitrage riche,
// souvent servi instantanément depuis le cache session avec le même titre que la carte
// cliquée), comptabilisée dans le badge, et inscrite au registre des videoIds voilés
// (bloque aussi preview/mur de fin la concernant). Le garde « carte pas encore peuplée »
// repose désormais sur `title` (voir processCard : videoId présent dès le chargement de
// l'URL, mais on attend le H1).
function extractWatchCard(card) {
  const titleEl = card.querySelector(
    'h1.ytd-watch-metadata yt-formatted-string, h1 yt-formatted-string',
  );
  const title = titleEl?.textContent.trim() || '';
  const cn = card.querySelector('ytd-channel-name #text');
  const channel =
    (cn?.textContent || '')
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) || '';
  let ageText = null;
  for (const s of card.querySelectorAll('ytd-watch-info-text span')) {
    if (WATCH_AGE_RE.test(s.textContent)) {
      ageText = s.textContent.trim() || null;
      break;
    }
  }
  return { videoId: watchVideoId(), title, channel, ageText, titleEl };
}

// Sélectionne le bon extracteur selon le type de nœud (liste vs page /watch).
function extractAny(card) {
  return isWatchCard(card) ? extractWatchCard(card) : extractCard(card);
}
// Garde-fou principal contre le re-traitement ; doublé de l'attribut data-spoilguard
// (utile pour le debug/inspection et survivant si la carte est clonée sans le WeakSet).
const processed = new WeakSet();
// Handlers dblclick par carte → permet de garantir un seul listener (anti-accumulation)
// et de le détacher proprement au reset/à la révélation.
const dblHandlers = new WeakMap();

// --- État consolidé par carte (source de vérité) ----------------------------------
// Un SEUL objet d'état par carte dans un WeakMap remplace les ~9 canaux data-* qui
// vivaient sur la carte et sur son titre. Forme :
//   { status:'veiled'|'clean'|'revealed', videoId,
//     original:{ title, aria, hadAria },   // titre/aria d'origine (restaurés à la révélation)
//     safeTitle,                           // titre neutre injecté (marqueur « notre voile »)
//     sig,                                 // signature anti-boucle (titre stable courant)
//     age,                                 // âge affiché au moment du voile
//     backend:bool,                        // retitrée par le backend ?
//     revealedTitle }                      // vrai titre au moment de la révélation
// Deux data-* seulement subsistent dans le DOM : data-spoilguard (status, pour le
// querySelectorAll de rescanAll + le debug ; le CSS, lui, ne cible que des CLASSES) et
// data-spoilguard-video-id (registre des ids voilés, géré par add/removeVeiledId).
const cardState = new WeakMap();

// Lecture de l'état. Si le WeakMap est vide mais que la carte porte encore data-spoilguard
// (contexte du content script recréé alors que le DOM voilé/révélé survit), on réhydrate un
// état minimal depuis l'attribut pour continuer à respecter le statut — et, pour une carte
// révélée, sa révélation (on adopte le titre affiché, qui EST le vrai titre d'une révélée).
function getCardState(card) {
  let st = cardState.get(card);
  if (st) return st;
  const domStatus = card.getAttribute('data-spoilguard');
  if (!domStatus) return null;
  st = { status: domStatus };
  if (domStatus === 'revealed') {
    st.revealedTitle = (findTitleEl(card)?.textContent || '').trim();
  }
  cardState.set(card, st);
  return st;
}

// Écriture par patch (fusion superficielle). Reflète le seul champ `status` en attribut
// data-spoilguard (CSS/debug + repérage par rescanAll).
function setCardState(card, patch) {
  const next = Object.assign({}, cardState.get(card) || {}, patch);
  cardState.set(card, next);
  if ('status' in patch) {
    if (patch.status) card.setAttribute('data-spoilguard', patch.status);
    else card.removeAttribute('data-spoilguard');
  }
  return next;
}

// Efface tout l'état d'une carte (recyclage YouTube).
function clearCardState(card) {
  cardState.delete(card);
  card.removeAttribute('data-spoilguard');
}

// Ids déjà signalés au SW pour le compteur, à l'échelle de CETTE session de page. Le SW
// fait la dédup journalière autoritaire ; ce filtre local évite juste d'inonder le canal
// quand une carte recycle plusieurs fois le même id.
const reportedBlockedIds = new Set();

// Signale au service worker le blocage EFFECTIF d'une vidéo (1re fois pour ce videoId).
// Fire-and-forget : le SW maintient le compteur du jour + le badge. La pseudo-carte /watch
// a désormais un vrai videoId → elle compte comme un blocage (acceptable : c'est bien une
// vidéo spoiler voilée), le SW dédup le jour de toute façon.
function reportBlocked(videoId) {
  if (!videoId) return;
  if (reportedBlockedIds.has(videoId)) return;
  reportedBlockedIds.add(videoId);
  const rt = globalThis.chrome && chrome.runtime;
  if (!rt || typeof rt.sendMessage !== 'function') return;
  try {
    rt.sendMessage({ type: 'blocked', videoId }, () => {
      void rt.lastError; // lire lastError → pas de warning console si aucun récepteur
    });
  } catch {
    /* contexte d'extension invalidé (rechargement) → silencieux */
  }
}

// Registre des videoIds ACTUELLEMENT voilés. Sert aux fuites HORS carte : YouTube joue
// une preview vidéo (miniature + 1res secondes) dans un élément GLOBAL positionné
// par-dessus la carte, hors de sa portée CSS scopée ; on ne peut la bloquer qu'en
// reconnaissant son videoId. Alimenté au voilage, purgé au dé-voilage/révélation/
// recyclage (via addVeiledId/removeVeiledId branchés dans veil/stripVeil). Le retitrage
// backend garde la carte voilée → on la LAISSE dans le registre. Chaque carte mémorise
// « son » id voilé dans data-spoilguard-video-id : on retire du Set exactement ce qu'on
// y a mis, sans dépendre du videoId courant (que YouTube a pu recycler entre-temps).
const veiledVideoIds = new Set();

function addVeiledId(card, videoId) {
  // Inclut la pseudo-carte /watch (vrai videoId) : bloque aussi une preview globale ou une
  // tuile de mur de fin qui rejouerait CETTE vidéo par-dessus la page.
  if (!videoId) return;
  card.dataset.spoilguardVideoId = videoId;
  veiledVideoIds.add(videoId);
  refreshGlobalLeaks();
}

function removeVeiledId(card) {
  const id = card.dataset.spoilguardVideoId;
  if (id) {
    veiledVideoIds.delete(id);
    delete card.dataset.spoilguardVideoId;
    refreshGlobalLeaks();
  }
}

// Retrouve l'élément titre d'une carte (les deux familles de markup de liste + le
// h1 de la pseudo-carte /watch, pour que stripVeil/reveal retrouvent le bon nœud).
function findTitleEl(card) {
  return card.querySelector(
    '#video-title, .ytLockupMetadataViewModelTitle, .shortsLockupViewModelHostMetadataTitle a, ' +
      'h1.ytd-watch-metadata yt-formatted-string',
  );
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
  const st = getCardState(card) || {};
  const orig = st.original;
  const el = titleEl || findTitleEl(card);
  if (el) {
    if (restoreText && orig && orig.title != null) {
      el.textContent = orig.title;
    }
    if (orig && orig.hadAria != null) {
      if (restoreText && orig.hadAria) {
        el.setAttribute('aria-label', orig.aria ?? '');
      } else {
        el.removeAttribute('aria-label');
      }
    }
    el.classList.remove('spoilguard-safe-title');
    el.removeAttribute('title');
  }
  card.classList.remove('spoilguard-veiled');
  // Le « soft-veil » (desc masquée + miniature floutée sous un titre propre) peut spoiler
  // même quand le titre est neutre (« X a remporté l'étape » sous « Résumé de la 2e
  // étape », ou une miniature du vainqueur bras levés). stripVeil le retire par défaut
  // (révélation utilisateur, recyclage, vidéo trop vieille) ; backendUnveil le re-pose
  // explicitement derrière (et re-attache sa propre révélation soft).
  card.classList.remove('spoilguard-softveil');
  // La carte n'est plus voilée → retirer les intercepteurs de survol (la preview au
  // survol redevient permise). backendUnveil re-pose la garde juste après pour le soft-veil.
  removeHoverGuard(card);
  detachReveal(card);
  // La carte n'est plus voilée → la sortir du registre des videoIds voilés (débloque une
  // éventuelle preview globale la concernant). backendRetitle ne passe PAS ici (la carte
  // reste voilée) donc son id reste bien dans le registre.
  removeVeiledId(card);
  // Efface les champs de voile de l'état (titre/aria d'origine + titre neutre injecté).
  // Le statut est réglé par l'appelant (reveal → 'revealed', fullReset → effacé, etc.).
  setCardState(card, { original: undefined, safeTitle: undefined });
}

// Révélation par l'utilisateur : on découvre le vrai titre et on marque la carte
// comme révélée. Elle reste dans `processed` : on ne la re-voilera pas tant que la
// vidéo ne change pas (comparaison au titre mémorisé ici).
function reveal(card, titleEl) {
  const el = titleEl || findTitleEl(card);
  stripVeil(card, el, true);
  setCardState(card, {
    status: 'revealed',
    revealedTitle: (el?.textContent || '').trim(),
  });
}

// Révélation SOFT (carte blanchie par le backend : titre déjà propre, mais miniature
// floutée + description masquée via .spoilguard-softveil). Contrairement à `reveal`, on
// ne touche PAS au texte (le vrai titre est déjà affiché) : on retire seulement le
// soft-veil, on détache le listener, et on sort la carte du registre des videoIds voilés
// (plus rien de masqué → une preview globale la concernant peut de nouveau s'afficher).
// `revealedSoft` mémorise le geste pour ne jamais re-flouter la miniature au reprocess.
function revealSoft(card) {
  card.classList.remove('spoilguard-softveil');
  // Plus de soft-veil → la preview au survol est de nouveau permise sur cette carte.
  removeHoverGuard(card);
  detachReveal(card);
  removeVeiledId(card);
  setCardState(card, { status: 'clean', softveil: false, revealedSoft: true });
}

// Attache un dblclick LÉGER de révélation soft (une seule fois par carte, comme
// attachReveal). Posé par backendUnveil sur la carte blanchie : le double-clic ne fait
// que lever le soft-veil (miniature + description), sans réécrire le titre déjà propre.
function attachSoftReveal(card, titleEl) {
  if (dblHandlers.has(card)) return; // déjà un listener → ne pas empiler
  const el = titleEl || findTitleEl(card);
  if (!el) return;
  const handler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    revealSoft(card);
  };
  dblHandlers.set(card, { el, handler });
  el.addEventListener('dblclick', handler);
}

// Reset complet : carte recyclée pour une autre vidéo. On efface tout état (WeakSet,
// attributs data-*, classes, listener) SANS restaurer de texte périmé, puis
// processCard réévaluera le nouveau contenu.
function fullReset(card) {
  stripVeil(card, findTitleEl(card), false);
  processed.delete(card);
  clearCardState(card);
}

function veil(card, info) {
  card.classList.add('spoilguard-veiled');
  // Défense JS (shadow-DOM-proof) contre la preview vidéo au survol : on intercepte en
  // capture les évènements de survol au niveau de la carte → les listeners délégués de
  // YouTube ne voient jamais le hover, aucune preview ne démarre (voir lib/hoverGuard.js).
  // Posé dès le voilage, retiré par stripVeil (révélation / recyclage / dé-voile).
  addHoverGuard(card);
  const titleEl = info.titleEl;
  if (!titleEl) return;

  const st = getCardState(card) || {};
  // Sauvegarde du titre + de l'aria-label d'origine, une seule fois (ne pas écraser avec
  // notre propre titre neutre si la carte est déjà voilée). Sans neutralisation de l'aria,
  // le vrai titre fuite aux lecteurs d'écran (nom accessible de l'ancre) malgré le voile.
  let original = st.original;
  if (original == null) {
    const origAria = titleEl.getAttribute('aria-label');
    original = {
      title: info.title,
      aria: origAria != null ? origAria : undefined,
      hadAria: origAria != null,
    };
  }
  const safe = buildLocalSafeTitle(pickVeilPack(state.packs, info), info.ageText);
  titleEl.setAttribute('aria-label', safe);
  titleEl.textContent = safe;
  titleEl.classList.add('spoilguard-safe-title');
  titleEl.title = 'SpoilBlock — double-clic pour révéler';
  // safeTitle : sert de marqueur « notre voile » et de signature pour distinguer NOTRE
  // écriture (à ignorer) d'un vrai changement de titre par YouTube (recyclage → retraiter).
  // age : âge utilisé pour la décision → détecte l'arrivée tardive d'un âge réel différent.
  setCardState(card, {
    original,
    safeTitle: safe,
    age: info.ageText ?? '',
    videoId: info.videoId,
    backend: false,
  });
  attachReveal(card, titleEl);
  // Enregistre le videoId voilé pour bloquer les fuites hors carte (preview globale,
  // mur de fin de lecture) qui afficheraient cette vidéo par-dessus/hors de la carte.
  addVeiledId(card, info.videoId);
  // Compteur : signale ce blocage au SW (dédup + badge côté service worker).
  reportBlocked(info.videoId);
}

function processCard(card) {
  if (processed.has(card)) return;
  // Carte révélée mais hors WeakMap (contexte content-script recréé : le DOM survit, l'état
  // JS non). On respecte la révélation tant que la vidéo n'a pas changé ; sinon recyclage.
  const st = getCardState(card);
  if (st && st.status === 'revealed') {
    const current = (findTitleEl(card)?.textContent || '').trim();
    if (current === (st.revealedTitle || '')) return;
    fullReset(card);
  }
  const info = extractAny(card);
  if (!info.videoId || !info.title) return; // carte pas encore peuplée, on repassera
  // Pause (« révéler 10 min ») ou extension coupée : on ne voile RIEN et on ne marque
  // pas la carte comme traitée, pour qu'elle soit re-voilée dès la reprise (prochain
  // scan / mutation), sans reload.
  if (!veilingEnabled(state)) {
    setCardState(card, {
      status: 'clean',
      sig: (findTitleEl(card)?.textContent || '').trim(),
    });
    return;
  }
  processed.add(card);
  if (shouldVeil(info, state.merged)) {
    veil(card, info);
    setCardState(card, { status: 'veiled' });
    // Le pré-filtre a voilé par prudence : on demande l'avis du backend (async). En
    // attendant, et si le backend est indisponible, le voile générique reste (Phase 1).
    requestBackendClassification(card, info);
  } else {
    setCardState(card, { status: 'clean' });
  }
  // Signature de l'état stable : titre voilé injecté (voilée) ou titre d'origine
  // (clean). Sert de référence anti-boucle / détection de recyclage côté observer.
  setCardState(card, { sig: (findTitleEl(card)?.textContent || '').trim() });
}

// Appelé quand une mutation (childList ou characterData) touche une carte déjà vue.
// La décision est déléguée à decideReprocess (pure, testée) ; on n'exécute ici que
// l'effet DOM correspondant.
function reprocessCard(card) {
  const titleEl = findTitleEl(card);
  const st = getCardState(card) || {};
  // Garde-fou recyclage SPA de la pseudo-carte /watch : l'élément ytd-watch-metadata est
  // réutilisé d'une vidéo à l'autre (navigation sans reload) ; le titre peut muter par
  // étapes (métadonnées avant H1), donc on tranche sur le videoId — id mémorisé au voilage
  // vs id de l'URL courante. Différents → autre vidéo → reset complet AVANT réévaluation
  // (re-voile + reclassification backend du nouveau titre). La révélation utilisateur est
  // laissée au chemin existant (decideReprocess compare au titre révélé).
  if (
    isWatchCard(card) &&
    processed.has(card) &&
    st.status !== 'revealed' &&
    videoIdChanged(st.videoId, watchVideoId())
  ) {
    fullReset(card);
    processCard(card);
    return;
  }
  const decision = decideReprocess({
    isProcessed: processed.has(card),
    currentTitle: (titleEl?.textContent || '').trim(),
    safeTitle: st.sig || '',
    revealed: st.status === 'revealed',
    revealedTitle: st.revealedTitle || '',
  });
  if (decision === 'ignore') {
    // La carte est stable pour decideReprocess, MAIS si elle est voilée son âge a pu
    // arriver/​changer depuis la pose du voile → réévaluer (correctif sur-voile).
    maybeUpdateVeiledAge(card, titleEl);
    return;
  }
  if (decision === 'reset') fullReset(card);
  processCard(card);
}

// Correctif « sur-voile des vieilles vidéos ». processCard peut voiler par prudence
// une carte dont #metadata-line n'est pas encore peuplé (ageText null → « vidéo
// récente »). Quand les métadonnées arrivent, decideReprocess conclut 'ignore' (le
// titre courant est notre titre neutre) et l'âge réel n'est jamais reconsidéré. Ici,
// sur une carte voilée, on ré-extrait l'âge ; s'il est réel et différent du stocké on
// rejoue shouldVeil : dé-voile complet si la vidéo n'est en fait pas récente, sinon
// simple rafraîchissement du titre neutre (l'âge affiché a changé).
function maybeUpdateVeiledAge(card, titleEl) {
  const st = getCardState(card);
  if (!st || st.status !== 'veiled') return;
  // Carte déjà retitrée par le backend (titre neutre riche) : ne pas la réécrire avec
  // le titre générique local sur simple arrivée d'âge — le backend fait autorité.
  if (st.backend) return;
  const el = titleEl || findTitleEl(card);
  if (!el || st.safeTitle == null) return; // pas (ou plus) notre voile
  const info = extractAny(card);
  const verdict = decideAgeUpdate({
    storedAge: st.age || '',
    newAge: info.ageText,
  });
  if (verdict !== 'reevaluate') return;

  const original = st.original && st.original.title != null ? st.original.title : info.title;
  const stillVeil = shouldVeil(
    { channel: info.channel, ageText: info.ageText, title: original },
    state.merged,
  );
  if (!stillVeil) {
    // Faux positif : la vidéo n'est pas récente → dé-voile complet, carte clean.
    stripVeil(card, el, true);
    processed.add(card); // reste traitée : ne pas re-voiler à la prochaine mutation
    setCardState(card, {
      status: 'clean',
      sig: (findTitleEl(card)?.textContent || '').trim(),
      age: undefined,
    });
  } else {
    // Toujours à voiler mais l'âge affiché a changé → rafraîchir le titre neutre,
    // la signature anti-boucle et l'âge stocké (sinon rejeu à l'infini).
    const safe = buildLocalSafeTitle(pickVeilPack(state.packs, info), info.ageText);
    el.setAttribute('aria-label', safe);
    el.textContent = safe;
    setCardState(card, { safeTitle: safe, sig: safe, age: info.ageText ?? '' });
  }
}

// --- Intégration backend (Phase 2b) ---------------------------------------------
// Le content script et le service worker ne communiquent QUE par messages. On envoie
// la carte voilée au SW ; à la réponse on délègue la décision à backendDecision (pure,
// testée) et on n'applique ici que l'effet DOM. Aucune réponse (SW endormi, contexte
// invalidé, timeout) → on ne fait rien, le voile générique Phase 1 subsiste.
function requestBackendClassification(card, info) {
  const videoId = info.videoId;
  // La pseudo-carte /watch a désormais un vrai videoId → elle est envoyée au backend comme
  // les cartes de liste (cache session → souvent un hit instantané rendant le MÊME titre
  // réécrit que la carte cliquée, au lieu du voile générique).
  if (!videoId) return;
  const rt = globalThis.chrome && chrome.runtime;
  if (!rt || typeof rt.sendMessage !== 'function') return;

  let settled = false;
  const timer = setTimeout(() => {
    // Filet MV3 : pas de réponse dans les temps → abandon silencieux.
    settled = true;
  }, BACKEND_TIMEOUT_MS);

  try {
    rt.sendMessage(
      {
        type: 'classify',
        videos: [{ videoId, title: info.title, channel: info.channel }],
      },
      (resp) => {
        // Toujours lire lastError pour éviter un warning console si pas de récepteur.
        const err = rt.lastError;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) return; // SW indisponible → fallback silencieux
        const results = resp && Array.isArray(resp.results) ? resp.results : [];
        const result =
          results.find((r) => r && r.videoId === videoId) || results[0] || null;
        applyBackendResult(card, result);
      },
    );
  } catch {
    // Contexte d'extension invalidé (rechargement) → silencieux.
    settled = true;
    clearTimeout(timer);
  }
}

// Applique la décision backend à la carte, en relisant son état ACTUEL (elle a pu être
// révélée, recyclée ou dé-voilée depuis l'envoi).
function applyBackendResult(card, result) {
  const titleEl = findTitleEl(card);
  const st = getCardState(card) || {};
  const veiled = st.status === 'veiled' && titleEl != null && st.safeTitle != null;
  const revealed = st.status === 'revealed';
  const currentVideoId = extractAny(card).videoId;
  const decision = backendDecision({
    result,
    veiled,
    revealed,
    videoId: currentVideoId,
    // Seuil d'âge de la compétition (pack fusionné) + horloge courante → la lib décide,
    // pure, si une vraie carte spoiler est trop vieille pour encore spoiler (unveil-old).
    maxAgeHours: state.merged.maxAgeHours,
    now: Date.now(),
  });

  // 'unveil' (faux positif) et 'unveil-old' (spoiler mais publiée avant le seuil d'âge)
  // → même dé-voilement définitif : la carte est marquée clean et ne sera plus re-voilée.
  if (decision === 'unveil' || decision === 'unveil-old') backendUnveil(card, titleEl);
  else if (decision === 'retitle') backendRetitle(card, titleEl, result.safeTitle);
  // 'noop' → rien : le voile générique Phase 1 reste (dégradation gracieuse).
}

// Faux positif confirmé par le backend → dé-voile complet et carte marquée clean
// DÉFINITIVEMENT pour ce videoId : on la met dans `processed` et on aligne la
// signature sur le titre restauré, si bien que le pré-filtre / decideReprocess
// concluent 'ignore' et ne la re-voilent jamais en boucle (même mécanisme que la
// branche clean de maybeUpdateVeiledAge).
function backendUnveil(card, titleEl) {
  const prev = getCardState(card) || {};
  const el = titleEl || findTitleEl(card);
  stripVeil(card, el, true);
  processed.add(card);
  // Titre blanchi par le LLM ≠ carte inoffensive : la DESCRIPTION peut contenir le
  // résultat (« Isaac Del Toro a remporté l'étape… » sous un titre neutre) et la
  // MINIATURE peut montrer le vainqueur bras levés. On pose donc un « soft-veil » (desc
  // masquée + miniature floutée) à vie pour cette carte — seul un double-clic utilisateur
  // (révélation soft) ou un recyclage (fullReset via stripVeil) le lève. Si l'utilisateur
  // avait déjà révélé le soft-veil auparavant, on respecte son geste (pas de re-floutage).
  if (prev.revealedSoft) {
    setCardState(card, {
      status: 'clean',
      sig: (findTitleEl(card)?.textContent || '').trim(),
      age: undefined,
      backend: false,
    });
    return;
  }
  card.classList.add('spoilguard-softveil');
  // Le soft-veil floute encore la miniature → la preview au survol rejouerait la vidéo en
  // clair. stripVeil a retiré la garde de survol ; on la re-pose pour le soft-veil (retirée
  // à la révélation soft via revealSoft).
  addHoverGuard(card);
  // stripVeil a sorti la carte du registre des videoIds voilés (elle n'est plus
  // .spoilguard-veiled). Or, tant que le soft-veil est actif, la preview vidéo GLOBALE au
  // survol (ytd-video-preview) rejouerait la miniature/les 1res secondes en clair — hors
  // portée CSS scopée. On ré-inscrit donc le videoId au registre pour continuer à bloquer
  // preview + mur de fin la concernant (retiré à la révélation soft via revealSoft).
  addVeiledId(card, extractAny(card).videoId);
  // Re-attache un dblclick léger : la carte n'a plus de listener (stripVeil l'a détaché),
  // mais elle doit rester révélable pour lever le soft-veil.
  attachSoftReveal(card, el);
  setCardState(card, {
    status: 'clean',
    sig: (findTitleEl(card)?.textContent || '').trim(),
    age: undefined,
    backend: false,
    softveil: true,
  });
}

// Vraie carte spoiler → on remplace le titre générique par le safeTitle du backend en
// réutilisant exactement la mécanique du refresh d'âge (state.safeTitle / aria / state.sig).
// state.original (vrai titre) et le listener dblclick restent intacts : la révélation
// continue de fonctionner.
function backendRetitle(card, titleEl, safeTitle) {
  const el = titleEl || findTitleEl(card);
  const st = getCardState(card) || {};
  if (!el || st.safeTitle == null) return; // plus notre voile
  el.setAttribute('aria-label', safeTitle);
  el.textContent = safeTitle;
  setCardState(card, { safeTitle, sig: safeTitle, backend: true });
}

// --- Fuites HORS carte (overlays / éléments globaux) ------------------------------
// YouTube affiche du contenu voilé HORS de la portée CSS scopée .spoilguard-veiled :
//   1) ytd-video-preview : preview vidéo GLOBALE jouée au survol d'une carte, posée
//      par-dessus (miniature + 1res secondes en clair). Porte active/playing quand
//      elle joue ; son videoId est dans un lien interne a[href*="watch?v="].
//   2) mur de fin de lecture /watch (.ytp-endscreen-content) : tuiles a.ytp-videowall-still
//      suggérant d'autres vidéos, titres/vignettes en clair (même document que la page).
// La décision (videoId ∈ registre → bloquer) est déléguée à previewDecision (pure,
// testée) ; ici seulement le câblage DOM : pose/retire la classe + met la vidéo en pause.
const PREVIEW_BLOCKED_CLASS = 'spoilguard-preview-blocked';

let previewEl = null;
let previewObserver = null;

// Bloque/débloque l'élément de preview global selon le videoId qu'il s'apprête à jouer.
function updatePreviewBlock(el) {
  if (!el) return;
  const link = el.querySelector('a[href*="watch?v="]');
  const videoId = parseVideoIdFromHref(link?.getAttribute('href'));
  if (previewDecision(videoId, veiledVideoIds)) {
    el.classList.add(PREVIEW_BLOCKED_CLASS);
    el.querySelector('video')?.pause?.();
  } else {
    el.classList.remove(PREVIEW_BLOCKED_CLASS);
  }
}

// ytd-video-preview est unique/persistant mais peut n'exister qu'après le 1er survol. On
// l'attache dès qu'il apparaît, puis on observe ses attributs (active/playing) et son
// sous-arbre (le href de la preview change quand on survole une autre carte).
function ensurePreviewObserver() {
  if (previewObserver) return;
  const el = document.querySelector('ytd-video-preview');
  if (!el) return;
  previewEl = el;
  updatePreviewBlock(el);
  previewObserver = new MutationObserver(() => updatePreviewBlock(el));
  previewObserver.observe(el, {
    attributes: true,
    attributeFilter: ['active', 'playing', 'href'],
    childList: true,
    subtree: true,
  });
}

// Mur de fin de lecture : masque les tuiles dont le videoId est voilé (même contrat).
function updateEndscreenBlocks() {
  for (const still of document.querySelectorAll('a.ytp-videowall-still')) {
    const videoId = parseVideoIdFromHref(still.getAttribute('href'));
    still.classList.toggle(PREVIEW_BLOCKED_CLASS, previewDecision(videoId, veiledVideoIds));
  }
}

// Un nœud ajouté fait-il (ou contient-il) une tuile de mur de fin de lecture ?
function touchesEndscreen(node) {
  return (
    node.matches?.('a.ytp-videowall-still, .ytp-endscreen-content') ||
    !!node.querySelector?.('a.ytp-videowall-still')
  );
}

// Ré-applique les décisions de blocage quand le REGISTRE change (voile/dé-voile), sans
// attendre une mutation de l'overlay — ex : le backend dé-voile une carte pendant que sa
// preview est encore affichée. Best-effort et silencieux (peut tourner avant tout paint).
function refreshGlobalLeaks() {
  if (previewEl) updatePreviewBlock(previewEl);
  updateEndscreenBlocks();
}

// --- Cartes SPONSORISÉES (pubs) ---------------------------------------------------
// Les renderers publicitaires ont un markup distinct des cartes vidéo (pas dans
// CARD_SELECTOR) et ne passent donc ni par le pré-filtre ni par le backend : une pub
// pour une chaîne sport peut afficher image + texte spoiler en clair. Traitement
// pragmatique et SÛR : pré-filtre LEXICAL uniquement (shouldVeilAd sur le textContent
// agrégé + packs actifs) → si match, on floute tout le bloc (classe .spoilguard-ad-veiled)
// et on remplace le titre, si on en identifie un, par un libellé générique. Aucun appel
// backend (pas de videoId fiable). Double-clic pour révéler. Toujours défensif :
// visibility/filter, jamais de remove/display:none sur le bloc lui-même (layout intact).
const AD_SELECTOR = [
  'ytd-ad-slot-renderer',
  'ytd-in-feed-ad-layout-renderer',
  'ytd-promoted-sparkles-web-renderer',
  'ytd-promoted-video-renderer',
  'ytd-display-ad-renderer',
].join(',');
const AD_SAFE_TITLE = '🛡️ Publicité liée à une compétition suivie';

// État par bloc pub : { status:'veiled'|'revealed', titleEl, original } et handler dblclick.
const adState = new WeakMap();
const adHandlers = new WeakMap();

// Titre d'une pub, si identifiable (markup très variable) — best-effort, multi-sélecteurs.
// Null → on se contente de flouter les images (pas de libellé générique injecté).
function findAdTitleEl(node) {
  return node.querySelector(
    '#video-title, .ytLockupMetadataViewModelTitle, #headline, span#title, ' +
      'yt-formatted-string#title, [id*="headline"]',
  );
}

function attachAdReveal(node, el) {
  if (adHandlers.has(node)) return;
  const handler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    revealAd(node);
  };
  adHandlers.set(node, { el, handler });
  el.addEventListener('dblclick', handler);
}

// Retire notre voile publicitaire : classe, libellé générique (titre d'origine restauré),
// listener et état. N'échoue jamais sur un bloc partiel (garde-fous sur chaque étape).
function stripAdVeil(node) {
  node.classList.remove('spoilguard-ad-veiled');
  removeHoverGuard(node);
  const rec = adHandlers.get(node);
  if (rec) {
    rec.el.removeEventListener('dblclick', rec.handler);
    adHandlers.delete(node);
  }
  const st = adState.get(node);
  if (st && st.titleEl && st.original != null) {
    st.titleEl.textContent = st.original;
    st.titleEl.classList.remove('spoilguard-safe-title');
    st.titleEl.removeAttribute('title');
  }
  adState.delete(node);
  delete node.dataset.spoilguardAd;
}

function veilAd(node) {
  node.classList.add('spoilguard-ad-veiled');
  // Même garde anti-preview de survol que pour les cartes vidéo (une pub peut aussi jouer
  // un aperçu au survol). Retirée par stripAdVeil.
  addHoverGuard(node);
  const titleEl = findAdTitleEl(node);
  if (titleEl) {
    const original = titleEl.textContent;
    titleEl.textContent = AD_SAFE_TITLE;
    titleEl.classList.add('spoilguard-safe-title');
    titleEl.title = 'SpoilBlock — double-clic pour révéler';
    adState.set(node, { status: 'veiled', titleEl, original });
  } else {
    adState.set(node, { status: 'veiled', titleEl: null, original: null });
  }
  node.dataset.spoilguardAd = 'veiled';
  // Listener sur le bloc entier (le dblclick sur le titre bulle jusqu'ici) : révèle sans
  // déclencher la navigation vers l'annonceur (preventDefault/stopPropagation).
  attachAdReveal(node, node);
}

// Révélation utilisateur d'une pub voilée : on restaure tout, puis on MÉMORISE le geste
// (status 'revealed') pour ne jamais re-voiler ce bloc — même à un re-scan.
function revealAd(node) {
  stripAdVeil(node);
  adState.set(node, { status: 'revealed', titleEl: null, original: null });
  node.dataset.spoilguardAd = 'revealed';
}

function processAd(node) {
  const st = adState.get(node);
  // Décision déjà prise (voilée) ou geste utilisateur respecté (révélée) → ne rien faire.
  if (st && (st.status === 'veiled' || st.status === 'revealed')) return;
  // Pause / extension coupée : ne rien voiler ; sans marquage, le bloc sera réévalué à la
  // reprise (prochain scan / mutation).
  if (!veilingEnabled(state)) return;
  const text = node.textContent || '';
  if (!text.trim()) return; // bloc pas encore peuplé, on repassera
  if (!shouldVeilAd(text, state.merged)) return;
  veilAd(node);
}

// Filet défensif (couche 3) : si malgré la garde de survol un élément <video> apparaît
// (ou est déplacé) DANS une carte voilée / soft-veilée / pub voilée, on le neutralise
// immédiatement — pause + retour à 0 — pour qu'aucune image nette ni son ne fuite. La
// garde de survol empêche normalement le player de démarrer ; ce filet couvre les insertions
// résiduelles (players réutilisés/déplacés par YouTube) que l'observer voit passer.
const VEILED_ANY_SELECTOR =
  '.spoilguard-veiled, .spoilguard-softveil, .spoilguard-ad-veiled';

function neutralizeVeiledVideo(video) {
  if (!video || typeof video.pause !== 'function') return;
  if (!video.closest?.(VEILED_ANY_SELECTOR)) return;
  try {
    video.pause();
    video.currentTime = 0;
  } catch {
    /* élément détaché / état transitoire → sans effet, silencieux */
  }
}

function neutralizeVeiledVideosIn(node) {
  if (node.nodeType !== 1) return;
  if (node.matches?.('video')) neutralizeVeiledVideo(node);
  node.querySelectorAll?.('video').forEach(neutralizeVeiledVideo);
}

function scan(root) {
  if (root.matches?.(CARD_SELECTOR) || root.matches?.(WATCH_SELECTOR)) processCard(root);
  root.querySelectorAll?.(CARD_SELECTOR).forEach(processCard);
  root.querySelectorAll?.(WATCH_SELECTOR).forEach(processCard);
  if (root.matches?.(AD_SELECTOR)) processAd(root);
  root.querySelectorAll?.(AD_SELECTOR).forEach(processAd);
}

// Ré-applique l'état courant (compétitions actives + pause/on-off) aux cartes déjà
// vues, sans reload : on réinitialise chaque carte (hors cartes révélées par l'utilisateur,
// dont on respecte le geste) puis on la re-traite. Sert quand l'utilisateur change ses
// compétitions ou déclenche/lève une pause depuis les options/le popup.
function rescanAll() {
  document.querySelectorAll?.('[data-spoilguard]').forEach((card) => {
    // Ne pas défaire une révélation utilisateur.
    if ((getCardState(card) || {}).status === 'revealed') return;
    fullReset(card);
    processCard(card);
  });
  // Idem pour les pubs voilées : on lève le voile (hors pubs révélées par l'utilisateur)
  // afin que le re-scan les réévalue contre le nouveau pack fusionné (une pub voilée pour
  // une compétition retirée doit se dé-voiler ; une pub d'une compétition ajoutée se voiler).
  document.querySelectorAll?.('[data-spoilguard-ad]').forEach((node) => {
    if ((adState.get(node) || {}).status === 'revealed') return;
    stripAdVeil(node);
  });
  if (document.body) scan(document.body);
}

// Recharge l'état depuis un snapshot de chrome.storage.local (défauts prudents).
function applyStoredState(store) {
  const comps =
    Array.isArray(store.activeCompetitions) && store.activeCompetitions.length
      ? store.activeCompetitions
      : DEFAULT_COMPETITIONS;
  state.competitions = comps;
  state.packs = comps.map((id) => PACKS[id]).filter(Boolean);
  state.merged = mergePacks(comps);
  state.enabled = store.enabled !== false; // défaut true
  state.pauseUntil = typeof store.pauseUntil === 'number' ? store.pauseUntil : 0;
}

// Remonte de la cible d'une mutation (souvent un nœud texte) à la carte qui la contient.
function cardOf(target) {
  const el = target.nodeType === 1 ? target : target.parentElement;
  return el?.closest?.(`${CARD_SELECTOR},${WATCH_SELECTOR}`) || null;
}

// Idem pour un bloc pub : les annonces se peuplent parfois APRÈS insertion (texte/image
// arrivant en second) → une mutation interne doit relancer la décision de voile lexical.
function adOf(target) {
  const el = target.nodeType === 1 ? target : target.parentElement;
  return el?.closest?.(AD_SELECTOR) || null;
}

new MutationObserver((muts) => {
  for (const m of muts) {
    if (m.type === 'childList') {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        scan(n);
        // Filet : un <video> inséré/déplacé dans une carte voilée est mis en pause + rembobiné.
        neutralizeVeiledVideosIn(n);
        // Le mur de fin de lecture apparaît/​se peuple par ajout de nœuds : dès qu'une
        // tuile arrive, réévaluer le blocage (pas d'observer dédié → aucun surcoût en
        // lecture normale).
        if (touchesEndscreen(n)) updateEndscreenBlocks();
      }
      // Les titres YouTube sont peuplés/recyclés en remplaçant des nœuds (childList),
      // pas via characterData. Si la mutation vise l'intérieur d'une carte connue,
      // on relance la décision de re-traitement.
      const card = cardOf(m.target);
      if (card) reprocessCard(card);
      const ad = adOf(m.target);
      if (ad) processAd(ad);
    } else if (m.type === 'characterData') {
      // Filet complémentaire : édition in-place d'un nœud texte existant.
      const card = cardOf(m.target);
      if (card) reprocessCard(card);
      const ad = adOf(m.target);
      if (ad) processAd(ad);
    }
  }
  // ytd-video-preview peut apparaître à tout moment (1er survol) → tenter de l'attacher.
  ensurePreviewObserver();
}).observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
});

if (document.body) scan(document.body);
ensurePreviewObserver();

// Charge l'état persistant (compétitions actives, pause, on/off) puis re-applique.
// Best-effort : hors contexte extension (tests, injection manuelle) → défauts en dur.
const STORAGE_KEYS = ['activeCompetitions', 'enabled', 'pauseUntil'];
try {
  if (globalThis.chrome && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(STORAGE_KEYS, (store) => {
      if (chrome.runtime && chrome.runtime.lastError) return;
      applyStoredState(store || {});
      rescanAll();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (!STORAGE_KEYS.some((k) => k in changes)) return;
      chrome.storage.local.get(STORAGE_KEYS, (store) => {
        if (chrome.runtime && chrome.runtime.lastError) return;
        applyStoredState(store || {});
        rescanAll();
      });
    });
  }
} catch {
  /* contexte d'extension indisponible → on reste sur les défauts */
}

console.log('[SpoilBlock] actif —', state.merged.label);
