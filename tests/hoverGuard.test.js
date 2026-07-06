import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  addHoverGuard,
  removeHoverGuard,
  hasHoverGuard,
  HOVER_EVENTS,
} from '../src/lib/hoverGuard.js';

// Reconstitue la structure minimale d'une carte : un ancêtre (ytd-app) qui délègue les
// listeners de survol de YouTube, la carte voilée, et une miniature interne (cible réelle
// du survol). On mesure ce que « voit » le listener délégué en bulle sur l'ancêtre.
function makeDom() {
  const dom = new JSDOM(
    `<!doctype html><body>
       <div id="app">
         <div id="card"><div id="thumb"><a id="thumbnail" href="/watch?v=abcdefghijk"></a></div></div>
         <div id="clean-card"><div id="clean-thumb"></div></div>
       </div>
     </body>`,
  );
  const { window } = dom;
  const doc = window.document;
  return {
    window,
    app: doc.getElementById('app'),
    card: doc.getElementById('card'),
    thumb: doc.getElementById('thumb'),
    cleanCard: doc.getElementById('clean-card'),
    cleanThumb: doc.getElementById('clean-thumb'),
    MouseEvent: window.MouseEvent,
  };
}

// Attache sur l'ancêtre un compteur en PHASE BULLE (comme les listeners délégués de YouTube)
// pour chaque type d'évènement observé.
function delegateCounter(app, types) {
  const counts = {};
  for (const t of types) {
    counts[t] = 0;
    app.addEventListener(t, () => counts[t]++, false);
  }
  return counts;
}

describe('hoverGuard — interception des évènements de survol', () => {
  let d;
  beforeEach(() => {
    d = makeDom();
  });

  it('sans garde : le listener délégué VOIT le survol (pas de sur-blocage)', () => {
    const counts = delegateCounter(d.app, HOVER_EVENTS);
    for (const t of HOVER_EVENTS) {
      d.thumb.dispatchEvent(new d.MouseEvent(t, { bubbles: true, cancelable: true }));
    }
    for (const t of HOVER_EVENTS) expect(counts[t]).toBe(1);
  });

  it('avec garde : AUCUN évènement de survol ne remonte au listener délégué', () => {
    const counts = delegateCounter(d.app, HOVER_EVENTS);
    addHoverGuard(d.card);
    for (const t of HOVER_EVENTS) {
      d.thumb.dispatchEvent(new d.MouseEvent(t, { bubbles: true, cancelable: true }));
    }
    for (const t of HOVER_EVENTS) expect(counts[t]).toBe(0);
  });

  it('avec garde : les listeners internes de la carte (cible) ne se déclenchent pas non plus', () => {
    let inner = 0;
    d.thumb.addEventListener('mouseover', () => inner++, false);
    addHoverGuard(d.card);
    d.thumb.dispatchEvent(new d.MouseEvent('mouseover', { bubbles: true }));
    expect(inner).toBe(0);
  });

  it('la garde NE casse PAS le dblclick de révélation ni le click de navigation', () => {
    let dbl = 0;
    let clicks = 0;
    d.app.addEventListener('dblclick', () => dbl++, false);
    d.app.addEventListener('click', () => clicks++, false);
    addHoverGuard(d.card);
    d.thumb.dispatchEvent(new d.MouseEvent('dblclick', { bubbles: true }));
    d.thumb.dispatchEvent(new d.MouseEvent('click', { bubbles: true }));
    expect(dbl).toBe(1);
    expect(clicks).toBe(1);
  });

  it('removeHoverGuard rétablit la preview : le survol remonte de nouveau', () => {
    const counts = delegateCounter(d.app, ['mouseover']);
    addHoverGuard(d.card);
    removeHoverGuard(d.card);
    d.thumb.dispatchEvent(new d.MouseEvent('mouseover', { bubbles: true }));
    expect(counts.mouseover).toBe(1);
  });

  it('garde sur une carte n\'affecte pas une carte voisine non gardée', () => {
    let cleanSeen = 0;
    d.app.addEventListener('mouseover', (e) => {
      if (e.target.closest('#clean-card')) cleanSeen++;
    });
    addHoverGuard(d.card);
    d.cleanThumb.dispatchEvent(new d.MouseEvent('mouseover', { bubbles: true }));
    expect(cleanSeen).toBe(1);
  });

  it('addHoverGuard est idempotent et hasHoverGuard reflète l\'état', () => {
    expect(hasHoverGuard(d.card)).toBe(false);
    addHoverGuard(d.card);
    addHoverGuard(d.card); // ne doit pas empiler
    expect(hasHoverGuard(d.card)).toBe(true);
    const counts = delegateCounter(d.app, ['mouseover']);
    d.thumb.dispatchEvent(new d.MouseEvent('mouseover', { bubbles: true }));
    expect(counts.mouseover).toBe(0);
    removeHoverGuard(d.card);
    expect(hasHoverGuard(d.card)).toBe(false);
  });

  it('entrées invalides : pas d\'exception', () => {
    expect(() => addHoverGuard(null)).not.toThrow();
    expect(() => removeHoverGuard(null)).not.toThrow();
    expect(() => removeHoverGuard(d.card)).not.toThrow(); // retrait sans pose préalable
    expect(hasHoverGuard(undefined)).toBe(false);
  });
});
