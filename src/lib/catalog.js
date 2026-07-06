// Catalogue des compétitions partagé par la page options et le popup.
// Source de vérité : GET ${backendUrl}/competitions. Repli hors-ligne : packs
// locaux (src/lib/pack.js). Factorisé ici pour éviter la duplication entre
// options.js et popup.js.

import { PACKS } from './pack.js';

export const DEFAULT_BACKEND = 'https://spoilblock.com';

// Packs locaux formatés comme la réponse backend (fallback offline).
export function localCompetitions() {
  return Object.values(PACKS).map((p) => ({
    id: p.id,
    label: p.label,
    emoji: p.emoji,
    active: true,
  }));
}

export function resolveBase(backendUrl) {
  return (backendUrl || DEFAULT_BACKEND).replace(/\/+$/, '');
}

export async function loadCompetitions(backendUrl) {
  const base = resolveBase(backendUrl);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(base + '/competitions', { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const list = Array.isArray(data && data.competitions) ? data.competitions : [];
    if (!list.length) throw new Error('vide');
    return list;
  } catch {
    return localCompetitions();
  }
}
