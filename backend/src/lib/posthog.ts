// Client PostHog (server-side) partagé par tout le backend SpoilGuard.
//
// Deux responsabilités :
//  1. Observabilité LLM — chaque appel Cerebras est capturé comme un événement
//     `$ai_generation`. Le modèle Vercel AI SDK est enveloppé par `withTracing`
//     de `@posthog/ai/vercel` (auto-capture modèle/provider/tokens/latence/coût/
//     erreurs) dans createClassifier.
//  2. Events produit serveur — `classify_batch`, `feed_served` via
//     `captureServerEvent`.
//
// Projet PostHog EU PARTAGÉ entre plusieurs produits : on distingue SpoilGuard
// via la super-property `product: 'spoilblock'` attachée à TOUS les events.
//
// PRIVACY : aucun événement ne contient de titre complet — compteurs et
// métadonnées (ids de compétition, tailles de batch) uniquement.
//
// BEST EFFORT ABSOLU : une panne PostHog ne doit JAMAIS casser un appel LLM ni
// une requête. Tout est enveloppé dans try/catch et devient un no-op quand
// aucune clé n'est configurée (POSTHOG_API_KEY absente).

import { PostHog } from 'posthog-node';

export type PostHogConfig = {
  /** Clé publique du projet PostHog (phc_…). Absente → observabilité désactivée. */
  POSTHOG_API_KEY?: string;
  /** Host PostHog (défaut EU). */
  POSTHOG_HOST?: string;
};

/** Tags attachés à CHAQUE event backend (super-properties). */
const BASE_PROPERTIES = {
  product: 'spoilblock',
} as const;

const DEFAULT_HOST = 'https://eu.i.posthog.com';

/**
 * distinct_id stable pour les appels système (pas d'utilisateur authentifié).
 * Regroupe les traces backend ensemble.
 */
export const BACKEND_DISTINCT_ID = 'spoilblock-backend';

let client: PostHog | null = null;
let initialized = false;

/**
 * Initialise le client PostHog partagé (idempotent).
 * No-op quand POSTHOG_API_KEY est absente — tout reste un no-op sûr en dev/CI.
 */
export function initPostHog(config: PostHogConfig): PostHog | null {
  if (initialized) {
    return client;
  }
  initialized = true;

  const apiKey = config.POSTHOG_API_KEY?.trim();
  if (!apiKey) {
    // Pas de clé → observabilité désactivée. Ne lève jamais.
    return null;
  }

  try {
    client = new PostHog(apiKey, {
      host: config.POSTHOG_HOST?.trim() || DEFAULT_HOST,
      // Backend éphémère (Coolify) : on flush tôt.
      flushAt: 1,
      flushInterval: 0,
    });
  } catch (error) {
    console.error('[PostHog] init échouée :', error);
    client = null;
  }

  return client;
}

/** Renvoie le client partagé, ou null quand désactivé. */
export function getPostHog(): PostHog | null {
  return client;
}

/**
 * Injecte/remplace le client (câblage explicite + tests).
 * Marque comme initialisé pour que initPostHog ne l'écrase pas.
 */
export function setPostHogClient(next: PostHog | null): void {
  client = next;
  initialized = true;
}

/** True quand PostHog est configuré et actif. */
export function isPostHogEnabled(): boolean {
  return client !== null;
}

/** Flush best-effort de la file d'events. Ne lève jamais. */
export async function flushPostHog(): Promise<void> {
  if (!client) return;
  try {
    await client.flush();
  } catch (error) {
    console.error('[PostHog] flush échoué :', error);
  }
}

/**
 * Arrêt propre (draine la file). Best-effort ; réinitialise l'état même sans
 * client (testabilité — un nouvel initPostHog repartira de zéro).
 */
export async function shutdownPostHog(): Promise<void> {
  if (client) {
    try {
      await client.shutdown();
    } catch (error) {
      console.error('[PostHog] shutdown échoué :', error);
    }
  }
  client = null;
  initialized = false;
}

/**
 * Capture un event produit serveur (source de vérité côté backend).
 *
 * ⚠️ PRIVACY : ne JAMAIS passer de titre complet dans `properties` — compteurs,
 * ids de compétition et métadonnées techniques uniquement.
 *
 * Best-effort, ne lève jamais ; no-op quand PostHog est désactivé.
 */
export function captureServerEvent(
  event: string,
  distinctId: string,
  properties?: Record<string, unknown>
): void {
  if (!client) return;
  try {
    client.capture({
      distinctId,
      event,
      properties: {
        ...BASE_PROPERTIES,
        ...properties,
      },
    });
  } catch (captureError) {
    console.error('[PostHog] captureServerEvent échoué :', captureError);
  }
}

/**
 * Options `withTracing` pour un modèle Vercel AI SDK. Centralise les tags de base
 * (product) : les call sites fournissent juste distinctId + propriétés métier.
 */
export function aiTracingOptions(args: {
  distinctId?: string;
  traceId?: string;
  properties?: Record<string, unknown>;
  privacyMode?: boolean;
}) {
  return {
    posthogDistinctId: args.distinctId || BACKEND_DISTINCT_ID,
    ...(args.traceId ? { posthogTraceId: args.traceId } : {}),
    posthogProperties: {
      ...BASE_PROPERTIES,
      ...args.properties,
    },
    ...(args.privacyMode !== undefined ? { posthogPrivacyMode: args.privacyMode } : {}),
  };
}
