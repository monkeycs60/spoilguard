// Classification LLM des titres de vidéos (spoiler ? + safeTitle propre).
//
// Le provider LLM est injectable (generateObjectImpl) pour permettre le mock en
// test SANS toucher au fetch global : on remplace directement l'appel au SDK.

import { z } from 'zod';
import { generateObject as defaultGenerateObject } from 'ai';
import { createCerebras } from '@ai-sdk/cerebras';
import { resolveCompetitions, type Competition } from '../data/competitions';

export type Video = { videoId: string; title: string; channel?: string };
export type Classification = {
  videoId: string;
  spoiler: boolean;
  safeTitle: string | null;
};

/** Signature du classifieur consommé par la route /classify. */
export type ClassifyFn = (
  competitionIds: string[],
  videos: Video[]
) => Promise<Classification[]>;

export const DEFAULT_MODEL_ID = 'gpt-oss-120b';

// Schéma strict imposé au LLM. On enveloppe le tableau dans un objet `results`
// (plus fiable que le mode array brut sur certains providers).
export const classificationSchema = z.object({
  results: z.array(
    z.object({
      videoId: z.string(),
      spoiler: z.boolean(),
      safeTitle: z.string().nullable(),
    })
  ),
});

export type ClassificationObject = z.infer<typeof classificationSchema>;

/** Résultat de repli : en cas de doute, on voile (prudence). */
export function fallbackResult(video: Video): Classification {
  return { videoId: video.videoId, spoiler: true, safeTitle: null };
}

/** Construit le prompt de classification pour un batch de vidéos. */
export function buildPrompt(competitions: Competition[], videos: Video[]): string {
  const compLines = competitions.length
    ? competitions
        .map((c) => `- ${c.id} : ${c.emoji} ${c.label} (mots-clés : ${c.lexicon.join(', ')})`)
        .join('\n')
    : '- (aucune compétition suivie)';

  const videoLines = videos
    .map((v) => {
      const channel = v.channel ? ` | chaîne : ${v.channel}` : '';
      return `- videoId=${v.videoId} | titre : ${v.title}${channel}`;
    })
    .join('\n');

  return `Tu es un filtre anti-spoiler pour des amateurs de sport qui n'ont pas encore vu les compétitions qu'ils suivent.

COMPÉTITIONS SUIVIES :
${compLines}

Pour CHAQUE vidéo ci-dessous, décide si son titre est un SPOILER pour l'une des compétitions suivies.

Est un spoiler (spoiler=true) tout titre qui RÉVÈLE ou laisse DEVINER un résultat de ces compétitions :
- vainqueur, podium, classement, écart, temps, abandon ;
- nationalité ou nom qui trahit le gagnant ;
- ton émotionnel révélateur (« incroyable exploit », « domination totale », « effondrement », « craque »).

N'est PAS un spoiler (spoiler=false) :
- une vidéo NON liée aux compétitions suivies (autre sport, autre sujet, autre édition) → spoiler=false ;
- une annonce neutre AVANT course (parcours, favoris, présentation d'étape) sans résultat.

En cas de doute sur une vidéo liée à une compétition suivie → spoiler=true (prudence).

Pour chaque vidéo avec spoiler=true, rédige un safeTitle EN FRANÇAIS qui :
- conserve la compétition, l'étape/journée et le TYPE de contenu (résumé, interview, analyse, réactions, temps forts) ;
- NE donne AUCUN indice de résultat (ni nom de vainqueur, ni classement, ni ton révélateur) ;
- est préfixé de l'emoji de la compétition concernée.
Exemple : "🚴 Tour de France 2026 – Résumé étape 2".
Pour spoiler=false, mets safeTitle=null.

Réponds STRICTEMENT avec un objet { results: [...] } contenant une entrée par vidéo, avec le même videoId.

VIDÉOS :
${videoLines}`;
}

export type GenerateObjectImpl = (args: {
  model: unknown;
  schema: typeof classificationSchema;
  prompt: string;
  temperature?: number;
  maxRetries?: number;
}) => Promise<{ object: ClassificationObject }>;

export type ClassifierOptions = {
  /** Clé API Cerebras (ignorée si `model`/`generateObjectImpl` fournis). */
  apiKey?: string;
  /** Id de modèle (défaut gpt-oss-120b). */
  modelId?: string;
  /** Instance de modèle pré-construite (optionnel). */
  model?: unknown;
  /** Implémentation de generateObject injectable (pour tests). */
  generateObjectImpl?: GenerateObjectImpl;
};

/**
 * Construit un classifieur. En prod il appelle Cerebras/gpt-oss-120b via le
 * Vercel AI SDK ; en test on injecte `generateObjectImpl`.
 *
 * Stratégie : 1 appel + 1 retry en cas d'échec (schéma invalide, réseau…).
 * Échec définitif → fallbackResult (spoiler:true) pour chaque vidéo.
 */
export function createClassifier(options: ClassifierOptions = {}): ClassifyFn {
  const generate = options.generateObjectImpl ??
    (defaultGenerateObject as unknown as GenerateObjectImpl);

  // Construction paresseuse + mémoïsée du modèle : permet à `npm run dev` de
  // démarrer sans clé (le /health répond), et un /classify sans clé tombera dans
  // le fallback voilé plutôt que de crasher au boot.
  let resolvedModel = options.model;
  const getModel = (): unknown => {
    if (resolvedModel) return resolvedModel;
    // Impl injectée (tests) : le modèle n'est pas utilisé, on ne le construit pas.
    if (options.generateObjectImpl) return undefined;
    const apiKey = options.apiKey ?? process.env.CEREBRAS_API_KEY;
    if (!apiKey) {
      throw new Error('CEREBRAS_API_KEY manquante (requise pour le classifieur réel)');
    }
    const cerebras = createCerebras({ apiKey });
    resolvedModel = cerebras(options.modelId ?? DEFAULT_MODEL_ID);
    return resolvedModel;
  };

  return async function classify(competitionIds, videos) {
    if (videos.length === 0) return [];

    const competitions = resolveCompetitions(competitionIds);
    const prompt = buildPrompt(competitions, videos);

    const runOnce = () =>
      generate({
        model: getModel(),
        schema: classificationSchema,
        prompt,
        temperature: 0,
        // On pilote nous-mêmes le retry (x1) ci-dessous.
        maxRetries: 0,
      });

    let object: ClassificationObject;
    try {
      ({ object } = await runOnce());
    } catch (firstError) {
      try {
        ({ object } = await runOnce()); // retry x1
      } catch (secondError) {
        console.error('[classifier] échec définitif, fallback voilé:', secondError);
        return videos.map(fallbackResult);
      }
    }

    // Ré-alignement par videoId + repli pour toute vidéo manquante.
    const byId = new Map(object.results.map((r) => [r.videoId, r]));
    return videos.map((v) => {
      const r = byId.get(v.videoId);
      if (!r) return fallbackResult(v);
      return { videoId: v.videoId, spoiler: r.spoiler, safeTitle: r.safeTitle };
    });
  };
}
