// Packs de l'extension (fallback OFFLINE). Copie volontairement dupliquée de
// backend/src/data/competitions.ts : si le backend est injoignable, le pré-filtre
// local continue de fonctionner. La source de vérité reste le backend (GET /competitions).

export const TDF_2026 = {
  id: 'tdf-2026',
  label: 'Tour de France',
  emoji: '🚴',
  maxAgeHours: 72,
  // Noms de chaînes normalisés en minuscules, comparés via includes()
  channels: [
    'tour de france',
    'eurosport france',
    'eurosport',
    'france tv sport',
    'france.tv slash sport',
    'la chaine l\'équipe',
    'l\'équipe',
    'cycling pro net',
    'lanterne rouge',
    'velon cc',
  ],
  // Longue traîne : titres matchant ces mots chez n'importe quelle chaîne
  lexicon: [
    'tour de france', 'tdf', 'maillot jaune', 'étape', 'etape', 'stage',
    'peloton', 'échappée', 'echappee', 'pogacar', 'pogačar', 'vingegaard',
    'evenepoel', 'contre-la-montre', 'clm', 'grand départ',
  ],
};

export const WIMBLEDON_2026 = {
  id: 'wimbledon-2026',
  label: 'Wimbledon',
  emoji: '🎾',
  maxAgeHours: 72,
  channels: [
    'bein sports france',
    'wimbledon',
    'eurosport france',
    'eurosport',
  ],
  lexicon: [
    'wimbledon', 'djokovic', 'alcaraz', 'sinner', 'swiatek', 'sabalenka',
    'demi-finale', 'demi finale', 'quart de finale', 'quarts de finale',
    '3ème tour', '3eme tour', 'tie-break', 'tie break', 'gazon',
    'grand chelem', 'break', 'set decisif', 'set décisif',
  ],
};

export const F1_2026 = {
  id: 'f1-2026',
  label: 'Formule 1',
  emoji: '🏎️',
  maxAgeHours: 72,
  channels: [
    'formula 1',
    'canal+ sport',
    'canal+',
  ],
  lexicon: [
    'f1', 'formule 1', 'formula 1', 'grand prix', 'gp de', 'gp d\'',
    'verstappen', 'leclerc', 'hamilton', 'norris', 'piastri', 'russell',
    'pole position', 'pole', 'qualifs', 'qualifications', 'sprint',
    'podium', 'grille de départ', 'grille de depart',
  ],
};

// Catalogue local indexé par id. Doit rester aligné avec le backend.
export const PACKS = {
  'tdf-2026': TDF_2026,
  'wimbledon-2026': WIMBLEDON_2026,
  'f1-2026': F1_2026,
};

// Fusionne les packs des compétitions actives en un pack unique exploitable par
// shouldVeil : union (dédoublonnée) des channels et du lexicon, maxAgeHours = le plus
// strict (min), emoji/label du premier pack de la liste (affichage par défaut). Le
// tableau `packs` (membres) est conservé pour choisir l'emoji du pack réellement
// matché au moment de voiler (voir pickVeilPack). Ids inconnus ignorés ; liste vide →
// pack neutre inoffensif qui ne matche rien.
export function mergePacks(ids) {
  const packs = (Array.isArray(ids) ? ids : [])
    .map((id) => PACKS[id])
    .filter(Boolean);

  if (packs.length === 0) {
    return {
      id: '_empty',
      emoji: '🛡️',
      label: 'SpoilGuard',
      maxAgeHours: 72,
      channels: [],
      lexicon: [],
      packs: [],
    };
  }

  return {
    id: packs.map((p) => p.id).join('+'),
    emoji: packs[0].emoji,
    label: packs[0].label,
    maxAgeHours: Math.min(...packs.map((p) => p.maxAgeHours)),
    channels: [...new Set(packs.flatMap((p) => p.channels))],
    lexicon: [...new Set(packs.flatMap((p) => p.lexicon))],
    packs,
  };
}
