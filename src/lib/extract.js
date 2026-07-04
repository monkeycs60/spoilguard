// Extraction des infos d'une carte vidéo YouTube.
// Sélecteurs calés sur les fixtures DOM réelles (juillet 2026) — voir tests/fixtures/.
// Trois familles de markup coexistent :
//   - ytd-video-renderer / ytd-compact-video-renderer  → Polymer classique (#video-title, ytd-channel-name)
//   - yt-lockup-view-model (grille + sidebar 2026)      → view-model (.ytLockupMetadataViewModel*, .ytContentMetadataViewModel*)
//   - ytd-rich-item-renderer                            → wrapper qui contient un yt-lockup-view-model

export const CARD_SELECTOR = [
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'yt-lockup-view-model',
].join(',');

const AGE_RE = /il y a|ago/i;
// Textes de métadonnée à écarter quand on cherche le nom de chaîne (vues, âge, spectateurs).
const NON_CHANNEL_RE = /vues|views|il y a|ago|visionnage|watching|regardent|spectateur/i;

// textContent peut contenir des doublons/whitespace (ex: "Eurosport France\n Eurosport France").
// On garde la première ligne non vide, trimée.
function normalizeChannel(raw) {
  return (raw || '')
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean) || '';
}

function extractVideoId(card) {
  const link = card.querySelector('a[href*="watch?v="], a[href*="/shorts/"]');
  const href = link?.getAttribute('href') || '';
  const m = href.match(/[?&]v=([\w-]{11})/) || href.match(/shorts\/([\w-]{11})/);
  return m ? m[1] : null;
}

function extractChannel(card) {
  // 1) Markup Polymer classique : le nom vit dans ytd-channel-name #text.
  const cn = card.querySelector('ytd-channel-name #text');
  if (cn && cn.textContent.trim()) return normalizeChannel(cn.textContent);

  // 2) view-model (lockup) : le nom de chaîne, quand il existe, est un texte de
  //    métadonnée qui n'est ni une ligne de vues/âge ni un badge. Absent sur les
  //    grilles de chaîne (rich-item) → on retourne '' légitimement.
  const texts = card.querySelectorAll('.ytContentMetadataViewModelMetadataText');
  for (const t of texts) {
    const s = t.textContent.trim();
    if (s && !NON_CHANNEL_RE.test(s)) return normalizeChannel(t.textContent);
  }
  return '';
}

function extractTitleEl(card) {
  return card.querySelector('#video-title, .ytLockupMetadataViewModelTitle');
}

function extractAgeText(card) {
  const candidates = card.querySelectorAll(
    '#metadata-line span, .ytContentMetadataViewModelMetadataText',
  );
  for (const el of candidates) {
    if (AGE_RE.test(el.textContent)) {
      const t = el.textContent.trim();
      // Jamais de chaîne blanche : un texte vide/espaces-seulement → null.
      return t || null;
    }
  }
  return null;
}

export function extractCard(card) {
  const titleEl = extractTitleEl(card);
  return {
    videoId: extractVideoId(card),
    title: titleEl?.textContent.trim() || '',
    channel: extractChannel(card),
    ageText: extractAgeText(card),
    titleEl,
  };
}
