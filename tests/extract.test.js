import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { extractCard, CARD_SELECTOR } from '../src/lib/extract.js';

function load(name) {
  const html = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  return new JSDOM(html).window.document.body.firstElementChild;
}

describe('extractCard — ytd-video-renderer (page recherche)', () => {
  const info = extractCard(load('video-renderer.html'));
  it('videoId exact', () => expect(info.videoId).toBe('sdoHRXoLK0A'));
  it('titre trimé et complet', () =>
    expect(info.title).toBe(
      "Tour de France 2026 : Visma IMPRESSIONNE, Jonas Vingegaard en JAUNE ! (résumé de l'étape 1)",
    ));
  it('chaîne exacte', () => expect(info.channel).toBe('France tv sport'));
  it('ageText isolé', () => expect(info.ageText).toBe('il y a 4 heures'));
  it('expose titleEl', () => expect(info.titleEl).toBeTruthy());
});

describe('extractCard — ytd-rich-item-renderer (grille chaîne, sans nom de chaîne)', () => {
  const info = extractCard(load('rich-item.html'));
  it('videoId exact', () => expect(info.videoId).toBe('9fBnpz0zcAM'));
  it('titre contient un extrait attendu', () =>
    expect(info.title).toContain('Le Tour de France de Paul Seixas'));
  it("channel === '' (cas légitime, pas de nom de chaîne dans la carte)", () =>
    expect(info.channel).toBe(''));
  it('ageText isolé', () => expect(info.ageText).toBe('il y a 2 heures'));
  it('expose titleEl', () => expect(info.titleEl).toBeTruthy());
});

describe('extractCard — yt-lockup-view-model (sidebar /watch)', () => {
  const info = extractCard(load('compact.html'));
  it('videoId exact', () => expect(info.videoId).toBe('p7W98NR6xI0'));
  it('titre contient un extrait attendu', () =>
    expect(info.title).toContain('Tadej Pogacar doit-il avoir peur ?'));
  it('chaîne exacte (extraite malgré icône imbriquée)', () =>
    expect(info.channel).toBe('Eurosport France'));
  it('ageText isolé', () => expect(info.ageText).toBe('il y a 3 heures'));
  it('expose titleEl', () => expect(info.titleEl).toBeTruthy());
});

describe('robustesse', () => {
  it('ne plante pas sur une carte vide et retourne des valeurs sûres', () => {
    const empty = new JSDOM('<ytd-video-renderer></ytd-video-renderer>').window.document.body
      .firstElementChild;
    const info = extractCard(empty);
    expect(info.videoId).toBe(null);
    expect(info.title).toBe('');
    expect(info.channel).toBe('');
    expect(info.ageText).toBe(null); // jamais une chaîne blanche
  });

  it('ageText vide/espaces → null (jamais de chaîne blanche)', () => {
    const html =
      '<ytd-video-renderer><a href="/watch?v=abcdefghijk"></a>' +
      '<div id="metadata-line"><span>il y a </span></div></ytd-video-renderer>';
    const card = new JSDOM(html).window.document.body.firstElementChild;
    // Le span matche /il y a/ mais son texte trimé "il y a" reste non vide → conservé.
    // On vérifie surtout qu'un span réellement blanc ne produit pas de chaîne d'espaces.
    const blankHtml =
      '<ytd-video-renderer><a href="/watch?v=abcdefghijk"></a>' +
      '<div id="metadata-line"><span>   </span></div></ytd-video-renderer>';
    const blank = new JSDOM(blankHtml).window.document.body.firstElementChild;
    expect(extractCard(blank).ageText).toBe(null);
    void card;
  });

  it('CARD_SELECTOR couvre les 4 types de cartes', () => {
    expect(CARD_SELECTOR).toContain('ytd-rich-item-renderer');
    expect(CARD_SELECTOR).toContain('ytd-video-renderer');
    expect(CARD_SELECTOR).toContain('ytd-compact-video-renderer');
    expect(CARD_SELECTOR).toContain('yt-lockup-view-model');
  });
});
