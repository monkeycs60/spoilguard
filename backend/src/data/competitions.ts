// Catalogue des compétitions suivies par SpoilGuard.
// Source de vérité des « packs » (chaînes à risque + lexique) — l'extension en
// garde une copie en dur comme fallback offline (voir GET /competitions).

export type Competition = {
  /** Identifiant stable utilisé par l'API (ex. "tdf-2026"). */
  id: string;
  /** Nom lisible affiché à l'utilisateur. */
  label: string;
  /** Emoji préfixant les safeTitle de cette compétition. */
  emoji: string;
  /** false = compétition connue mais désactivée (hors saison, WIP). */
  active: boolean;
  /** Une vidéo de ces chaînes datant de < maxAgeHours est voilée d'office. */
  maxAgeHours: number;
  /** Noms de chaînes normalisés en minuscules, comparés via includes(). */
  channels: string[];
  /** Longue traîne : titres matchant ces mots chez n'importe quelle chaîne. */
  lexicon: string[];
};

export const TDF_2026: Competition = {
  id: 'tdf-2026',
  label: 'Tour de France',
  emoji: '🚴',
  active: true,
  maxAgeHours: 72,
  // Recopié depuis src/lib/pack.js (pack de l'extension) — même contenu.
  channels: [
    'tour de france',
    'eurosport france',
    'eurosport',
    'france tv sport',
    'france.tv slash sport',
    "la chaine l'équipe",
    "l'équipe",
    'cycling pro net',
    'lanterne rouge',
    'velon cc',
  ],
  lexicon: [
    'tour de france', 'tdf', 'maillot jaune', 'étape', 'etape', 'stage',
    'peloton', 'échappée', 'echappee', 'pogacar', 'pogačar', 'vingegaard',
    'evenepoel', 'contre-la-montre', 'clm', 'grand départ',
  ],
};

export const WIMBLEDON_2026: Competition = {
  id: 'wimbledon-2026',
  label: 'Wimbledon',
  emoji: '🎾',
  active: true,
  // Période indicative : fin juin → mi-juillet 2026 (tournoi ~2 semaines).
  maxAgeHours: 72,
  // Recopié dans src/lib/pack.js (fallback offline de l'extension) — même contenu.
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

export const F1_2026: Competition = {
  id: 'f1-2026',
  label: 'Formule 1',
  emoji: '🏎️',
  active: true,
  // Période indicative : saison mars → décembre 2026 (un GP ~tous les 1-2 weekends).
  maxAgeHours: 72,
  // Recopié dans src/lib/pack.js (fallback offline de l'extension) — même contenu.
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

/** Catalogue complet (actives + inactives). */
export const COMPETITIONS: Competition[] = [TDF_2026, WIMBLEDON_2026, F1_2026];

const BY_ID = new Map(COMPETITIONS.map((c) => [c.id, c]));

/** Renvoie une compétition par id, ou undefined si inconnue. */
export function getCompetition(id: string): Competition | undefined {
  return BY_ID.get(id);
}

/** Résout une liste d'ids en compétitions connues (ignore les inconnues). */
export function resolveCompetitions(ids: string[]): Competition[] {
  return ids
    .map((id) => BY_ID.get(id))
    .filter((c): c is Competition => c !== undefined);
}
