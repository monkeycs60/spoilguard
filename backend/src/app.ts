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
import { TTLCache } from './lib/cache';
import { createRateLimiter } from './lib/rateLimit';
import type { Classification, ClassifyFn } from './lib/classifier';

export type AppDeps = {
  classify: ClassifyFn;
  cache?: ClassifyRouteDeps['cache'];
  rateLimiter?: ClassifyRouteDeps['rateLimiter'];
  rateLimit?: ClassifyRouteDeps['rateLimit'];
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

  // Cache de classification + rate limiter de /classify.
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

  // Routage public (spoilblock.com) : la LANDING marketing vit à la RACINE `/`.
  // `/landing` est conservé en redirection permanente (anciens liens).
  //
  // Landing : deux emplacements possibles —
  // - repo complet (dev local) : spoilguard/landing/index.html (source de vérité) ;
  // - conteneur Coolify (Base Directory /backend) : repli sur la copie committée
  //   backend/public/landing/index.html (synchro via `npm run sync-landing`).
  // Cache mémoire 5 min.
  const srcDir = path.dirname(fileURLToPath(import.meta.url));
  const PAGE_TTL_MS = 5 * 60 * 1000;

  // Sert un fichier HTML statique depuis le premier candidat lisible, avec cache
  // mémoire (TTL). `label` sert uniquement au log. Même stratégie de repli que la
  // landing : source de vérité `landing/` (dev), repli sur `backend/public/landing/`
  // (conteneur Coolify, synchro via `npm run sync-landing`).
  const makeHtmlPage = (label: string, candidates: string[]) => {
    let cache: { html: string; expires: number } | null = null;
    return async (c: Context) => {
      const now = Date.now();
      if (!cache || cache.expires <= now) {
        let html: string | null = null;
        for (const file of candidates) {
          try {
            html = await readFile(file, 'utf8');
            break;
          } catch {
            /* candidat suivant */
          }
        }
        if (html === null) {
          console.error(`[${label}] introuvable dans`, candidates);
          return c.text('Page indisponible', 500);
        }
        cache = { html, expires: now + PAGE_TTL_MS };
      }
      return c.html(cache.html);
    };
  };

  const serveLanding = makeHtmlPage('landing', [
    path.resolve(srcDir, '../../landing/index.html'),
    path.resolve(srcDir, '../public/landing/index.html'),
  ]);
  const servePrivacy = makeHtmlPage('confidentialite', [
    path.resolve(srcDir, '../../landing/confidentialite.html'),
    path.resolve(srcDir, '../public/landing/confidentialite.html'),
  ]);
  app.get('/', serveLanding);
  app.get('/confidentialite', servePrivacy);
  app.get('/landing', (c) => c.redirect('/', 301));

  // Ancienne companion web app (retirée) : `/app` (et ses sous-chemins) redirige
  // désormais en permanence vers la racine — plus sympa que 404 pour les vieux favoris.
  app.get('/app', (c) => c.redirect('/', 301));
  app.get('/app/*', (c) => c.redirect('/', 301));

  // Assets statiques (ex. landing/) servis depuis backend/public/.
  // serveStatic (@hono/node-server) résout `root` relativement au cwd ; on calcule le
  // chemin ABSOLU de public/ depuis ce fichier source puis on le convertit en RELATIF
  // au cwd réel — les assets sont servis quel que soit le dossier de lancement.
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
  const publicRoot = path.relative(process.cwd(), publicDir) || '.';
  app.use('/*', serveStatic({ root: publicRoot }));

  return app;
}
