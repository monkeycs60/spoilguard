// Popup SpoilGuard — interrupteur global + pause 10 min + compteur du jour + badges.
// Pur câblage DOM autour de chrome.storage.local. Aucune logique métier :
// on ne fait que lire/écrire les clés existantes (enabled, pauseUntil,
// activeCompetitions) plus la lecture du compteur (dailyBlockedCount /
// dailyBlockedDate) écrit par le content script.

import { PACKS } from './lib/pack.js';

const PAUSE_MS = 10 * 60 * 1000;
const DEFAULT_COMPETITIONS = ['tdf-2026'];
const $ = (id) => document.getElementById(id);

let tick = null;

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

// Le compteur n'est valable que s'il porte sur la date du jour. On tolère
// plusieurs formats de date possibles pour rester robuste vis-à-vis de l'agent
// qui écrit le compteur (ISO, locale en-CA, toDateString).
function todayMatches(date) {
  if (!date) return true; // pas de date → on fait confiance au compteur brut
  const now = new Date();
  return (
    date === now.toISOString().slice(0, 10) ||
    date === now.toLocaleDateString('en-CA') ||
    date === now.toDateString()
  );
}

function renderCount(store) {
  const raw = store.dailyBlockedCount;
  const n =
    typeof raw === 'number' && raw > 0 && todayMatches(store.dailyBlockedDate)
      ? raw
      : 0;
  $('blockedCount').textContent = String(n);
  $('blockedNoun').textContent = n > 1 ? 'spoilers bloqués' : 'spoiler bloqué';
}

function renderEnabled(enabled) {
  $('enabled').checked = enabled;
  $('guard').classList.toggle('on', enabled);
  $('guardLabel').textContent = enabled ? 'Protection active' : 'Protection désactivée';
}

function renderBadges(activeCompetitions) {
  const ids =
    Array.isArray(activeCompetitions) && activeCompetitions.length
      ? activeCompetitions
      : DEFAULT_COMPETITIONS;
  const el = $('badges');
  el.textContent = '';
  const known = ids.map((id) => PACKS[id]).filter(Boolean);
  if (!known.length) {
    const empty = document.createElement('span');
    empty.className = 'badge empty';
    empty.textContent = 'Aucune compétition';
    el.append(empty);
    return;
  }
  for (const pack of known) {
    const b = document.createElement('span');
    b.className = 'badge';
    const e = document.createElement('span');
    e.className = 'e';
    e.textContent = pack.emoji || '🛡️';
    const t = document.createElement('span');
    t.textContent = pack.label || pack.id;
    b.append(e, t);
    el.append(b);
  }
}

function renderPause(pauseUntil) {
  const btn = $('pause');
  const label = $('pauseLabel');
  const remaining = typeof pauseUntil === 'number' ? pauseUntil - Date.now() : 0;
  if (remaining > 0) {
    const totalSec = Math.ceil(remaining / 1000);
    const m = Math.floor(totalSec / 60);
    const s = String(totalSec % 60).padStart(2, '0');
    btn.classList.add('active');
    label.textContent = `Révélé encore ${m}:${s}`;
  } else {
    btn.classList.remove('active');
    label.textContent = 'Tout révéler 10 min';
    if (tick) {
      clearInterval(tick);
      tick = null;
    }
  }
}

// Rafraîchit le compte à rebours chaque seconde tant que la pause est active.
function startCountdown(pauseUntil) {
  if (tick) clearInterval(tick);
  tick = null;
  renderPause(pauseUntil);
  if (typeof pauseUntil === 'number' && pauseUntil - Date.now() > 0) {
    tick = setInterval(() => renderPause(pauseUntil), 1000);
  }
}

async function init() {
  const store = await storageGet([
    'enabled',
    'pauseUntil',
    'activeCompetitions',
    'dailyBlockedCount',
    'dailyBlockedDate',
  ]);

  renderEnabled(store.enabled !== false); // défaut : activé
  renderCount(store);
  renderBadges(store.activeCompetitions);
  startCountdown(store.pauseUntil);

  $('enabled').addEventListener('change', () => {
    const on = $('enabled').checked;
    renderEnabled(on);
    storageSet({ enabled: on });
  });

  $('pause').addEventListener('click', async () => {
    const pauseUntil = Date.now() + PAUSE_MS;
    await storageSet({ pauseUntil });
    startCountdown(pauseUntil);
  });

  $('options').addEventListener('click', (e) => {
    e.preventDefault();
    try {
      if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
      else window.open(chrome.runtime.getURL('dist/options.html'));
    } catch {
      /* hors contexte extension */
    }
  });

  // Mise à jour en direct si le compteur / la pause changent pendant que le
  // popup est ouvert (écritures faites par le content script).
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if ('dailyBlockedCount' in changes || 'dailyBlockedDate' in changes) {
        storageGet(['dailyBlockedCount', 'dailyBlockedDate']).then(renderCount);
      }
      if ('pauseUntil' in changes) startCountdown(changes.pauseUntil.newValue);
      if ('activeCompetitions' in changes) {
        renderBadges(changes.activeCompetitions.newValue);
      }
      if ('enabled' in changes) renderEnabled(changes.enabled.newValue !== false);
    });
  } catch {
    /* hors contexte extension */
  }
}

init();
