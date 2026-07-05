import { describe, it, expect, vi, afterEach } from 'vitest';
import { TTLCache } from '../src/lib/cache';

afterEach(() => {
  vi.useRealTimers();
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
