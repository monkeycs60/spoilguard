import { describe, it, expect } from 'vitest';
import { veilingEnabled, pauseRemainingMs } from '../src/lib/gate.js';

describe('veilingEnabled — décision pause/on-off', () => {
  const now = 1_000_000;

  it('état vide → actif (défaut on)', () =>
    expect(veilingEnabled({ now })).toBe(true));

  it('enabled undefined → actif', () =>
    expect(veilingEnabled({ pauseUntil: 0, now })).toBe(true));

  it('enabled === false → inactif', () =>
    expect(veilingEnabled({ enabled: false, now })).toBe(false));

  it('pause future → inactif', () =>
    expect(veilingEnabled({ enabled: true, pauseUntil: now + 5000, now })).toBe(false));

  it('pause expirée → actif', () =>
    expect(veilingEnabled({ enabled: true, pauseUntil: now - 1, now })).toBe(true));

  it('pauseUntil non numérique ignoré', () =>
    expect(veilingEnabled({ enabled: true, pauseUntil: null, now })).toBe(true));

  it('enabled=false prime sur pause absente', () =>
    expect(veilingEnabled({ enabled: false, pauseUntil: 0, now })).toBe(false));
});

describe('pauseRemainingMs', () => {
  const now = 1_000_000;
  it('pas de pause → 0', () =>
    expect(pauseRemainingMs({ now })).toBe(0));
  it('pause future → millisecondes restantes', () =>
    expect(pauseRemainingMs({ pauseUntil: now + 3000, now })).toBe(3000));
  it('pause passée → 0 (jamais négatif)', () =>
    expect(pauseRemainingMs({ pauseUntil: now - 3000, now })).toBe(0));
});
