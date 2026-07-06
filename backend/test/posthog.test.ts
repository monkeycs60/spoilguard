import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  initPostHog,
  getPostHog,
  setPostHogClient,
  isPostHogEnabled,
  captureServerEvent,
  aiTracingOptions,
  shutdownPostHog,
  BACKEND_DISTINCT_ID,
} from '../src/lib/posthog';
import { createApp } from '../src/app';
import { createClassifier, type ClassificationObject, type GenerateObjectImpl } from '../src/lib/classifier';

// Client PostHog factice : capture les appels sans réseau.
function fakeClient() {
  return {
    capture: vi.fn(),
    flush: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
  };
}

// Chaque test repart d'un état PostHog propre (le client est un singleton module).
afterEach(async () => {
  await shutdownPostHog();
});

describe('posthog — no-op sans clé', () => {
  it('initPostHog sans clé → client null, désactivé', () => {
    const client = initPostHog({});
    expect(client).toBeNull();
    expect(getPostHog()).toBeNull();
    expect(isPostHogEnabled()).toBe(false);
  });

  it('captureServerEvent ne lève pas quand désactivé', () => {
    initPostHog({});
    expect(() => captureServerEvent('classify_batch', BACKEND_DISTINCT_ID, { hits: 1 })).not.toThrow();
  });

  it('aiTracingOptions porte toujours product:spoilblock', () => {
    const opts = aiTracingOptions({ properties: { batch_size: 3 } });
    expect(opts.posthogProperties).toMatchObject({ product: 'spoilblock', batch_size: 3 });
    expect(opts.posthogDistinctId).toBe(BACKEND_DISTINCT_ID);
  });

  it('shutdownPostHog réinitialise l\'état (réinit possible)', async () => {
    initPostHog({});
    await shutdownPostHog();
    // Après reset, une nouvelle init prend effet.
    setPostHogClient(fakeClient() as never);
    expect(isPostHogEnabled()).toBe(true);
  });
});

describe('posthog — avec client mocké', () => {
  it('captureServerEvent envoie product:spoilblock + props', () => {
    const client = fakeClient();
    setPostHogClient(client as never);
    captureServerEvent('feed_served', BACKEND_DISTINCT_ID, { competitionId: 'tdf-2026', videos: 5, spoilers: 2 });
    expect(client.capture).toHaveBeenCalledTimes(1);
    const arg = client.capture.mock.calls[0][0];
    expect(arg.event).toBe('feed_served');
    expect(arg.properties).toMatchObject({
      product: 'spoilblock',
      competitionId: 'tdf-2026',
      videos: 5,
      spoilers: 2,
    });
  });
});

describe('classify — fonctionne avec ET sans PostHog', () => {
  const videos = [
    { videoId: 'v1', title: 'Pogacar écrase tout', channel: 'eurosport' },
    { videoId: 'v2', title: 'Recette de crêpes' },
  ];
  const object: ClassificationObject = {
    results: [
      { videoId: 'v1', spoiler: true, safeTitle: '🚴 Résumé étape' },
      { videoId: 'v2', spoiler: false, safeTitle: null },
    ],
  };

  it('sans PostHog (postHog:null) → résultats corrects', async () => {
    const classify = createClassifier({
      postHog: null,
      generateObjectImpl: (async () => ({ object })) as GenerateObjectImpl,
    });
    const out = await classify(['tdf-2026'], videos);
    expect(out).toEqual([
      { videoId: 'v1', spoiler: true, safeTitle: '🚴 Résumé étape' },
      { videoId: 'v2', spoiler: false, safeTitle: null },
    ]);
  });

  it('avec PostHog mocké injecté → résultats corrects (tracing ne casse rien)', async () => {
    const client = fakeClient();
    // model factice pour que le chemin withTracing soit emprunté.
    const generateObjectImpl = vi.fn(async () => ({ object })) as unknown as GenerateObjectImpl;
    const classify = createClassifier({
      postHog: client as never,
      model: { fake: 'model' },
      generateObjectImpl,
    });
    const out = await classify(['tdf-2026'], videos);
    expect(out.map((r) => r.spoiler)).toEqual([true, false]);
    expect(generateObjectImpl).toHaveBeenCalledTimes(1);
  });
});

describe('routes — events produit sans fuite de titre', () => {
  it('/classify émet classify_batch (source:extension) sans titre complet', async () => {
    const client = fakeClient();
    setPostHogClient(client as never);
    const app = createApp({
      classify: async (_c, vids) => vids.map((v) => ({ videoId: v.videoId, spoiler: false, safeTitle: null })),
    });
    const secretTitle = 'Pogacar gagne le contre-la-montre secret';
    const res = await app.request('/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ competitions: ['tdf-2026'], videos: [{ videoId: 'v1', title: secretTitle }] }),
    });
    expect(res.status).toBe(200);

    const batchCall = client.capture.mock.calls.find((c) => c[0].event === 'classify_batch');
    expect(batchCall).toBeDefined();
    expect(batchCall![0].properties).toMatchObject({
      product: 'spoilblock',
      source: 'extension',
      competitions: ['tdf-2026'],
      misses: 1,
      hits: 0,
    });
    // PRIVACY : le titre complet ne doit apparaître dans AUCUN event.
    expect(JSON.stringify(client.capture.mock.calls)).not.toContain(secretTitle);
  });

  it('/feed émet classify_batch(source:feed) + feed_served', async () => {
    const client = fakeClient();
    setPostHogClient(client as never);
    const app = createApp({
      classify: async (_c, vids) => vids.map((v) => ({ videoId: v.videoId, spoiler: /pogacar/i.test(v.videoId) ? true : false, safeTitle: null })),
      fetchChannelFeed: async () => [
        { videoId: 'v-a', title: 'Présentation parcours', publishedAt: '2026-07-05T10:00:00Z', channel: 'Eurosport France' },
      ],
    });
    const res = await app.request('/feed/tdf-2026');
    expect(res.status).toBe(200);

    const events = client.capture.mock.calls.map((c) => c[0].event);
    expect(events).toContain('classify_batch');
    expect(events).toContain('feed_served');
    const feedServed = client.capture.mock.calls.find((c) => c[0].event === 'feed_served');
    expect(feedServed![0].properties).toMatchObject({ product: 'spoilblock', competitionId: 'tdf-2026' });
  });
});
