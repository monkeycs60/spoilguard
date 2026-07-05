// Page options SpoilGuard — pur câblage DOM autour de chrome.storage.local.
// Source des compétitions : GET ${backendUrl}/competitions ; fallback = packs locaux
// (src/lib/pack.js) si le backend est injoignable.

import { PACKS } from './lib/pack.js';

const DEFAULT_BACKEND = 'https://o2nn42t9tx9tzfukiamwlrnl.137.74.43.81.sslip.io';
const DEFAULT_COMPETITIONS = ['tdf-2026'];
const PAUSE_MS = 10 * 60 * 1000;

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

// Packs locaux formatés comme la réponse backend (fallback offline).
function localCompetitions() {
  return Object.values(PACKS).map((p) => ({
    id: p.id,
    label: p.label,
    emoji: p.emoji,
    active: true,
  }));
}

async function loadCompetitions(backendUrl) {
  const base = (backendUrl || DEFAULT_BACKEND).replace(/\/+$/, '');
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(base + '/competitions', { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const list = Array.isArray(data && data.competitions) ? data.competitions : [];
    if (!list.length) throw new Error('vide');
    return list;
  } catch {
    return localCompetitions();
  }
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
    compsEl.innerHTML = '<p class="hint">Aucune compétition disponible.</p>';
  }
}

async function toggleComp(id, on) {
  if (on) active.add(id);
  else active.delete(id);
  await storageSet({ activeCompetitions: [...active] });
  setStatus('Enregistré');
}

function refreshPauseState(pauseUntil) {
  const el = $('pauseState');
  const remaining = typeof pauseUntil === 'number' ? pauseUntil - Date.now() : 0;
  if (remaining > 0) {
    el.textContent = `Actif encore ${Math.ceil(remaining / 60000)} min`;
  } else {
    el.textContent = '';
  }
}

async function init() {
  const store = await storageGet([
    'activeCompetitions',
    'backendUrl',
    'pauseUntil',
  ]);

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
    setStatus('URL enregistrée');
    renderCompetitions(await loadCompetitions(v));
  });

  $('reveal').addEventListener('click', async () => {
    const pauseUntil = Date.now() + PAUSE_MS;
    await storageSet({ pauseUntil });
    refreshPauseState(pauseUntil);
    setStatus('Révélation activée pour 10 min');
  });

  refreshPauseState(store.pauseUntil);

  const list = await loadCompetitions(store.backendUrl);
  renderCompetitions(list);
}

init();
