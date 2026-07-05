// GET /competitions — catalogue des packs (source de vérité côté backend).
// L'extension en garde une copie en dur comme fallback offline.

import { Hono } from 'hono';
import { COMPETITIONS } from '../data/competitions';
import { resolveChannelId } from '../lib/rss';

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
      // true = au moins une chaîne du pack est résolue en channelId → le feed peut
      // renvoyer des vidéos. Le sélecteur de la web app masque les feedAvailable:false.
      feedAvailable: comp.channels.some((name) => resolveChannelId(name) !== undefined),
    }));
    return c.json({ competitions });
  });

  return app;
}
