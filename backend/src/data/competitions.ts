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

/** Catalogue complet (actives + inactives). */
export const COMPETITIONS: Competition[] = [TDF_2026];

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
