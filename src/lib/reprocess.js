// Décision pure de re-traitement d'une carte YouTube quand une mutation childList
// touche son sous-arbre (YouTube peuple ou recycle un titre via remplacement de
// nœuds, pas via characterData). Aucune manipulation DOM ici : le câblage vit
// dans content.js. Sorties :
//   'ignore'  → ne rien faire (notre propre écriture, carte stable, ou carte
//               révélée dont la vidéo n'a pas changé)
//   'reset'   → carte recyclée pour une AUTRE vidéo : tout réinitialiser puis retraiter
//   'process' → carte encore jamais traitée : la traiter
//
// `safeTitle` est la signature mémorisée pour une carte déjà traitée :
//   - carte voilée → le titre neutre injecté (dataset.spoilguardSafe / sig)
//   - carte clean  → son titre d'origine inchangé
// Comparer le titre courant à cette signature distingue notre écriture / un état
// stable (identique) d'un vrai recyclage YouTube (différent).
export function decideReprocess({ isProcessed, currentTitle, safeTitle, revealed, revealedTitle }) {
  const current = (currentTitle ?? '').trim();

  // Une carte révélée par l'utilisateur reste révélée tant que YouTube ne l'a pas
  // recyclée pour une autre vidéo. Ce cas prime sur tout le reste (même une
  // signature voilée résiduelle) : on compare au titre mémorisé à la révélation.
  if (revealed) {
    return current === (revealedTitle ?? '').trim() ? 'ignore' : 'reset';
  }

  // Jamais traitée → laisser processCard décider (voile / clean / carte pas encore peuplée).
  if (!isProcessed) return 'process';

  // Déjà traitée : signature identique = état stable (dont notre propre écriture
  // childList-silencieuse) ; différente = carte recyclée → repartir de zéro.
  return current === (safeTitle ?? '').trim() ? 'ignore' : 'reset';
}
