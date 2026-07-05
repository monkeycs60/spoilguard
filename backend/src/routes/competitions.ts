// GET /competitions — catalogue des packs (source de vérité côté backend).
// L'extension en garde une copie en dur comme fallback offline.

import { Hono } from 'hono';
import { COMPETITIONS } from '../data/competitions';

export function createCompetitionsRoute() {
  const app = new Hono();

  app.get('/', (c) => {
    const competitions = COMPETITIONS.map((comp) => ({
      id: comp.id,
      label: comp.label,
      emoji: comp.emoji,
      active: comp.active,
      maxAgeHours: comp.maxAgeHours,
      channels: comp.channels,
      lexicon: comp.lexicon,
    }));
    return c.json({ competitions });
  });

  return app;
}
