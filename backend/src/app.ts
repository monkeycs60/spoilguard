// Construction de l'app Hono (séparée de server.ts pour être testable sans
// démarrer de serveur HTTP).

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { Hono, type Context } from 'hono';
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
  /** Horloge injectable (fenêtre de fraîcheur du feed) — pinnable en test. */
  now?: FeedRouteDeps['now'];
  /** Index publishedAt (RSS) injecté dans /classify (best-effort, optionnel). */
  publishedIndex?: ClassifyRouteDeps['publishedIndex'];
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

  app.route(
    '/classify',
    createClassifyRoute({
      classify: deps.classify,
      cache: classifyCache,
      rateLimiter,
      publishedIndex: deps.publishedIndex,
    })
  );
  app.route('/competitions', createCompetitionsRoute());
  app.route(
    '/feed',
    createFeedRoute({
      classify: deps.classify,
      cache: classifyCache,
      rateLimiter,
      fetchChannelFeed: deps.fetchChannelFeed,
      feedCache: deps.feedCache,
      now: deps.now,
    })
  );

  // Routage public (spoilblock.com) : la LANDING marketing vit à la RACINE `/`
  // (vitrine d'abord), la companion « feed sans spoiler » vit sur `/app`.
  // `/landing` est conservé en redirection permanente (anciens liens).
  //
  // Landing : deux emplacements possibles —
  // - repo complet (dev local) : spoilguard/landing/index.html (source de vérité) ;
  // - conteneur Coolify (Base Directory /backend) : repli sur la copie committée
  //   backend/public/landing/index.html (synchro via `npm run sync-landing`).
  // Cache mémoire 5 min.
  const srcDir = path.dirname(fileURLToPath(import.meta.url));
  const landingCandidates = [
    path.resolve(srcDir, '../../landing/index.html'),
    path.resolve(srcDir, '../public/landing/index.html'),
  ];
  const LANDING_TTL_MS = 5 * 60 * 1000;
  let landingCache: { html: string; expires: number } | null = null;
  const serveLanding = async (c: Context) => {
    const now = Date.now();
    if (!landingCache || landingCache.expires <= now) {
      let html: string | null = null;
      for (const file of landingCandidates) {
        try {
          html = await readFile(file, 'utf8');
          break;
        } catch {
          /* candidat suivant */
        }
      }
      if (html === null) {
        console.error('[landing] introuvable dans', landingCandidates);
        return c.text('Landing indisponible', 500);
      }
      landingCache = { html, expires: now + LANDING_TTL_MS };
    }
    return c.html(landingCache.html);
  };
  app.get('/', serveLanding);
  app.get('/landing', (c) => c.redirect('/', 301));

  // Companion web app : servie sur /app depuis backend/public/.
  // serveStatic (@hono/node-server) résout `root` relativement au cwd ; on calcule
  // le chemin ABSOLU de public/ depuis ce fichier source puis on le convertit en
  // RELATIF au cwd réel — GET /app sert le HTML quel que soit le dossier de lancement.
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
  const publicRoot = path.relative(process.cwd(), publicDir) || '.';
  app.get('/app', serveStatic({ path: `${publicRoot}/index.html` }));
  app.use('/app/*', serveStatic({ root: publicRoot, rewriteRequestPath: (p) => p.replace(/^\/app/, '') }));
  // Autres assets statiques éventuels (hors /app) restent servis depuis public/.
  app.use('/*', serveStatic({ root: publicRoot }));

  return app;
}
