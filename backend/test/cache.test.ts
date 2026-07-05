import { describe, it, expect, vi, afterEach } from 'vitest';
import { TTLCache, classificationKey } from '../src/lib/cache';
import { PROMPT_VERSION } from '../src/lib/classifier';

afterEach(() => {
  vi.useRealTimers();
});

describe('classificationKey', () => {
  it('préfixe la clé par la version du prompt (invalidation cache au bump)', () => {
    expect(classificationKey(['tdf-2026'], 'v1')).toBe(`v${PROMPT_VERSION}|tdf-2026|v1`);
  });

  it('utilise la version courante (2)', () => {
    expect(PROMPT_VERSION).toBe(2);
    expect(classificationKey(['tdf-2026'], 'v1').startsWith('v2|')).toBe(true);
  });

  it('trie les compétitions pour une clé stable indépendante de l\'ordre', () => {
    const a = classificationKey(['wimbledon-2026', 'tdf-2026'], 'v1');
    const b = classificationKey(['tdf-2026', 'wimbledon-2026'], 'v1');
    expect(a).toBe(b);
    expect(a).toBe(`v${PROMPT_VERSION}|tdf-2026+wimbledon-2026|v1`);
  });

  it('sépare deux jeux de compétitions distincts (pas de contamination)', () => {
    expect(classificationKey(['tdf-2026'], 'v1')).not.toBe(
      classificationKey(['wimbledon-2026'], 'v1')
    );
  });

  it('un bump de version change toutes les clés existantes', () => {
    // Sanity : la clé v1 « historique » n'est plus jamais produite tant que
    // PROMPT_VERSION > 1, donc les verdicts v1 en cache ne sont plus lus.
    expect(classificationKey(['tdf-2026'], 'v1').startsWith('v1|')).toBe(false);
  });
});

describe('TTLCache', () => {
  it('stocke et récupère une valeur', () => {
    const cache = new TTLCache<number>();
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.has('a')).toBe(true);
    expect(cache.get('absent')).toBeUndefined();
  });

  it('expire une entrée après le TTL (éviction lazy)', () => {
    vi.useFakeTimers();
    const cache = new TTLCache<string>({ ttlMs: 1000 });
    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');
    vi.advanceTimersByTime(1001);
    expect(cache.get('k')).toBeUndefined();
    expect(cache.size).toBe(0); // supprimée à la lecture
  });

  it('respecte le cap et évince la plus ancienne (FIFO)', () => {
    const cache = new TTLCache<number>({ maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // évince 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('permet un TTL par entrée', () => {
    vi.useFakeTimers();
    const cache = new TTLCache<number>({ ttlMs: 10_000 });
    cache.set('short', 1, 500);
    vi.advanceTimersByTime(600);
    expect(cache.get('short')).toBeUndefined();
  });
});
