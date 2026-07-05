// Récupération et parsing des flux RSS publics YouTube (par chaîne).
//
// YouTube expose pour chaque chaîne un flux Atom sans quota ni clé :
//   https://www.youtube.com/feeds/videos.xml?channel_id=UC...
//
// PROBLÈME : nos packs (src/data/competitions.ts) stockent des NOMS de chaînes,
// pas des channel_id. La résolution nom→channelId par scraping de
// https://www.youtube.com/@handle est fragile (mur de consentement, 302, HTML
// volatile). SOLUTION RETENUE : une table de correspondance STATIQUE, chaque id
// ayant été vérifié en récupérant son flux RSS (auteur + <entry> conformes).
//
// Parsing XML volontairement minimal (regex/indexOf, zéro dépendance) : le format
// des flux YouTube est stable et restreint. On extrait, par <entry> :
//   yt:videoId, title, published, et le nom de chaîne (auteur au niveau du flux).

import { TTLCache } from './cache';

/** Une entrée de flux RSS normalisée. */
export type RssEntry = {
  videoId: string;
  title: string;
  /** Date de publication ISO 8601 (telle que fournie par YouTube). */
  publishedAt: string;
  /** Nom de la chaîne (auteur du flux). */
  channel: string;
};

/** Implémentation de fetch injectable (pour tests). */
export type FetchImpl = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/**
 * Table statique NOM DE CHAÎNE (normalisé, minuscules) → channelId YouTube.
 *
 * Chaque channelId a été vérifié le 2026-07-05 en récupérant
 * https://www.youtube.com/feeds/videos.xml?channel_id=UC... et en confrontant
 * le <name> du flux au nom attendu. Les clés correspondent aux noms présents
 * dans `channels` des packs (src/data/competitions.ts).
 *
 * Note : les chaînes officielles saisonnières (Tour de France, La chaîne l'Équipe)
 * peuvent avoir un flux temporairement vide hors compétition — l'id reste valide.
 */
export const CHANNEL_ID_MAP: Record<string, string> = {
  'tour de france': 'UCZF_0TqrblIsnmArWyWIg0A', // auteur RSS: « tourdefrance »
  'eurosport france': 'UCozt5iXNqmhU1I7tcjJ0UFQ', // auteur RSS: « Eurosport France »
  'france tv sport': 'UCh4o9ioiqbUveUrCLP8Wv6A', // auteur RSS: « france tv »
  'france.tv slash sport': 'UCh4o9ioiqbUveUrCLP8Wv6A',
  "la chaine l'équipe": 'UC6vcN22Apu8HakHBVa28sWw', // auteur RSS: « La chaîne l'équipe »
  "l'équipe": 'UC6vcN22Apu8HakHBVa28sWw',
  'cycling pro net': 'UCAKkRVGHv4uHTM5S2jSzLDQ', // auteur RSS: « Cycling Pro Net »
  'lanterne rouge': 'UC77UtoyivVHkpApL0wGfH5w', // auteur RSS: « Lanterne Rouge »
  'velon cc': 'UCcbBlBEtCZ2lX7bodgi02Xg', // auteur RSS: « Velon »
};

/** Résout un nom de chaîne (tel qu'en pack) en channelId, ou undefined si inconnu. */
export function resolveChannelId(channelName: string): string | undefined {
  return CHANNEL_ID_MAP[channelName.trim().toLowerCase()];
}

/** Déséchappe les entités XML courantes rencontrées dans les titres YouTube. */
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&'); // en dernier pour ne pas ré-interpréter les autres
}

/** Extrait le contenu d'une balise `<tag>...</tag>` (première occurrence) dans un fragment. */
function tag(fragment: string, name: string): string | null {
  const open = `<${name}>`;
  const close = `</${name}>`;
  const start = fragment.indexOf(open);
  if (start === -1) return null;
  const end = fragment.indexOf(close, start + open.length);
  if (end === -1) return null;
  return fragment.slice(start + open.length, end);
}

/**
 * Parse un flux Atom YouTube en entrées normalisées.
 * Le nom de chaîne provient de l'`<author><name>` situé AVANT la première `<entry>`
 * (niveau flux), commun à toutes les vidéos.
 */
export function parseFeed(xml: string): RssEntry[] {
  const firstEntry = xml.indexOf('<entry>');
  const head = firstEntry === -1 ? xml : xml.slice(0, firstEntry);
  const channel = unescapeXml((tag(head, 'name') ?? '').trim());

  const entries: RssEntry[] = [];
  let cursor = firstEntry;
  while (cursor !== -1) {
    const end = xml.indexOf('</entry>', cursor);
    if (end === -1) break;
    const chunk = xml.slice(cursor, end);

    const videoId = tag(chunk, 'yt:videoId');
    const title = tag(chunk, 'title');
    const published = tag(chunk, 'published');
    if (videoId && title) {
      entries.push({
        videoId: videoId.trim(),
        title: unescapeXml(title.trim()),
        publishedAt: (published ?? '').trim(),
        channel,
      });
    }

    cursor = xml.indexOf('<entry>', end);
  }
  return entries;
}

const FEED_URL = (channelId: string) =>
  `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

// Certaines chaînes ne servent le flux qu'avec un User-Agent « navigateur ».
const UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

export type RssClient = {
  /** Entrées d'une chaîne (cache 10 min). [] si la chaîne est vide ou en erreur. */
  fetchChannelFeed: (channelId: string) => Promise<RssEntry[]>;
};

export type RssClientOptions = {
  /** fetch injectable (défaut : global fetch avec UA navigateur). */
  fetchImpl?: FetchImpl;
  /** Cache par channelId (injectable pour tests). */
  cache?: TTLCache<RssEntry[]>;
  /** TTL du cache par chaîne (défaut 10 min). */
  ttlMs?: number;
};

const DEFAULT_RSS_TTL_MS = 10 * 60 * 1000; // 10 min

/**
 * Construit un client RSS avec cache in-memory 10 min par chaîne.
 * Un échec réseau ne remonte jamais : on renvoie [] (le feed reste servi).
 */
export function createRssClient(options: RssClientOptions = {}): RssClient {
  const doFetch: FetchImpl =
    options.fetchImpl ??
    ((url) => fetch(url, { headers: { 'User-Agent': UA } }));
  const cache = options.cache ?? new TTLCache<RssEntry[]>({ ttlMs: options.ttlMs ?? DEFAULT_RSS_TTL_MS });
  const ttlMs = options.ttlMs ?? DEFAULT_RSS_TTL_MS;

  return {
    async fetchChannelFeed(channelId: string): Promise<RssEntry[]> {
      const cached = cache.get(channelId);
      if (cached) return cached;

      try {
        const res = await doFetch(FEED_URL(channelId));
        if (!res.ok) {
          console.error(`[rss] ${channelId} HTTP ${res.status}`);
          return [];
        }
        const xml = await res.text();
        const entries = parseFeed(xml);
        cache.set(channelId, entries, ttlMs);
        return entries;
      } catch (err) {
        console.error(`[rss] échec ${channelId}:`, err);
        return [];
      }
    },
  };
}
