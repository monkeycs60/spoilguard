import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { DICTIONARY, t } from '../src/lib/i18n.js';

// Parité des clés entre locales : chaque clé présente en fr doit exister en en
// (et réciproquement), sinon applyI18n/t retomberaient silencieusement sur en
// ou sur la clé brute pour la locale manquante.
function symmetricDiff(a, b) {
  const ka = new Set(Object.keys(a));
  const kb = new Set(Object.keys(b));
  return {
    missingInB: [...ka].filter((k) => !kb.has(k)),
    missingInA: [...kb].filter((k) => !ka.has(k)),
  };
}

describe('i18n extension (src/lib/i18n.js) — parité fr/en', () => {
  it('fr et en ont exactement les mêmes clés', () => {
    const { missingInB, missingInA } = symmetricDiff(DICTIONARY.fr, DICTIONARY.en);
    expect({ manquantEsEn: missingInB, manquantEsFr: missingInA }).toEqual({
      manquantEsEn: [],
      manquantEsFr: [],
    });
  });

  it('aucune valeur vide dans fr ou en', () => {
    for (const loc of ['fr', 'en']) {
      for (const [k, v] of Object.entries(DICTIONARY[loc])) {
        expect(typeof v === 'string' && v.length > 0, `${loc}.${k}`).toBe(true);
      }
    }
  });

  it('t() interpole les placeholders', () => {
    // Locale résolue via navigator/chrome (absents en node) → défaut en.
    expect(t('removeCompetitionAria', { label: 'Wimbledon' })).toContain('Wimbledon');
  });

  it('t() retombe sur la clé si absente', () => {
    expect(t('__inexistante__')).toBe('__inexistante__');
  });
});

// Le companion (backend/public/index.html) embarque son dico I18N inline.
// On l'extrait par regex et on vérifie la même parité fr/en.
// Le companion a été retiré du repo (commit « retrait companion ») : si le
// fichier est absent, on saute ce bloc plutôt que de faire échouer la suite.
const companionUrl = new URL('../backend/public/index.html', import.meta.url);
const companionExists = existsSync(companionUrl);
describe.skipIf(!companionExists)('i18n companion (backend/public/index.html) — parité fr/en', () => {
  const html = companionExists ? readFileSync(companionUrl, 'utf8') : '';
  const m = html.match(/var I18N = (\{[\s\S]*?\n {4}\});/);

  it('bloc I18N trouvé dans le HTML', () => {
    expect(m).not.toBeNull();
  });

  it('fr et en ont exactement les mêmes clés', () => {
    // eslint-disable-next-line no-eval
    const I18N = eval('(' + m[1] + ')');
    const { missingInB, missingInA } = symmetricDiff(I18N.fr, I18N.en);
    expect({ manquantEsEn: missingInB, manquantEsFr: missingInA }).toEqual({
      manquantEsEn: [],
      manquantEsFr: [],
    });
  });
});
