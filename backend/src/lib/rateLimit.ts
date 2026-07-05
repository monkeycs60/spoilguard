// Rate limiter in-memory à fenêtre glissante, par clé (IP).
// Suffisant pour une seule instance ; à remplacer par un store partagé si scale.

export type RateLimiterOptions = {
  /** Nombre de requêtes autorisées par fenêtre (défaut 60). */
  limit?: number;
  /** Taille de la fenêtre en ms (défaut 60 000 = 1 min). */
  windowMs?: number;
};

export type RateLimiter = {
  /** true si la requête est autorisée (et comptée), false si quota dépassé. */
  check: (key: string) => boolean;
  reset: () => void;
};

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const limit = options.limit ?? 60;
  const windowMs = options.windowMs ?? 60_000;
  const hits = new Map<string, number[]>();

  return {
    check(key: string): boolean {
      const now = Date.now();
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
    reset() {
      hits.clear();
    },
  };
}
