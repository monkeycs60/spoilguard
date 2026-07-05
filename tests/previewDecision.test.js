import { describe, it, expect } from 'vitest';
import { previewDecision, parseVideoIdFromHref } from '../src/lib/previewDecision.js';

describe('parseVideoIdFromHref', () => {
  it('href /watch?v= avec query pp', () =>
    expect(parseVideoIdFromHref('/watch?v=Y8lwQN3ezqs&pp=ygUM')).toBe('Y8lwQN3ezqs'));
  it('href absolu www.youtube.com', () =>
    expect(parseVideoIdFromHref('https://www.youtube.com/watch?v=sdoHRXoLK0A')).toBe(
      'sdoHRXoLK0A',
    ));
  it('href v= en milieu de query (&v=)', () =>
    expect(parseVideoIdFromHref('/watch?list=RD&v=abcdefghijk&index=2')).toBe('abcdefghijk'));
  it('href /shorts/', () =>
    expect(parseVideoIdFromHref('/shorts/Y8lwQN3ezqs')).toBe('Y8lwQN3ezqs'));
  it('href sans v exploitable → null', () =>
    expect(parseVideoIdFromHref('/results?search_query=tour')).toBe(null));
  it('href vide/nul → null (jamais de chaîne vide)', () => {
    expect(parseVideoIdFromHref('')).toBe(null);
    expect(parseVideoIdFromHref(null)).toBe(null);
    expect(parseVideoIdFromHref(undefined)).toBe(null);
  });
});

describe('previewDecision', () => {
  const veiled = new Set(['Y8lwQN3ezqs', 'sdoHRXoLK0A']);

  it('videoId voilé → block (true)', () =>
    expect(previewDecision('Y8lwQN3ezqs', veiled)).toBe(true));
  it('videoId non voilé → unblock (false)', () =>
    expect(previewDecision('zzzzzzzzzzz', veiled)).toBe(false));
  it('videoId absent → unblock (false), pas de sur-masquage', () => {
    expect(previewDecision(null, veiled)).toBe(false);
    expect(previewDecision('', veiled)).toBe(false);
    expect(previewDecision(undefined, veiled)).toBe(false);
  });
  it('registre absent/incompatible → unblock (false)', () => {
    expect(previewDecision('Y8lwQN3ezqs', null)).toBe(false);
    expect(previewDecision('Y8lwQN3ezqs', undefined)).toBe(false);
    expect(previewDecision('Y8lwQN3ezqs', {})).toBe(false);
  });
  it('registre vide → unblock (false)', () =>
    expect(previewDecision('Y8lwQN3ezqs', new Set())).toBe(false));
});
