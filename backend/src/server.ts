// Point d'entrée Node : construit le classifieur réel (Cerebras/gpt-oss-120b),
// monte l'app Hono et démarre @hono/node-server.

import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createClassifier } from './lib/classifier';

const classify = createClassifier({
  apiKey: process.env.CEREBRAS_API_KEY,
});

const app = createApp({ classify });

const port = Number(process.env.PORT) || 8787;

serve(
  {
    fetch: app.fetch,
    port,
    hostname: '0.0.0.0',
  },
  (info) => {
    console.log(`spoilguard-backend en écoute sur http://0.0.0.0:${info.port}`);
  }
);
