import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../src/app';
import { TTLCache } from '../src/lib/cache';
import { createRateLimiter } from '../src/lib/rateLimit';
import { parseFeed, resolveChannelId, createRssClient, type RssEntry } from '../src/lib/rss';
import { fallbackResult, type Classification, type ClassifyFn } from '../src/lib/classifier';
import type { FeedResponse } from '../src/routes/feed';

// ---------------------------------------------------------------------------
// parseFeed — parsing XML minimal
// ---------------------------------------------------------------------------

// Fixture Atom YouTube réduite (2 entrées, entités XML, ordre non trié).
const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <title>Eurosport France</title>
  <author><name>Eurosport France</name><uri>https://www.youtube.com/channel/UCxxx</uri></author>
  <entry>
    <id>yt:video:AAA</id>
    <yt:videoId>AAA</yt:videoId>
    <title>Pog&#233;car &amp; Vingegaard : le duel de l'&#233;tape 5</title>
    <published>2026-07-04T18:00:00+00:00</published>
  </entry>
  <entry>
    <id>yt:video:BBB</id>
    <yt:videoId>BBB</yt:videoId>
    <title>Recette de cr&#234;pes</title>
    <published>2026-07-05T09:30:00+00:00</published>
  </entry>
</feed>`;

describe('parseFeed', () => {
  it('extrait videoId, title, publishedAt et le nom de chaîne', () => {
    const entries = parseFeed(FIXTURE_XML);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      videoId: 'AAA',
      title: "Pogécar & Vingegaard : le duel de l'étape 5",
      publishedAt: '2026-07-04T18:00:00+00:00',
      channel: 'Eurosport France',
    });
    expect(entries[1].videoId).toBe('BBB');
    expect(entries[1].title).toBe('Recette de crêpes'); // &#234; décodé
    expect(entries[1].channel).toBe('Eurosport France');
  });

  it('renvoie [] pour un flux sans entrée (chaîne vide)', () => {
    const empty = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>X</title><author><name>X</name></author></feed>`;
    expect(parseFeed(empty)).toEqual([]);
  });
});

describe('resolveChannelId', () => {
  it('résout un nom de pack (insensible à la casse) en channelId UC…', () => {
    expect(resolveChannelId('Tour de France')).toMatch(/^UC[\w-]{22}$/);
    expect(resolveChannelId('eurosport france')).toMatch(/^UC[\w-]{22}$/);
  });
  it('renvoie undefined pour une chaîne inconnue', () => {
    expect(resolveChannelId('chaîne inexistante')).toBeUndefined();
  });
});

describe('createRssClient — cache 10 min', () => {
  it('ne refetch pas une chaîne déjà en cache', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => FIXTURE_XML }));
    const client = createRssClient({ fetchImpl });

    const a = await client.fetchChannelFeed('UC1');
    const b = await client.fetchChannelFeed('UC1');
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('renvoie [] sur erreur réseau (le feed reste servi)', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('boom'); });
    const client = createRssClient({ fetchImpl });
    expect(await client.fetchChannelFeed('UC1')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /feed/:competitionId — route
// ---------------------------------------------------------------------------

// RSS mocké : 3 entrées, dates volontairement dans le désordre.
const RSS_ENTRIES: RssEntry[] = [
  { videoId: 'v-mid', title: 'Présentation du parcours étape 6', publishedAt: '2026-07-04T10:00:00Z', channel: 'Eurosport France' },
  { videoId: 'v-new', title: 'Pogacar écrase la montagne, écart énorme', publishedAt: '2026-07-05T20:00:00Z', channel: 'Lanterne Rouge' },
  { videoId: 'v-old', title: 'Recette de crêpes bretonnes', publishedAt: '2026-07-01T08:00:00Z', channel: 'Eurosport France' },
];

// classify : spoiler si le titre contient "Pogacar" ; réécrit alors le titre.
const classify: ClassifyFn = async (_ids, videos) =>
  videos.map((v) => {
    const spoiler = /pogacar/i.test(v.title);
    return {
      videoId: v.videoId,
      spoiler,
      safeTitle: spoiler ? '🚴 Tour de France – Résumé (sans résultat)' : null,
    };
  });

function makeApp(overrides: Partial<Parameters<typeof createApp>[0]> = {}) {
  return createApp({
    classify,
    fetchChannelFeed: async () => RSS_ENTRIES,
    ...overrides,
  });
}

describe('GET /feed/:competitionId', () => {
  it('404 pour une compétition inconnue', async () => {
    const app = makeApp();
    const res = await app.request('/feed/inconnue-2099');
    expect(res.status).toBe(404);
  });

  it('trie par date décroissante', async () => {
    const app = makeApp();
    const res = await app.request('/feed/tdf-2026');
    expect(res.status).toBe(200);
    const body = (await res.json()) as FeedResponse;
    expect(body.videos.map((v) => v.videoId)).toEqual(['v-new', 'v-mid', 'v-old']);
  });

  it('applique un safeTitle aux spoilers et NE fuit JAMAIS le titre original', async () => {
    const app = makeApp();
    const res = await app.request('/feed/tdf-2026');
    const body = (await res.json()) as FeedResponse;

    const spoiler = body.videos.find((v) => v.videoId === 'v-new')!;
    expect(spoiler.safeTitle).toBe('🚴 Tour de France – Résumé (sans résultat)');
    // Le titre original d'un spoiler ne doit apparaître NULLE PART dans la réponse.
    expect('originalTitle' in spoiler).toBe(false);
    expect(JSON.stringify(body)).not.toContain('écrase la montagne');
  });

  it('expose le titre original (safeTitle + originalTitle) pour un non-spoiler', async () => {
    const app = makeApp();
    const res = await app.request('/feed/tdf-2026');
    const body = (await res.json()) as FeedResponse;

    const safe = body.videos.find((v) => v.videoId === 'v-old')!;
    expect(safe.safeTitle).toBe('Recette de crêpes bretonnes');
    expect(safe.originalTitle).toBe('Recette de crêpes bretonnes');
  });

  it('met la réponse en cache (2e appel sans re-fetch ni re-classify)', async () => {
    const fetchSpy = vi.fn(async () => RSS_ENTRIES);
    const classifySpy = vi.fn(classify);
    const app = createApp({ classify: classifySpy, fetchChannelFeed: fetchSpy });

    const r1 = await app.request('/feed/tdf-2026');
    expect(r1.headers.get('X-Feed-Cache')).toBe('miss');
    const r2 = await app.request('/feed/tdf-2026');
    expect(r2.headers.get('X-Feed-Cache')).toBe('hit');

    // Un seul cycle de fetch (par chaîne) + une seule classification.
    expect(classifySpy).toHaveBeenCalledTimes(1);
  });

  it('réutilise le cache de classification partagé avec /classify', async () => {
    const cache = new TTLCache<Classification>();
    // Pré-remplit le cache comme si /classify avait déjà vu cette vidéo.
    cache.set('v-new', { videoId: 'v-new', spoiler: false, safeTitle: null });
    const classifySpy = vi.fn(classify);
    const app = createApp({ classify: classifySpy, fetchChannelFeed: async () => RSS_ENTRIES, cache });

    const res = await app.request('/feed/tdf-2026');
    const body = (await res.json()) as FeedResponse;
    // Servie depuis le cache → traitée comme non-spoiler (titre original exposé).
    const fromCache = body.videos.find((v) => v.videoId === 'v-new')!;
    expect(fromCache.originalTitle).toBe('Pogacar écrase la montagne, écart énorme');
    // classify n'a été appelé QUE pour les 2 misses (v-mid, v-old).
    const classified = classifySpy.mock.calls[0][1].map((v) => v.videoId);
    expect(classified).not.toContain('v-new');
  });

  it('429 au-delà du quota (rate limiter partagé)', async () => {
    const app = makeApp({ rateLimiter: createRateLimiter({ limit: 1, windowMs: 60_000 }) });
    expect((await app.request('/feed/tdf-2026')).status).toBe(200);
    expect((await app.request('/feed/tdf-2026')).status).toBe(429);
  });

  it('un repli LLM (fallback) ne pollue pas le cache de classification', async () => {
    const cache = new TTLCache<Classification>();
    const failing: ClassifyFn = async (_ids, videos) => videos.map(fallbackResult);
    const app = createApp({ classify: failing, fetchChannelFeed: async () => RSS_ENTRIES, cache });

    const res = await app.request('/feed/tdf-2026');
    const body = (await res.json()) as FeedResponse;
    // fallback → spoiler:true → safeTitle générique, pas d'originalTitle.
    expect(body.videos[0].safeTitle).toContain('Tour de France');
    expect('originalTitle' in body.videos[0]).toBe(false);
    // Rien n'a été mis en cache (fallback).
    expect(cache.size).toBe(0);
  });
});
