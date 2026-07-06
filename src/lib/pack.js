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
    // Chaînes internationales (vérifiées 2026-07-06 : @handle via UA Googlebot → channelId,
    // puis RSS feeds/videos.xml validé, <name> confronté). Spécialisées cyclisme → aussi
    // dans CHANNEL_ID_MAP (feed companion) :
    'flobikes',
    'gcn racing',
    // Généralistes multi-sports → pré-filtre extension seulement (âge < 72h + LLM derrière) ;
    // volontairement HORS CHANNEL_ID_MAP pour ne pas polluer le feed RSS de la companion :
    'nbc sports',
    'tnt sports',
    'itv sport',
    'rtbfsport',
    'srf sport',
  ],
  // Longue traîne : titres matchant ces mots chez n'importe quelle chaîne
  lexicon: [
    'tour de france', 'tdf', 'maillot jaune', 'étape', 'etape', 'stage',
    'peloton', 'échappée', 'echappee', 'pogacar', 'pogačar', 'vingegaard',
    'evenepoel', 'contre-la-montre', 'clm', 'grand départ',
    // Vocabulaire multilingue (es/it/de/nl/en). « rit » (nl) et « GC » écartés :
    // substrings trop courts/ambigus (includes() → faux positifs). « stage »/« peloton » déjà là.
    'etapa', 'tappa', 'etappe', 'klassement',
    'stage winner', 'yellow jersey', 'maglia gialla', 'gelbes trikot',
    'highlights', 'recap', 'resumen', 'zusammenfassung',
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
    // Ajouts internationaux (vérifiés 2026-07-06). Spécialisées tennis → CHANNEL_ID_MAP :
    'tennis tv',
    'sky sport tennis',
    // Généraliste sport (US) → pré-filtre extension seulement (hors feed) :
    'espn',
    // BBC (@BBC) écartée : chaîne généraliste (news/divertissement), pas « sport-only » →
    // trop de faux positifs si voilée < 72h. Le tennis BBC n'est pas sur @BBC de toute façon.
  ],
  lexicon: [
    'wimbledon', 'djokovic', 'alcaraz', 'sinner', 'swiatek', 'sabalenka',
    'demi-finale', 'demi finale', 'quart de finale', 'quarts de finale',
    '3ème tour', '3eme tour', 'tie-break', 'tie break', 'gazon',
    'grand chelem', 'break', 'set decisif', 'set décisif',
    // Vocabulaire anglophone (sobre, termes spécifiques au tournoi) :
    'semifinal', 'semifinals', 'quarterfinal', 'quarterfinals',
    'centre court', 'grass court', 'grand slam',
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
    // Ajouts internationaux (vérifiés 2026-07-06). Spécialisée F1 → CHANNEL_ID_MAP :
    'sky sports f1',
    // Généraliste sport (US, diffuseur F1) → pré-filtre extension seulement (hors feed) :
    'espn',
    // Écartées : Motorsport.com / @MotorsportNetwork (multi-séries : IndyCar, WEC, MotoGP…
    // → polluerait), ServusTV (chaîne généraliste autrichienne, pas sport-only).
  ],
  lexicon: [
    'f1', 'formule 1', 'formula 1', 'grand prix', 'gp de', 'gp d\'',
    'verstappen', 'leclerc', 'hamilton', 'norris', 'piastri', 'russell',
    'pole position', 'pole', 'qualifs', 'qualifications', 'sprint',
    'podium', 'grille de départ', 'grille de depart',
    // Vocabulaire multilingue (en/es/it/de). « podium »/« pole » déjà présents ;
    // termes cyrilliques (« чемпион ») écartés (on reste en alphabet latin) :
    'qualifying', 'race highlights', 'gran premio', 'grosser preis',
    'formula uno', 'fastest lap',
  ],
};

export const WORLDCUP_2026 = {
  id: 'worldcup-2026',
  label: 'Coupe du monde',
  emoji: '⚽',
  maxAgeHours: 72,
  channels: [
    'fifa',
    'espn fc',
    'bein sports france',
    'eurosport france',
    'eurosport',
    'france tv sport',
    'france.tv slash sport',
    // TF1 volontairement écartée : chaîne généraliste grand public (voir backend).
    'tf1',
    'espn',
  ],
  lexicon: [
    'coupe du monde', 'world cup', 'mondial', 'fifa', 'fifa world cup',
    'huitième de finale', 'huitieme de finale', 'quart de finale', 'quarts de finale',
    'demi-finale', 'demi finale', 'penalty', 'tirs au but', 'mbappé', 'mbappe',
    'résumé du match', 'resume du match', 'match highlights', 'group stage',
    'knockout', 'round of 16',
    // Vocabulaire multilingue (en/es) ; mots génériques nus (« but », « goal », « match »)
    // volontairement écartés (faux positifs massifs) :
    'copa del mundo', 'quarterfinal', 'quarter-final', 'semifinal', 'semi-final',
    'ronaldo', 'messi',
  ],
};

export const VUELTA_2026 = {
  id: 'vuelta-2026',
  label: 'La Vuelta',
  emoji: '🚴',
  maxAgeHours: 72,
  channels: [
    'la vuelta',
    'eurosport france',
    'eurosport',
    'cycling pro net',
    'lanterne rouge',
    'velon cc',
    'flobikes',
    'gcn racing',
  ],
  lexicon: [
    'vuelta', 'la vuelta', 'vuelta a españa', 'vuelta a espana', 'maillot rojo',
    'maillot rouge', 'roglic', 'roglič',
    'etapa', 'españa', 'espana',
  ],
};

// Catalogue local indexé par id. Doit rester aligné avec le backend.
export const PACKS = {
  'tdf-2026': TDF_2026,
  'wimbledon-2026': WIMBLEDON_2026,
  'f1-2026': F1_2026,
  'worldcup-2026': WORLDCUP_2026,
  'vuelta-2026': VUELTA_2026,
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
      label: 'SpoilBlock',
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
