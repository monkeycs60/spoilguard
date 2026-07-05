// Popup SpoilGuard — interrupteur global + pause 10 min + lien options.
// Pur câblage DOM autour de chrome.storage.local.

const PAUSE_MS = 10 * 60 * 1000;
const $ = (id) => document.getElementById(id);

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

function refreshPauseInfo(pauseUntil) {
  const remaining = typeof pauseUntil === 'number' ? pauseUntil - Date.now() : 0;
  $('pauseInfo').textContent =
    remaining > 0 ? `Révélation active encore ${Math.ceil(remaining / 60000)} min` : '';
}

async function init() {
  const store = await storageGet(['enabled', 'pauseUntil']);

  const enabled = $('enabled');
  enabled.checked = store.enabled !== false; // défaut true
  enabled.addEventListener('change', () => storageSet({ enabled: enabled.checked }));

  $('pause').addEventListener('click', async () => {
    const pauseUntil = Date.now() + PAUSE_MS;
    await storageSet({ pauseUntil });
    refreshPauseInfo(pauseUntil);
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

  refreshPauseInfo(store.pauseUntil);
}

init();
