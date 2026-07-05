// GET /feed/:competitionId — voir « Contrat d'API » (Phase 3) du plan phase 2-4.
//
// Agrège les flux RSS publics YouTube des chaînes à risque d'une compétition,
// passe les titres par le MÊME pipeline classify (+ cache) que /classify, et
// renvoie une liste de vidéos SANS spoiler.
//
// GARANTIE FORTE : le titre ORIGINAL d'une vidéo spoiler n'est JAMAIS renvoyé.
// - spoiler=true  → safeTitle = titre réécrit (ou générique), PAS d'originalTitle.
// - spoiler=false → safeTitle = titre original, + originalTitle (révélable côté UI).

import { Hono } from 'hono';
import { TTLCache } from '../lib/cache';
import { createRateLimiter, type RateLimiter } from '../lib/rateLimit';
import { getCompetition, type Competition } from '../data/competitions';
import { createRssClient, resolveChannelId, type RssEntry } from '../lib/rss';
import type { Classification, ClassifyFn, Video } from '../lib/classifier';

/** Une vidéo telle que renvoyée par /feed. `originalTitle` absent si spoiler. */
export type FeedVideo = {
  videoId: string;
  safeTitle: string;
  publishedAt: string;
  channel: string;
  originalTitle?: string;
};

export type FeedResponse = { videos: FeedVideo[] };

export type FeedRouteDeps = {
  /** Même classifieur que /classify (injecté via app.ts). */
  classify: ClassifyFn;
  /** Cache de classification PARTAGÉ avec /classify (par videoId, TTL 24 h). */
  cache?: TTLCache<Classification>;
  /** Rate limiter partagé (injectable pour tests). */
  rateLimiter?: RateLimiter;
  rateLimit?: { limit?: number; windowMs?: number };
  /** Récupération des entrées d'une chaîne (injectable pour mock RSS en test). */
  fetchChannelFeed?: (channelId: string) => Promise<RssEntry[]>;
  /** Cache de la réponse assemblée (par competitionId, TTL 10 min). */
  feedCache?: TTLCache<FeedResponse>;
};

/** Nombre max de vidéos renvoyées (aligné sur la limite de batch classify). */
const MAX_VIDEOS = 30;
/** TTL du cache de réponse assemblée. */
const FEED_TTL_MS = 10 * 60 * 1000; // 10 min
/** Garde-fou anti-flooding sur un safeTitle (identique à /classify). */
const SAFE_TITLE_MAX = 300;

function genericSafeTitle(comp: Competition): string {
  return `${comp.emoji} ${comp.label} – contenu récent`;
}

function clientIp(header: string | undefined, fallback: string): string {
  if (!header) return fallback;
  const parts = header.split(',');
  return parts[parts.length - 1].trim() || fallback;
}

/** ms depuis epoch d'une date ISO, 0 si absente/invalide (tri robuste). */
function toMillis(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

export function createFeedRoute(deps: FeedRouteDeps) {
  const cache = deps.cache ?? new TTLCache<Classification>();
  const rateLimiter =
    deps.rateLimiter ?? createRateLimiter(deps.rateLimit ?? { limit: 60, windowMs: 60_000 });
  const feedCache = deps.feedCache ?? new TTLCache<FeedResponse>({ ttlMs: FEED_TTL_MS });
  const fetchChannelFeed =
    deps.fetchChannelFeed ?? createRssClient().fetchChannelFeed;

  const app = new Hono();

  app.get('/:competitionId', async (c) => {
    const ip = clientIp(c.req.header('x-forwarded-for'), 'unknown');
    if (!rateLimiter.check(ip)) {
      return c.json({ error: 'rate_limited', message: 'Trop de requêtes, réessayez dans une minute.' }, 429);
    }

    const competitionId = c.req.param('competitionId');
    const comp = getCompetition(competitionId);
    if (!comp) {
      return c.json({ error: 'unknown_competition', message: `Compétition inconnue : ${competitionId}` }, 404);
    }

    // Réponse assemblée en cache 10 min.
    const cachedResponse = feedCache.get(competitionId);
    if (cachedResponse) {
      c.header('X-Feed-Cache', 'hit');
      return c.json(cachedResponse);
    }

    // 1. Résolution des chaînes → channelIds (dédupliqués, ignore les inconnues).
    const channelIds = [
      ...new Set(
        comp.channels
          .map((name) => resolveChannelId(name))
          .filter((id): id is string => id !== undefined)
      ),
    ];

    // 2. Récupération parallèle des flux RSS (un échec n'interrompt rien).
    const feeds = await Promise.all(channelIds.map((id) => fetchChannelFeed(id)));
    const entries = feeds.flat();

    // 3. Dédup par videoId (une même vidéo peut apparaître sur 2 flux), tri par
    //    date décroissante, puis 30 max.
    const byVideo = new Map<string, RssEntry>();
    for (const e of entries) {
      if (!byVideo.has(e.videoId)) byVideo.set(e.videoId, e);
    }
    const sorted = [...byVideo.values()]
      .sort((a, b) => toMillis(b.publishedAt) - toMillis(a.publishedAt))
      .slice(0, MAX_VIDEOS);

    // 4. Classification via le pipeline partagé (mêmes cache-hit/miss que /classify).
    const misses: Video[] = [];
    const classifications = new Map<string, Classification>();
    for (const e of sorted) {
      const hit = cache.get(e.videoId);
      if (hit) classifications.set(e.videoId, hit);
      else misses.push({ videoId: e.videoId, title: e.title, channel: e.channel });
    }
    if (misses.length > 0) {
      const fresh = await deps.classify([competitionId], misses);
      for (const r of fresh) {
        if (!r.fallback) cache.set(r.videoId, r); // un repli ne pollue pas le cache 24 h
        classifications.set(r.videoId, r);
      }
    }

    // 5. Assemblage SANS jamais exposer le titre original d'un spoiler.
    const videos: FeedVideo[] = sorted.map((e) => {
      const r =
        classifications.get(e.videoId) ??
        ({ videoId: e.videoId, spoiler: true, safeTitle: null } as Classification);

      if (r.spoiler) {
        const raw = r.safeTitle ?? genericSafeTitle(comp);
        return {
          videoId: e.videoId,
          safeTitle: raw.slice(0, SAFE_TITLE_MAX),
          publishedAt: e.publishedAt,
          channel: e.channel,
        };
      }
      // Non-spoiler : le titre original est sûr → on l'expose (safeTitle + originalTitle).
      return {
        videoId: e.videoId,
        safeTitle: e.title,
        publishedAt: e.publishedAt,
        channel: e.channel,
        originalTitle: e.title,
      };
    });

    const response: FeedResponse = { videos };
    feedCache.set(competitionId, response, FEED_TTL_MS);
    c.header('X-Feed-Cache', 'miss');
    return c.json(response);
  });

  return app;
}
