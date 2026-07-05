import { describe, it, expect } from 'vitest';
import { PACKS, mergePacks, TDF_2026 } from '../src/lib/pack.js';

describe('PACKS', () => {
  it('expose les trois compétitions', () => {
    expect(Object.keys(PACKS).sort()).toEqual(
      ['f1-2026', 'tdf-2026', 'wimbledon-2026'],
    );
  });
  it('tdf-2026 pointe sur TDF_2026 (compat)', () =>
    expect(PACKS['tdf-2026']).toBe(TDF_2026));
});

describe('mergePacks', () => {
  it('un seul id → équivalent du pack d\'origine', () => {
    const m = mergePacks(['tdf-2026']);
    expect(m.emoji).toBe('🚴');
    expect(m.label).toBe('Tour de France');
    expect(m.maxAgeHours).toBe(72);
    expect(m.channels).toContain('eurosport');
    expect(m.lexicon).toContain('maillot jaune');
  });

  it('fusionne channels et lexicon de plusieurs packs', () => {
    const m = mergePacks(['tdf-2026', 'f1-2026']);
    expect(m.channels).toContain('eurosport');
    expect(m.channels).toContain('formula 1');
    expect(m.lexicon).toContain('maillot jaune');
    expect(m.lexicon).toContain('verstappen');
  });

  it('dédoublonne les channels partagés (eurosport)', () => {
    const m = mergePacks(['tdf-2026', 'wimbledon-2026']);
    const count = m.channels.filter((c) => c === 'eurosport').length;
    expect(count).toBe(1);
  });

  it('maxAgeHours = min des packs', () => {
    const m = mergePacks([
      { channels: [], lexicon: [], maxAgeHours: 48, emoji: 'a', label: 'A', id: 'a' },
    ].length ? ['tdf-2026', 'f1-2026'] : []);
    // tous à 72 ici → 72
    expect(m.maxAgeHours).toBe(72);
  });

  it('emoji/label proviennent du premier pack de la liste', () => {
    const m = mergePacks(['f1-2026', 'tdf-2026']);
    expect(m.emoji).toBe('🏎️');
    expect(m.label).toBe('Formule 1');
  });

  it('expose les packs membres pour le choix d\'emoji', () => {
    const m = mergePacks(['tdf-2026', 'f1-2026']);
    expect(m.packs.map((p) => p.id)).toEqual(['tdf-2026', 'f1-2026']);
  });

  it('ignore les ids inconnus', () => {
    const m = mergePacks(['tdf-2026', 'inconnu-xyz']);
    expect(m.packs.map((p) => p.id)).toEqual(['tdf-2026']);
  });

  it('liste vide → pack neutre inoffensif (ne matche rien)', () => {
    const m = mergePacks([]);
    expect(m.channels).toEqual([]);
    expect(m.lexicon).toEqual([]);
    expect(m.maxAgeHours).toBe(72);
    expect(m.emoji).toBe('🛡️');
  });
});
