import { describe, it, expect } from 'vitest';
import { pickVeilPack, NEUTRAL_VEIL } from '../src/lib/veilPack.js';
import { PACKS } from '../src/lib/pack.js';

const tdf = PACKS['tdf-2026'];
const wim = PACKS['wimbledon-2026'];
const f1 = PACKS['f1-2026'];

describe('pickVeilPack — choix de l\'emoji/label du voile', () => {
  it('rend le pack dont la CHAÎNE matche', () => {
    const p = pickVeilPack([tdf, f1], {
      channel: 'FORMULA 1',
      title: 'peu importe',
    });
    expect(p.emoji).toBe('🏎️');
  });

  it('rend le pack dont le LEXIQUE matche', () => {
    const p = pickVeilPack([tdf, wim], {
      channel: 'Un Vlogueur',
      title: 'Djokovic renversant en demi-finale',
    });
    expect(p.emoji).toBe('🎾');
  });

  it('premier pack matché gagne quand plusieurs correspondent (ordre)', () => {
    // 'eurosport' est dans tdf ET wimbledon → l\'ordre de la liste tranche.
    const p = pickVeilPack([wim, tdf], { channel: 'Eurosport', title: '' });
    expect(p.emoji).toBe('🎾');
  });

  it('aucun match explicite → premier pack actif (fallback)', () => {
    const p = pickVeilPack([tdf, f1], { channel: 'X', title: 'rien' });
    expect(p).toBe(tdf);
  });

  it('liste vide → voile neutre', () => {
    expect(pickVeilPack([], { channel: 'X', title: 'y' })).toBe(NEUTRAL_VEIL);
  });
});
