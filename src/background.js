// Service worker SpoilGuard (MV3). Rôle : classifier les cartes voilées par le
// pré-filtre auprès du backend, sans jamais bloquer ni polluer la console.
//
// Communication content ↔ SW : UNIQUEMENT par messages (aucun import croisé).
// Le content script envoie { type:'classify', videos:[{videoId,title,channel}] } et
// reçoit { results:[{ videoId, spoiler, safeTitle } | { videoId, unavailable:true }] }.
//
// Stratégie :
//   - Cache par videoId dans chrome.storage.session (persiste tant que le navigateur
//     tourne, survit à l'endormissement du SW) → résultats connus renvoyés tout de suite.
//   - Agrégation/debounce 200ms : on empile les videoId manquants puis un seul POST.
//   - Batch ≤ 30 (le contrat backend l'impose) : on découpe si besoin.
//   - Backend down / timeout 4s / erreur → { unavailable:true } pour ces vidéos, sans
//     retry agressif. Circuit breaker : après 3 échecs consécutifs, on n'appelle plus
//     le backend pendant 60s (réponses unavailable immédiates).
//
// Invariant : aucune erreur non catchée ne doit remonter (console propre).

const DEFAULT_BACKEND = 'https://o2nn42t9tx9tzfukiamwlrnl.137.74.43.81.sslip.io'; // prod VPS (dev : chrome.storage.local.backendUrl = http://localhost:8787)
const DEFAULT_COMPETITIONS = ['tdf-2026'];
const DEBOUNCE_MS = 200;
const BATCH_MAX = 30;
const TIMEOUT_MS = 4000;
const CB_FAILURE_THRESHOLD = 3;
const CB_COOLDOWN_MS = 60_000;
const CACHE_PREFIX = 'sg:';

// --- État du circuit breaker (en mémoire ; réinitialisé si le SW est recyclé, ce qui
// revient simplement à redonner une chance au backend — comportement acceptable). ---
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

// --- File d'agrégation ---
const queue = new Map(); // videoId -> { videoId, title, channel }
const waiters = []; // { ids:string[], resolve }
let flushTimer = null;

function circuitOpen(now = Date.now()) {
  return now < circuitOpenUntil;
}

async function getBackendUrl() {
  try {
    const { backendUrl } = await chrome.storage.local.get('backendUrl');
    return typeof backendUrl === 'string' && backendUrl ? backendUrl : DEFAULT_BACKEND;
  } catch {
    return DEFAULT_BACKEND;
  }
}

// Compétitions actives choisies par l'utilisateur (page options). Envoyées au backend
// pour cadrer la classification. Défaut prudent si storage vide/inaccessible.
async function getCompetitions() {
  try {
    const { activeCompetitions } = await chrome.storage.local.get('activeCompetitions');
    return Array.isArray(activeCompetitions) && activeCompetitions.length
      ? activeCompetitions
      : DEFAULT_COMPETITIONS;
  } catch {
    return DEFAULT_COMPETITIONS;
  }
}

// Clé de cache scopée par compétitions actives (triées) + videoId. La classification
// DÉPEND des compétitions demandées : une même vidéo peut être « sans spoiler » pour
// une compétition et spoiler pour une autre. Scoper la clé empêche toute contamination
// inter-compétitions (C1) et invalide naturellement le cache au changement de
// compétitions actives (les anciennes clés ne sont plus consultées).
function cacheKey(competitions, id) {
  return CACHE_PREFIX + [...competitions].sort().join('+') + '|' + id;
}

// --- Cache chrome.storage.session (best-effort : toute erreur → cache vide/silencieux) ---
async function getCached(competitions, ids) {
  try {
    const keys = ids.map((id) => cacheKey(competitions, id));
    const obj = await chrome.storage.session.get(keys);
    const out = {};
    for (const id of ids) {
      const v = obj[cacheKey(competitions, id)];
      if (v) out[id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

async function setCached(competitions, results) {
  try {
    const obj = {};
    for (const r of results) {
      if (r && r.videoId) obj[cacheKey(competitions, r.videoId)] = r;
    }
    if (Object.keys(obj).length) await chrome.storage.session.set(obj);
  } catch {
    /* silencieux : le pire cas est de re-classifier plus tard */
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Appelle le backend pour un lot ≤ BATCH_MAX. Met en cache les résultats en cas de
// succès, met à jour le circuit breaker. Ne jette JAMAIS : un échec laisse simplement
// les vidéos non mises en cache (elles seront résolues en `unavailable`).
async function classifyBatch(batch, competitions) {
  const base = (await getBackendUrl()).replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(base + '/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ competitions, videos: batch }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const results = Array.isArray(data && data.results) ? data.results : [];
    await setCached(competitions, results.filter((r) => r && r.videoId));
    // Succès → on referme le circuit.
    consecutiveFailures = 0;
    circuitOpenUntil = 0;
  } catch {
    consecutiveFailures += 1;
    if (consecutiveFailures >= CB_FAILURE_THRESHOLD) {
      circuitOpenUntil = Date.now() + CB_COOLDOWN_MS;
    }
    // pas de mise en cache → résolution en `unavailable`
  } finally {
    clearTimeout(timer);
  }
}

// Résout un waiter à partir du cache : chaque videoId connu → son résultat, sinon
// `unavailable` (backend down, timeout, ou circuit ouvert).
async function resolveWaiter(w) {
  const cached = await getCached(w.competitions, w.ids);
  const results = w.ids.map(
    (id) => cached[id] || { videoId: id, unavailable: true },
  );
  w.resolve({ results });
}

async function flush() {
  flushTimer = null;
  // Snapshot : les messages arrivés PENDANT le flush repartent sur un nouveau cycle.
  const batchVideos = [...queue.values()];
  queue.clear();
  const currentWaiters = waiters.splice(0, waiters.length);

  try {
    if (batchVideos.length && !circuitOpen()) {
      // Compétitions actives lues une seule fois : sert de scope de cache commun à
      // l'écriture (classifyBatch) et à la lecture (resolveWaiter) de ce cycle.
      const competitions = await getCompetitions();
      for (const part of chunk(batchVideos, BATCH_MAX)) {
        await classifyBatch(part, competitions);
      }
    }
  } catch {
    /* garde-fou : classifyBatch ne jette pas, mais on reste défensif */
  }

  for (const w of currentWaiters) {
    try {
      await resolveWaiter(w);
    } catch {
      // Dernier filet : ne jamais laisser un waiter en suspens.
      try {
        w.resolve({ results: w.ids.map((id) => ({ videoId: id, unavailable: true })) });
      } catch {
        /* ignore */
      }
    }
  }
}

function scheduleFlush() {
  if (flushTimer != null) return;
  flushTimer = setTimeout(() => {
    flush();
  }, DEBOUNCE_MS);
}

async function handleClassify(rawVideos) {
  const videos = (Array.isArray(rawVideos) ? rawVideos : []).filter(
    (v) => v && v.videoId,
  );
  const ids = videos.map((v) => v.videoId);

  if (ids.length === 0) return { results: [] };

  // Scope de cache = compétitions actives (lues une fois par requête).
  const competitions = await getCompetitions();
  const cached = await getCached(competitions, ids);
  const missing = videos.filter((v) => !cached[v.videoId]);

  // Tout est déjà en cache → réponse immédiate, aucun appel réseau.
  if (missing.length === 0) {
    return { results: ids.map((id) => cached[id]) };
  }

  // Circuit ouvert → pas d'appel : cache pour ce qu'on a, unavailable pour le reste.
  if (circuitOpen()) {
    return {
      results: ids.map(
        (id) => cached[id] || { videoId: id, unavailable: true },
      ),
    };
  }

  // Empile les manquants et attend le prochain flush.
  for (const v of missing) {
    queue.set(v.videoId, {
      videoId: v.videoId,
      title: v.title || '',
      channel: v.channel || '',
    });
  }
  const promise = new Promise((resolve) => {
    waiters.push({ ids, competitions, resolve });
  });
  scheduleFlush();
  return promise;
}

// Réponse asynchrone : on retourne `true` pour garder le canal ouvert jusqu'à
// sendResponse. Toute erreur est catchée → réponse `unavailable` (jamais d'exception).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'classify') return false;
  const videos = Array.isArray(msg.videos) ? msg.videos : [];
  handleClassify(videos)
    .then(sendResponse)
    .catch(() => {
      sendResponse({
        results: videos
          .filter((v) => v && v.videoId)
          .map((v) => ({ videoId: v.videoId, unavailable: true })),
      });
    });
  return true;
});
