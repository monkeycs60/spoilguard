import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';

const app = createApp({ classify: async () => [] });

describe('GET /competitions', () => {
  it('renvoie le catalogue avec tdf-2026', async () => {
    const res = await app.request('/competitions');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.competitions)).toBe(true);
    const tdf = body.competitions.find((c: { id: string }) => c.id === 'tdf-2026');
    expect(tdf).toMatchObject({
      id: 'tdf-2026',
      label: 'Tour de France',
      emoji: '🚴',
      active: true,
      maxAgeHours: 72,
    });
    expect(tdf.channels).toContain('tour de france');
    expect(tdf.lexicon).toContain('maillot jaune');
  });

  it('expose feedAvailable (au moins une chaîne mappée) pour chaque compétition', async () => {
    const res = await app.request('/competitions');
    const body = await res.json() as any;
    for (const c of body.competitions) {
      expect(typeof c.feedAvailable).toBe('boolean');
    }
    // tdf/wimbledon/f1 ont toutes des chaînes mappées → feed disponible.
    const byId = Object.fromEntries(body.competitions.map((c: any) => [c.id, c]));
    expect(byId['tdf-2026'].feedAvailable).toBe(true);
    expect(byId['wimbledon-2026'].feedAvailable).toBe(true);
    expect(byId['f1-2026'].feedAvailable).toBe(true);
  });
});

describe('GET /health', () => {
  it('répond ok avec uptime', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(typeof body.uptime).toBe('number');
  });
});
