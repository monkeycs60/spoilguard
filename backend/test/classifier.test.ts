import { describe, it, expect, vi } from 'vitest';
import {
  createClassifier,
  buildPrompt,
  fallbackResult,
  type ClassificationObject,
  type GenerateObjectImpl,
} from '../src/lib/classifier';
import { TDF_2026 } from '../src/data/competitions';

const videos = [
  { videoId: 'v1', title: 'Pogacar écrase tout sur l\'étape 5', channel: 'eurosport' },
  { videoId: 'v2', title: 'Recette de crêpes', channel: 'cuisine' },
];

function mockGenerate(object: ClassificationObject): GenerateObjectImpl {
  return async () => ({ object });
}

describe('buildPrompt', () => {
  it('inclut la compétition et chaque videoId', () => {
    const prompt = buildPrompt([TDF_2026], videos);
    expect(prompt).toContain('Tour de France');
    expect(prompt).toContain('videoId=v1');
    expect(prompt).toContain('videoId=v2');
  });
});

describe('fallbackResult', () => {
  it('voile par défaut', () => {
    expect(fallbackResult(videos[0])).toEqual({ videoId: 'v1', spoiler: true, safeTitle: null });
  });
});

describe('createClassifier', () => {
  it('renvoie [] pour un batch vide sans appeler le LLM', async () => {
    const impl = vi.fn();
    const classify = createClassifier({ generateObjectImpl: impl as unknown as GenerateObjectImpl });
    expect(await classify(['tdf-2026'], [])).toEqual([]);
    expect(impl).not.toHaveBeenCalled();
  });

  it('mappe les résultats du LLM par videoId', async () => {
    const classify = createClassifier({
      generateObjectImpl: mockGenerate({
        results: [
          { videoId: 'v1', spoiler: true, safeTitle: '🚴 Tour de France 2026 – Résumé étape 5' },
          { videoId: 'v2', spoiler: false, safeTitle: null },
        ],
      }),
    });
    const out = await classify(['tdf-2026'], videos);
    expect(out).toEqual([
      { videoId: 'v1', spoiler: true, safeTitle: '🚴 Tour de France 2026 – Résumé étape 5' },
      { videoId: 'v2', spoiler: false, safeTitle: null },
    ]);
  });

  it('retente une fois puis réussit', async () => {
    let calls = 0;
    const impl: GenerateObjectImpl = async () => {
      calls += 1;
      if (calls === 1) throw new Error('schema invalide');
      return { object: { results: [{ videoId: 'v1', spoiler: false, safeTitle: null }] } };
    };
    const classify = createClassifier({ generateObjectImpl: impl });
    const out = await classify(['tdf-2026'], [videos[0]]);
    expect(calls).toBe(2);
    expect(out[0].spoiler).toBe(false);
  });

  it('tombe en fallback voilé après échec définitif (2 échecs)', async () => {
    let calls = 0;
    const impl: GenerateObjectImpl = async () => {
      calls += 1;
      throw new Error('boom');
    };
    const classify = createClassifier({ generateObjectImpl: impl });
    const out = await classify(['tdf-2026'], videos);
    expect(calls).toBe(2); // 1 appel + 1 retry
    expect(out).toEqual([
      { videoId: 'v1', spoiler: true, safeTitle: null },
      { videoId: 'v2', spoiler: true, safeTitle: null },
    ]);
  });

  it('voile une vidéo absente de la réponse du LLM', async () => {
    const classify = createClassifier({
      generateObjectImpl: mockGenerate({
        results: [{ videoId: 'v1', spoiler: false, safeTitle: null }],
      }),
    });
    const out = await classify(['tdf-2026'], videos);
    expect(out.find((r) => r.videoId === 'v2')).toEqual({
      videoId: 'v2',
      spoiler: true,
      safeTitle: null,
    });
  });
});
