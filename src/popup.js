// Popup SpoilGuard — interrupteur global + compteur du jour + gestion rapide
// des compétitions surveillées (badges + panneau « + »).
// Pur câblage DOM autour de chrome.storage.local. Aucune logique métier :
// on ne fait que lire/écrire les clés existantes (enabled, activeCompetitions)
// plus la lecture du compteur (dailyBlockedCount / dailyBlockedDate) écrit par
// le content script.
//
// NOTE : la fonctionnalité UI « Tout révéler 10 min » a été retirée
// volontairement (décision produit). La logique gate.js/pauseUntil du content
// script reste en place mais dormante — plus aucune UI n'écrit `pauseUntil`.

import { PACKS } from './lib/pack.js';
import { loadCompetitions } from './lib/catalog.js';
import { t, applyI18n } from './lib/i18n.js';

const DEFAULT_COMPETITIONS = ['tdf-2026'];
const $ = (id) => document.getElementById(id);

let active = new Set(DEFAULT_COMPETITIONS); // toujours ≥1 dans l'UI
let catalog = []; // [{ id, label, emoji, active }]
let panelOpen = false;
let msgTimer = null;

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
  $('blockedNoun').textContent = n > 1 ? t('blockedMany') : t('blockedOne');
}

function renderEnabled(enabled) {
  $('enabled').checked = enabled;
  $('guard').classList.toggle('on', enabled);
  $('guardLabel').textContent = enabled ? t('guardOn') : t('guardOff');
}

// Infos d'affichage d'une compétition : catalogue backend en priorité, repli
// sur les packs locaux (labels/emojis) si l'id n'y figure pas encore.
function compInfo(id) {
  const c = catalog.find((x) => x.id === id);
  if (c) return { id, label: c.label || id, emoji: c.emoji || '🛡️' };
  const p = PACKS[id];
  return { id, label: (p && p.label) || id, emoji: (p && p.emoji) || '🛡️' };
}

function renderBadges() {
  const el = $('badges');
  el.textContent = '';
  const ids = active.size ? [...active] : DEFAULT_COMPETITIONS;

  for (const id of ids) {
    const info = compInfo(id);
    const b = document.createElement('span');
    b.className = 'badge active-comp';

    const e = document.createElement('span');
    e.className = 'e';
    e.textContent = info.emoji;

    const label = document.createElement('span');
    label.textContent = info.label;

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'rm';
    rm.textContent = '×';
    rm.setAttribute('aria-label', t('removeCompetitionAria', { label: info.label }));
    rm.addEventListener('click', (ev) => {
      ev.stopPropagation();
      deactivate(id);
    });

    b.append(e, label, rm);
    el.append(b);
  }

  // Bouton « + » d'ajout rapide.
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'badge add' + (panelOpen ? ' open' : '');
  add.textContent = '+';
  add.setAttribute('aria-label', t('addCompetition'));
  add.addEventListener('click', togglePanel);
  el.append(add);
}

function renderPanel() {
  const list = $('addList');
  list.textContent = '';
  // Compétitions du catalogue disponibles (in-season) et pas déjà actives.
  const available = catalog.filter((c) => c.active !== false && !active.has(c.id));

  if (!available.length) {
    const p = document.createElement('div');
    p.className = 'add-empty';
    p.textContent = t('allCompetitionsActive');
    list.append(p);
    return;
  }

  for (const c of available) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'add-item';

    const e = document.createElement('span');
    e.className = 'e';
    e.textContent = c.emoji || '🛡️';

    const label = document.createElement('span');
    label.textContent = c.label || c.id;

    item.append(e, label);
    item.addEventListener('click', () => activate(c.id));
    list.append(item);
  }
}

function togglePanel() {
  panelOpen = !panelOpen;
  $('addPanel').hidden = !panelOpen;
  if (panelOpen) renderPanel();
  renderBadges(); // refléter l'état « open » sur le bouton +
}

function showMsg() {
  const m = $('compsMsg');
  m.textContent = t('lastCompetitionMsg');
  m.hidden = false;
  if (msgTimer) clearTimeout(msgTimer);
  msgTimer = setTimeout(() => {
    m.hidden = true;
  }, 2500);
}

function hideMsg() {
  $('compsMsg').hidden = true;
  if (msgTimer) {
    clearTimeout(msgTimer);
    msgTimer = null;
  }
}

async function activate(id) {
  active.add(id);
  hideMsg();
  await storageSet({ activeCompetitions: [...active] });
  renderBadges();
  renderPanel();
}

async function deactivate(id) {
  // Garde-fou : au moins une compétition doit rester active.
  if (active.size <= 1) {
    showMsg();
    return;
  }
  active.delete(id);
  hideMsg();
  await storageSet({ activeCompetitions: [...active] });
  renderBadges();
  if (panelOpen) renderPanel();
}

async function init() {
  applyI18n();

  const store = await storageGet([
    'enabled',
    'activeCompetitions',
    'backendUrl',
    'dailyBlockedCount',
    'dailyBlockedDate',
  ]);

  active = new Set(
    Array.isArray(store.activeCompetitions) && store.activeCompetitions.length
      ? store.activeCompetitions
      : DEFAULT_COMPETITIONS,
  );

  renderEnabled(store.enabled !== false); // défaut : activé
  renderCount(store);
  renderBadges();

  $('enabled').addEventListener('change', () => {
    const on = $('enabled').checked;
    renderEnabled(on);
    storageSet({ enabled: on });
  });

  $('settings').addEventListener('click', () => {
    try {
      if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
      else window.open(chrome.runtime.getURL('dist/options.html'));
    } catch {
      /* hors contexte extension */
    }
  });

  // Charge le catalogue (backend → repli packs locaux) pour le panneau « + »
  // et pour des labels à jour ; puis rafraîchit l'affichage.
  catalog = await loadCompetitions(store.backendUrl);
  renderBadges();
  if (panelOpen) renderPanel();

  // Mise à jour en direct si le compteur ou les compétitions changent pendant
  // que le popup est ouvert (écritures faites par le content script / options).
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if ('dailyBlockedCount' in changes || 'dailyBlockedDate' in changes) {
        storageGet(['dailyBlockedCount', 'dailyBlockedDate']).then(renderCount);
      }
      if ('activeCompetitions' in changes) {
        const next = changes.activeCompetitions.newValue;
        active = new Set(
          Array.isArray(next) && next.length ? next : DEFAULT_COMPETITIONS,
        );
        renderBadges();
        if (panelOpen) renderPanel();
      }
      if ('enabled' in changes) renderEnabled(changes.enabled.newValue !== false);
    });
  } catch {
    /* hors contexte extension */
  }
}

init();
