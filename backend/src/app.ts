// Construction de l'app Hono (séparée de server.ts pour être testable sans
// démarrer de serveur HTTP).

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createClassifyRoute, type ClassifyRouteDeps } from './routes/classify';
import { createCompetitionsRoute } from './routes/competitions';
import type { ClassifyFn } from './lib/classifier';

export type AppDeps = {
  classify: ClassifyFn;
  cache?: ClassifyRouteDeps['cache'];
  rateLimiter?: ClassifyRouteDeps['rateLimiter'];
  rateLimit?: ClassifyRouteDeps['rateLimit'];
};

export function createApp(deps: AppDeps) {
  const app = new Hono();

  // CORS permissif : reflète l'origine (chrome-extension://…, http://localhost,
  // web app companion) et autorise les requêtes sans origine (curl, RSS).
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

  app.route('/classify', createClassifyRoute(deps));
  app.route('/competitions', createCompetitionsRoute());

  return app;
}
