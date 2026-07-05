// Choix pur de l'emoji/label du voile générique quand plusieurs compétitions sont
// actives. Le pack fusionné (mergePacks) sert à DÉCIDER de voiler ; ici on choisit
// QUEL pack a fait matcher la carte pour afficher son emoji (🎾, 🏎️, 🚴…). Fallback :
// premier pack actif, puis voile neutre 🛡️ si aucune compétition active.

import { isHighRiskChannel, matchesLexicon } from './matcher.js';

export const NEUTRAL_VEIL = { emoji: '🛡️', label: 'contenu récent' };

export function pickVeilPack(packs, info) {
  const list = Array.isArray(packs) ? packs : [];
  for (const p of list) {
    if (isHighRiskChannel(info.channel, p) || matchesLexicon(info.title, p)) return p;
  }
  return list[0] || NEUTRAL_VEIL;
}
