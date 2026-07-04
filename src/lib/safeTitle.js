export function buildLocalSafeTitle(pack, ageText) {
  const suffix = ageText ? `vidéo (${ageText.trim()})` : 'vidéo récente';
  return `🛡️ ${pack.emoji} ${pack.label} – ${suffix}`;
}
