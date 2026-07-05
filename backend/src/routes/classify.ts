// POST /classify — voir « Contrat d'API » du plan phase 2-4.
//
// - validation zod (batch ≤ 30, videoId 1-20, title ≤ 300, channel ≤ 100)
// - cache in-memory par videoId (TTL 24 h) : seuls les misses passent au LLM
// - rate limit par IP (60/min → 429)
// - safeTitle null renvoyé par le LLM alors que spoiler=true → titre générique
//   construit côté serveur ({emoji} {label} – contenu récent), jamais null.

import { Hono } from 'hono';
import { z } from 'zod';
import { TTLCache } from '../lib/cache';
import { createRateLimiter, type RateLimiter } from '../lib/rateLimit';
import { resolveCompetitions } from '../data/competitions';
import type { Classification, ClassifyFn, Video } from '../lib/classifier';

const videoSchema = z.object({
  videoId: z.string().min(1).max(20),
  title: z.string().max(300),
  channel: z.string().max(100).optional(),
});

const bodySchema = z.object({
  competitions: z.array(z.string().max(50)).max(50).default([]),
  videos: z.array(videoSchema).min(1).max(30),
});

export type ClassifyRouteDeps = {
  classify: ClassifyFn;
  /** Cache partagé (injectable pour tests). */
  cache?: TTLCache<Classification>;
  /** Rate limiter (injectable pour tests). */
  rateLimiter?: RateLimiter;
  rateLimit?: { limit?: number; windowMs?: number };
};

/** Titre générique construit côté serveur quand le LLM ne fournit pas de safeTitle. */
function genericSafeTitle(competitionIds: string[]): string {
  const [first] = resolveCompetitions(competitionIds);
  if (first) return `${first.emoji} ${first.label} – contenu récent`;
  return '🛡️ Contenu récent';
}

function clientIp(header: string | undefined, fallback: string): string {
  if (!header) return fallback;
  // x-forwarded-for peut contenir une liste "client, proxy1, proxy2".
  return header.split(',')[0].trim() || fallback;
}

export function createClassifyRoute(deps: ClassifyRouteDeps) {
  const cache = deps.cache ?? new TTLCache<Classification>();
  const rateLimiter =
    deps.rateLimiter ?? createRateLimiter(deps.rateLimit ?? { limit: 60, windowMs: 60_000 });

  const app = new Hono();

  app.post('/', async (c) => {
    // Rate limit par IP.
    const ip = clientIp(c.req.header('x-forwarded-for'), 'unknown');
    if (!rateLimiter.check(ip)) {
      return c.json({ error: 'rate_limited', message: 'Trop de requêtes, réessayez dans une minute.' }, 429);
    }

    // Validation.
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json', message: 'Corps de requête JSON invalide.' }, 400);
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: 'invalid_request', issues: parsed.error.issues },
        400
      );
    }

    const { competitions, videos } = parsed.data;

    // Séparation cache hits / misses.
    const hits = new Map<string, Classification>();
    const misses: Video[] = [];
    for (const v of videos) {
      const cached = cache.get(v.videoId);
      if (cached) hits.set(v.videoId, cached);
      else misses.push(v);
    }

    // Appel LLM uniquement sur les misses.
    if (misses.length > 0) {
      const fresh = await deps.classify(competitions, misses);
      for (const r of fresh) {
        cache.set(r.videoId, r);
        hits.set(r.videoId, r);
      }
    }

    // Assemblage dans l'ordre de la requête + post-traitement safeTitle.
    const results = videos.map((v) => {
      const r = hits.get(v.videoId) ?? { videoId: v.videoId, spoiler: true, safeTitle: null };
      const safeTitle = r.spoiler
        ? r.safeTitle ?? genericSafeTitle(competitions)
        : null;
      return { videoId: v.videoId, spoiler: r.spoiler, safeTitle };
    });

    // Instrumentation pour le logger serveur.
    c.header('X-Cache-Hits', String(videos.length - misses.length));
    c.header('X-Cache-Misses', String(misses.length));

    return c.json({ results });
  });

  return app;
}
