// Construction de l'app Hono (séparée de server.ts pour être testable sans
// démarrer de serveur HTTP).

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { createClassifyRoute, type ClassifyRouteDeps } from './routes/classify';
import { createCompetitionsRoute } from './routes/competitions';
import { createFeedRoute, type FeedRouteDeps } from './routes/feed';
import { TTLCache } from './lib/cache';
import { createRateLimiter } from './lib/rateLimit';
import type { Classification, ClassifyFn } from './lib/classifier';

export type AppDeps = {
  classify: ClassifyFn;
  cache?: ClassifyRouteDeps['cache'];
  rateLimiter?: ClassifyRouteDeps['rateLimiter'];
  rateLimit?: ClassifyRouteDeps['rateLimit'];
  /** RSS injectable (mock en test) — sinon client RSS réel. */
  fetchChannelFeed?: FeedRouteDeps['fetchChannelFeed'];
  feedCache?: FeedRouteDeps['feedCache'];
};

export function createApp(deps: AppDeps) {
  const app = new Hono();

  // CORS permissif : reflète l'origine (chrome-extension://…, http://localhost,
  // web app companion) et autorise les requêtes sans origine (curl, RSS).
  // Reflection d'origine OK car aucune credential/cookie — à revoir si de l'auth arrive.
  app.use(
    '*',
    cors({
      origin: (origin) => origin ?? '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      maxAge: 86_400,
    })
  );

  // Logging simple : méthode, path, statut, durée, + cache hits/misses sur classify.
  app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    const { method, path } = c.req;
    let extra = '';
    if (path === '/classify') {
      const hits = c.res.headers.get('X-Cache-Hits');
      const misses = c.res.headers.get('X-Cache-Misses');
      if (hits !== null || misses !== null) {
        extra = ` cache(hits=${hits ?? 0}, misses=${misses ?? 0})`;
      }
    }
    console.log(`${method} ${path} ${c.res.status} ${ms}ms${extra}`);
  });

  app.get('/health', (c) => c.json({ ok: true, uptime: process.uptime() }));

  // Cache de classification + rate limiter PARTAGÉS entre /classify et /feed :
  // une vidéo classée par un flux profite au batch de l'extension, et vice versa.
  const classifyCache = deps.cache ?? new TTLCache<Classification>();
  const rateLimiter =
    deps.rateLimiter ?? createRateLimiter(deps.rateLimit ?? { limit: 60, windowMs: 60_000 });

  app.route('/classify', createClassifyRoute({ ...deps, cache: classifyCache, rateLimiter }));
  app.route('/competitions', createCompetitionsRoute());
  app.route(
    '/feed',
    createFeedRoute({
      classify: deps.classify,
      cache: classifyCache,
      rateLimiter,
      fetchChannelFeed: deps.fetchChannelFeed,
      feedCache: deps.feedCache,
    })
  );

  // Companion web app (Phase 3) : servie en statique sur / depuis backend/public/.
  // Enregistré APRÈS les routes API : leurs handlers répondent avant ce middleware
  // (Hono compose les handlers dans l'ordre d'enregistrement).
  app.use('/*', serveStatic({ root: './public', index: 'index.html' }));
  // Fallback SPA : tout chemin non résolu retombe sur index.html.
  app.get('*', serveStatic({ path: './public/index.html' }));

  return app;
}
