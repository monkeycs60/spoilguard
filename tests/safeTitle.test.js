import { it, expect } from 'vitest';
import { buildLocalSafeTitle } from '../src/lib/safeTitle.js';
import { TDF_2026 } from '../src/lib/pack.js';

it('construit un titre neutre avec âge', () =>
  expect(buildLocalSafeTitle(TDF_2026, 'il y a 10 heures'))
    .toBe('🛡️ 🚴 Tour de France – vidéo (il y a 10 heures)'));
it('sans âge lisible, reste générique', () =>
  expect(buildLocalSafeTitle(TDF_2026, null))
    .toBe('🛡️ 🚴 Tour de France – vidéo récente'));
