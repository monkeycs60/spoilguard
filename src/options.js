// Page options SpoilGuard — pur câblage DOM autour de chrome.storage.local.
// Source des compétitions : GET ${backendUrl}/competitions ; fallback = packs locaux
// (src/lib/pack.js) si le backend est injoignable — factorisé dans lib/catalog.js.
//
// NOTE : la section UI « Révéler tout pendant 10 min » a été retirée
// volontairement (décision produit). La logique gate.js/pauseUntil du content
// script reste en place mais dormante — plus aucune UI n'écrit `pauseUntil`.

import { t, applyI18n } from './lib/i18n.js';
import { loadCompetitions, resolveBase } from './lib/catalog.js';

const DEFAULT_COMPETITIONS = ['tdf-2026'];

const $ = (id) => document.getElementById(id);
const compsEl = $('competitions');
const statusEl = $('status');

let active = new Set(DEFAULT_COMPETITIONS);

function setStatus(msg) {
  statusEl.textContent = msg;
  if (msg) setTimeout(() => (statusEl.textContent = ''), 2000);
}

function storageGet(keys) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(keys, (v) => resolve(v || {}));
    } catch {
      resolve({});
    }
  });
}

function storageSet(obj) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set(obj, () => resolve());
    } catch {
      resolve();
    }
  });
}

// Teste la disponibilité du backend via GET /health et met à jour la pastille.
async function checkBackend(backendUrl) {
  const base = resolveBase(backendUrl);
  $('backendUrlDisplay').textContent = base;

  const pill = $('backendStatus');
  const text = $('backendStatusText');
  pill.className = 'status-pill';
  text.textContent = t('checking');

  let online = false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(base + '/health', { signal: ctrl.signal });
    clearTimeout(t);
    online = res.ok;
  } catch {
    online = false;
  }

  pill.classList.add(online ? 'online' : 'offline');
  text.textContent = online ? t('online') : t('offline');
}

function renderCompetitions(list) {
  compsEl.textContent = '';
  // On n'affiche que les compétitions actives côté catalogue (in-season / dispo).
  const shown = list.filter((c) => c.active !== false);
  for (const comp of shown) {
    const row = document.createElement('div');
    row.className = 'comp';

    const emoji = document.createElement('span');
    emoji.className = 'emoji';
    emoji.textContent = comp.emoji || '🛡️';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = comp.label || comp.id;
    const id = document.createElement('div');
    id.className = 'id';
    id.textContent = comp.id;
    meta.append(label, id);

    const sw = document.createElement('label');
    sw.className = 'switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = active.has(comp.id);
    input.addEventListener('change', () => toggleComp(comp.id, input.checked));
    const slider = document.createElement('span');
    slider.className = 'slider';
    sw.append(input, slider);

    row.append(emoji, meta, sw);
    compsEl.append(row);
  }
  if (!shown.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = t('noCompetitionsAvailable');
    compsEl.append(p);
  }
}

async function toggleComp(id, on) {
  if (on) active.add(id);
  else active.delete(id);
  await storageSet({ activeCompetitions: [...active] });
  setStatus(t('saved'));
}

async function init() {
  applyI18n();

  const store = await storageGet(['activeCompetitions', 'backendUrl']);

  active = new Set(
    Array.isArray(store.activeCompetitions) && store.activeCompetitions.length
      ? store.activeCompetitions
      : DEFAULT_COMPETITIONS,
  );

  const backendInput = $('backendUrl');
  backendInput.value = typeof store.backendUrl === 'string' ? store.backendUrl : '';
  backendInput.addEventListener('change', async () => {
    const v = backendInput.value.trim();
    await storageSet({ backendUrl: v });
    setStatus(t('urlSaved'));
    checkBackend(v);
    renderCompetitions(await loadCompetitions(v));
  });

  checkBackend(store.backendUrl);

  const list = await loadCompetitions(store.backendUrl);
  renderCompetitions(list);
}

init();
