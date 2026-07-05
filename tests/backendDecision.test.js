import { describe, it, expect } from 'vitest';
import { backendDecision } from '../src/lib/backendDecision.js';

const veiledCard = { veiled: true, revealed: false, videoId: 'abc' };

describe('backendDecision — réponses backend sur une carte voilée', () => {
  it("spoiler:false → 'unveil' (faux positif du pré-filtre)", () =>
    expect(
      backendDecision({ ...veiledCard, result: { videoId: 'abc', spoiler: false } }),
    ).toBe('unveil'));

  it("spoiler:true + safeTitle → 'retitle'", () =>
    expect(
      backendDecision({
        ...veiledCard,
        result: { videoId: 'abc', spoiler: true, safeTitle: '🚴 Résumé étape 2' },
      }),
    ).toBe('retitle'));

  it("spoiler:true sans safeTitle → 'noop' (voile générique conservé)", () =>
    expect(
      backendDecision({ ...veiledCard, result: { videoId: 'abc', spoiler: true } }),
    ).toBe('noop'));

  it("spoiler:true + safeTitle vide/espaces → 'noop'", () =>
    expect(
      backendDecision({
        ...veiledCard,
        result: { videoId: 'abc', spoiler: true, safeTitle: '   ' },
      }),
    ).toBe('noop'));

  it("unavailable:true → 'noop' (dégradation gracieuse)", () =>
    expect(
      backendDecision({ ...veiledCard, result: { videoId: 'abc', unavailable: true } }),
    ).toBe('noop'));
});

describe('backendDecision — réponse absente ou malformée', () => {
  it("result null → 'noop'", () =>
    expect(backendDecision({ ...veiledCard, result: null })).toBe('noop'));

  it("result undefined → 'noop'", () =>
    expect(backendDecision({ ...veiledCard, result: undefined })).toBe('noop'));

  it("result sans champ spoiler → 'noop'", () =>
    expect(
      backendDecision({ ...veiledCard, result: { videoId: 'abc' } }),
    ).toBe('noop'));
});

describe('backendDecision — état de carte modifié depuis l\'envoi', () => {
  it("carte révélée par l'utilisateur → 'noop' même si spoiler:false", () =>
    expect(
      backendDecision({
        veiled: true,
        revealed: true,
        videoId: 'abc',
        result: { videoId: 'abc', spoiler: false },
      }),
    ).toBe('noop'));

  it("carte révélée → 'noop' même si spoiler:true + safeTitle", () =>
    expect(
      backendDecision({
        veiled: true,
        revealed: true,
        videoId: 'abc',
        result: { videoId: 'abc', spoiler: true, safeTitle: 'X' },
      }),
    ).toBe('noop'));

  it("carte plus voilée (dé-voilée entre-temps) → 'noop'", () =>
    expect(
      backendDecision({
        veiled: false,
        revealed: false,
        videoId: 'abc',
        result: { videoId: 'abc', spoiler: true, safeTitle: 'X' },
      }),
    ).toBe('noop'));

  it("réponse pour une AUTRE vidéo (carte recyclée) → 'noop'", () =>
    expect(
      backendDecision({
        veiled: true,
        revealed: false,
        videoId: 'nouveau',
        result: { videoId: 'abc', spoiler: false },
      }),
    ).toBe('noop'));

  it('videoId manquant côté carte → applique quand même (pas de discriminant)', () =>
    expect(
      backendDecision({
        veiled: true,
        revealed: false,
        videoId: null,
        result: { videoId: 'abc', spoiler: false },
      }),
    ).toBe('unveil'));

  it('videoId manquant côté résultat → applique quand même', () =>
    expect(
      backendDecision({
        veiled: true,
        revealed: false,
        videoId: 'abc',
        result: { spoiler: false },
      }),
    ).toBe('unveil'));
});
