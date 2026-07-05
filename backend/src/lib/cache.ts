// Cache in-memory générique avec TTL.
//
// - Éviction lazy : une entrée expirée est supprimée à la lecture (pas de timer).
// - Cap dur (défaut 50k) : au-delà, on évince l'entrée la plus ancienne insérée
//   (Map conserve l'ordre d'insertion) — suffisant pour un cache de classification
//   qui se reconstruit tout seul.

export type CacheOptions = {
  /** Durée de vie d'une entrée en millisecondes (défaut 24 h). */
  ttlMs?: number;
  /** Nombre max d'entrées avant éviction FIFO (défaut 50 000). */
  maxEntries?: number;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const DEFAULT_MAX_ENTRIES = 50_000;

/**
 * Clé de cache de classification : la classification DÉPEND des compétitions
 * demandées (une vidéo Wimbledon peut être « sans spoiler » pour le TdF mais
 * spoiler pour Wimbledon). Scoper la clé par [compétitions triées] + videoId
 * empêche toute contamination inter-compétitions (C1) : deux jeux de compétitions
 * distincts ne partagent JAMAIS un résultat, et changer de compétitions invalide
 * naturellement le cache.
 */
export function classificationKey(competitions: string[], videoId: string): string {
  return [...competitions].sort().join('+') + '|' + videoId;
}

type Entry<V> = { value: V; expiresAt: number };

export class TTLCache<V> {
  private store = new Map<string, Entry<V>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: CacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  set(key: string, value: V, ttlMs?: number): void {
    // Réinsérer déplace la clé en fin d'ordre d'insertion (LRU-approx à l'écriture).
    if (this.store.has(key)) this.store.delete(key);
    else if (this.store.size >= this.maxEntries) this.evictOldest();
    this.store.set(key, { value, expiresAt: Date.now() + (ttlMs ?? this.ttlMs) });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  private evictOldest(): void {
    const oldest = this.store.keys().next().value;
    if (oldest !== undefined) this.store.delete(oldest);
  }
}
