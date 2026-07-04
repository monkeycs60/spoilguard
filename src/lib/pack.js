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
