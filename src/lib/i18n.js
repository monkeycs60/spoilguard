// i18n de l'extension (popup + options). Dictionnaire fr/en + t(key).
// Choix de la locale : langue de l'UI Chrome si dispo, sinon langue du
// navigateur. « fr… » → français, tout le reste → anglais (défaut international).
//
// Pattern d'usage :
//   - HTML : attributs data-i18n="key" (textContent), data-i18n-placeholder,
//     data-i18n-aria (aria-label), data-i18n-title. Remplis par applyI18n().
//   - JS   : t('key') pour les chaînes dynamiques, avec interpolation {nom}.

const DICT = {
  fr: {
    // — Popup —
    guardSub: 'Masque les spoilers sur YouTube',
    guardOn: 'Protection active',
    guardOff: 'Protection désactivée',
    blockedOne: 'spoiler bloqué',
    blockedMany: 'spoilers bloqués',
    blockedSuffix: "aujourd'hui",
    compsWatched: 'Compétitions surveillées',
    noCompetition: 'Aucune compétition',
    revealAll: 'Tout révéler 10 min',
    revealedRemaining: 'Révélé encore {time}',
    settingsLink: 'Paramètres et compétitions',

    // — Options —
    optionsTitle: 'SpoilBlock — Options',
    optionsSubtitle: 'Choisissez les compétitions à protéger des spoilers sur YouTube.',
    secCompetitions: 'Compétitions',
    secCompetitionsDesc: 'Activez les compétitions dont vous voulez masquer les résultats.',
    loading: 'Chargement…',
    secBackend: 'Service de classification',
    secBackendDesc: "L'IA qui détecte les spoilers déguisés. En cas d'indisponibilité, un filtre local prend le relais.",
    checking: 'Vérification…',
    online: 'En ligne',
    offline: 'Hors ligne',
    secReveal: 'Révéler temporairement',
    secRevealDesc: 'Les nouvelles vidéos ne seront plus masquées pendant 10 minutes.',
    revealAllBtn: 'Révéler tout pendant 10 min',
    revealHint: 'Rechargez YouTube pour tout révéler immédiatement.',
    advanced: 'Avancé',
    backendUrlLabel: 'URL du service de classification',
    backendUrlHint: 'Laisser vide pour utiliser le serveur par défaut.',
    saved: 'Enregistré',
    urlSaved: 'URL enregistrée',
    revealActivated: 'Révélation activée pour 10 min',
    noCompetitionsAvailable: 'Aucune compétition disponible.',
    revealedRemainingMin: 'Révélé encore {n} min',
  },
  en: {
    // — Popup —
    guardSub: 'Hides spoilers on YouTube',
    guardOn: 'Protection on',
    guardOff: 'Protection off',
    blockedOne: 'spoiler blocked',
    blockedMany: 'spoilers blocked',
    blockedSuffix: 'today',
    compsWatched: 'Competitions',
    noCompetition: 'No competition',
    revealAll: 'Reveal all for 10 min',
    revealedRemaining: 'Revealed · {time}',
    settingsLink: 'Settings & competitions',

    // — Options —
    optionsTitle: 'SpoilBlock — Options',
    optionsSubtitle: 'Choose which competitions to protect from spoilers on YouTube.',
    secCompetitions: 'Competitions',
    secCompetitionsDesc: 'Turn on the competitions whose results you want to hide.',
    loading: 'Loading…',
    secBackend: 'Classification service',
    secBackendDesc: 'The AI that detects disguised spoilers. If it is unavailable, a local filter takes over.',
    checking: 'Checking…',
    online: 'Online',
    offline: 'Offline',
    secReveal: 'Reveal temporarily',
    secRevealDesc: "New videos won't be hidden for 10 minutes.",
    revealAllBtn: 'Reveal all for 10 min',
    revealHint: 'Reload YouTube to reveal everything right now.',
    advanced: 'Advanced',
    backendUrlLabel: 'Classification service URL',
    backendUrlHint: 'Leave empty to use the default server.',
    saved: 'Saved',
    urlSaved: 'URL saved',
    revealActivated: 'Reveal enabled for 10 min',
    noCompetitionsAvailable: 'No competition available.',
    revealedRemainingMin: 'Revealed · {n} min left',
  },
};

// Résout la locale une seule fois (« fr… » → fr, sinon en).
export function getLocale() {
  let lang = '';
  try {
    lang = (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getUILanguage)
      ? chrome.i18n.getUILanguage()
      : '';
  } catch {
    lang = '';
  }
  if (!lang) {
    try {
      lang = navigator.language || (navigator.languages && navigator.languages[0]) || '';
    } catch {
      lang = '';
    }
  }
  return String(lang).toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

// Traduit une clé ; interpolation optionnelle des {placeholders}. Fallback :
// clé absente dans la locale → anglais → la clé elle-même (jamais de crash).
export function t(key, params) {
  const locale = getLocale();
  let s = (DICT[locale] && DICT[locale][key]);
  if (s == null) s = DICT.en[key];
  if (s == null) s = key;
  if (params) {
    for (const k of Object.keys(params)) {
      s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(params[k]));
    }
  }
  return s;
}

// Remplit tous les nœuds marqués dans `root` (défaut : document) et fixe la
// langue du document. À appeler une fois au chargement.
export function applyI18n(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  });
  scope.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
  });
  scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
  try {
    if (scope === document || scope === document.documentElement) {
      document.documentElement.lang = getLocale();
    }
  } catch {
    /* noop */
  }
}

// Exposé pour un éventuel test node (comparaison des clés fr/en).
export const DICTIONARY = DICT;
