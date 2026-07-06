// Point d'entrée Node : construit le classifieur réel (Cerebras/gpt-oss-120b),
// monte l'app Hono et démarre @hono/node-server.

import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createClassifier } from './lib/classifier';
import { createRssClient } from './lib/rss';
import { createPublishedIndex } from './lib/publishedIndex';
import { initPostHog, shutdownPostHog, isPostHogEnabled } from './lib/posthog';

// Observabilité PostHog (LLM + events produit). No-op si POSTHOG_API_KEY absente.
initPostHog({
  POSTHOG_API_KEY: process.env.POSTHOG_API_KEY,
  POSTHOG_HOST: process.env.POSTHOG_HOST,
});
console.log(`PostHog : ${isPostHogEnabled() ? 'activé' : 'désactivé (pas de clé)'}`);

// Le classifieur trace ses appels LLM via le client PostHog global (getPostHog()).
const classify = createClassifier({
  apiKey: process.env.CEREBRAS_API_KEY,
});

// Index publishedAt (RSS) partagé pour enrichir /classify. Best-effort : un échec
// RSS ne casse jamais /classify (publishedAt:null). Le cache 10 min du RssClient
// absorbe la charge.
const publishedIndex = createPublishedIndex({ rssClient: createRssClient() });

const app = createApp({ classify, publishedIndex });

const port = Number(process.env.PORT) || 8787;

serve(
  {
    fetch: app.fetch,
    port,
    hostname: '0.0.0.0',
  },
  (info) => {
    console.log(`spoilblock-backend en écoute sur http://0.0.0.0:${info.port}`);
  }
);

// Arrêt propre : flush/drain PostHog (best-effort, non bloquant si absent).
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    await shutdownPostHog();
    process.exit(0);
  });
}
