import { describe, it, expect } from 'vitest';
import { decideReprocess } from '../src/lib/reprocess.js';

// decideReprocess pilote le re-traitement d'une carte YouTube touchée par une
// mutation childList (titre peuplé/recyclé). Sortie : 'ignore' | 'reset' | 'process'.

describe('decideReprocess — carte jamais traitée', () => {
  it("pas dans le WeakSet → 'process'", () =>
    expect(
      decideReprocess({
        isProcessed: false,
        currentTitle: 'Étape 5 : la victoire',
        safeTitle: '',
        revealed: false,
        revealedTitle: '',
      }),
    ).toBe('process'));

  it("pas traitée mais titre vide → 'process' (processCard repassera)", () =>
    expect(
      decideReprocess({
        isProcessed: false,
        currentTitle: '',
        safeTitle: '',
        revealed: false,
        revealedTitle: '',
      }),
    ).toBe('process'));
});

describe('decideReprocess — carte voilée déjà traitée (anti-boucle)', () => {
  it("titre courant === safeTitle injecté → 'ignore' (notre propre écriture)", () =>
    expect(
      decideReprocess({
        isProcessed: true,
        currentTitle: '🛡️ 🚴 Tour de France – vidéo (il y a 3 heures)',
        safeTitle: '🛡️ 🚴 Tour de France – vidéo (il y a 3 heures)',
        revealed: false,
        revealedTitle: '',
      }),
    ).toBe('ignore'));

  it("titre courant diffère du safeTitle → 'reset' (carte recyclée)", () =>
    expect(
      decideReprocess({
        isProcessed: true,
        currentTitle: 'Autre vidéo tout à fait différente',
        safeTitle: '🛡️ 🚴 Tour de France – vidéo (il y a 3 heures)',
        revealed: false,
        revealedTitle: '',
      }),
    ).toBe('reset'));

  it("tolère les espaces autour du titre courant → 'ignore'", () =>
    expect(
      decideReprocess({
        isProcessed: true,
        currentTitle: '   🛡️ 🚴 Tour de France – vidéo récente  ',
        safeTitle: '🛡️ 🚴 Tour de France – vidéo récente',
        revealed: false,
        revealedTitle: '',
      }),
    ).toBe('ignore'));
});

describe('decideReprocess — carte clean déjà traitée', () => {
  it("titre inchangé (signature = titre d'origine) → 'ignore'", () =>
    expect(
      decideReprocess({
        isProcessed: true,
        currentTitle: 'Recette de cookies faciles',
        safeTitle: 'Recette de cookies faciles',
        revealed: false,
        revealedTitle: '',
      }),
    ).toBe('ignore'));

  it("titre changé (recyclée en spoiler) → 'reset'", () =>
    expect(
      decideReprocess({
        isProcessed: true,
        currentTitle: "Résumé de l'étape 12 : Pogacar craque !",
        safeTitle: 'Recette de cookies faciles',
        revealed: false,
        revealedTitle: '',
      }),
    ).toBe('reset'));
});

describe('decideReprocess — carte révélée (dblclick)', () => {
  it("titre courant === titre révélé → 'ignore' (on respecte la révélation)", () =>
    expect(
      decideReprocess({
        isProcessed: true,
        currentTitle: 'Étape 5 : la victoire de Pogacar',
        safeTitle: '🛡️ 🚴 Tour de France – vidéo récente',
        revealed: true,
        revealedTitle: 'Étape 5 : la victoire de Pogacar',
      }),
    ).toBe('ignore'));

  it("le flag révélé prime sur la signature voilée (safeTitle ignoré)", () =>
    expect(
      decideReprocess({
        isProcessed: true,
        currentTitle: 'Étape 5 : la victoire de Pogacar',
        safeTitle: 'peu importe cette valeur',
        revealed: true,
        revealedTitle: 'Étape 5 : la victoire de Pogacar',
      }),
    ).toBe('ignore'));

  it("titre changé depuis la révélation → 'reset' (recyclée, le flag saute)", () =>
    expect(
      decideReprocess({
        isProcessed: true,
        currentTitle: 'Une toute autre vidéo maintenant',
        safeTitle: '🛡️ 🚴 Tour de France – vidéo récente',
        revealed: true,
        revealedTitle: 'Étape 5 : la victoire de Pogacar',
      }),
    ).toBe('reset'));

  it("révélée + espaces autour du titre courant → 'ignore'", () =>
    expect(
      decideReprocess({
        isProcessed: true,
        currentTitle: '  Étape 5 : la victoire de Pogacar ',
        safeTitle: 'x',
        revealed: true,
        revealedTitle: 'Étape 5 : la victoire de Pogacar',
      }),
    ).toBe('ignore'));

  it("flag révélé persistant hors WeakSet, titre inchangé → 'ignore'", () =>
    // WeakSet perdu (nav SPA) mais dataset révélé encore présent dans le DOM.
    expect(
      decideReprocess({
        isProcessed: false,
        currentTitle: 'Étape 5 : la victoire de Pogacar',
        safeTitle: '',
        revealed: true,
        revealedTitle: 'Étape 5 : la victoire de Pogacar',
      }),
    ).toBe('ignore'));

  it("flag révélé persistant hors WeakSet, titre changé → 'reset'", () =>
    expect(
      decideReprocess({
        isProcessed: false,
        currentTitle: 'Vidéo recyclée différente',
        safeTitle: '',
        revealed: true,
        revealedTitle: 'Étape 5 : la victoire de Pogacar',
      }),
    ).toBe('reset'));
});
