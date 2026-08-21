/**
 * validateManualAssetSelection — re-validation serveur d'un asset choisi
 * manuellement dans le picker « Changer » avant de le retenir dans un Render
 * (A.9, P5 hardening).
 *
 * Avant ce fix, `POST /api/renders` vérifiait seulement que l'ID d'asset
 * référencé EXISTE en base (`prisma.mediaAsset.findMany({ id: { in: ids } })`)
 * — un payload trafiqué (ou un picker resté ouvert sur un contexte obsolète,
 * cf. A.1) pouvait donc faire passer un asset désactivé (`disabled: true`),
 * appartenant à une AUTRE bibliothèque que celle du bloc, ou restreint à un
 * autre compte Instagram (`MediaAssetAccess`).
 *
 * Mirror sémantique de `buildAccessFilter` (contentLibraryResolver.ts) pour la
 * partie accès — mêmes règles, exprimées ici sur des lignes déjà chargées
 * plutôt qu'en SQL : compte fourni → accessible si aucune restriction OU une
 * restriction pour CE compte ; compte absent → accessible seulement si aucune
 * restriction.
 */

export interface ManualAssetRow {
  id: string;
  libraryId: string;
  disabled: boolean;
  /** IDs des comptes ayant une ligne `MediaAssetAccess` pour cet asset — vide = public (pas de restriction). */
  accessAccountIds: string[];
}

/**
 * Retourne un message d'erreur FR (à afficher tel quel) si la sélection est
 * invalide, ou `null` si elle est valide.
 *
 * @param row                Ligne DB de l'asset choisi, ou `undefined` si introuvable.
 * @param expectedLibraryId  Bibliothèque attendue pour ce bloc/slot — `undefined` si le
 *                           bloc/slot n'a pas pu être résolu côté serveur (ex. clé de
 *                           `usedAssets` sans correspondance dans le template) : dans ce
 *                           cas l'appartenance n'est pas vérifiable, seuls disabled/accès
 *                           le sont encore (permissif, pas de faux-positif sur un mapping inconnu).
 * @param accountId          Compte Instagram validé de la génération, ou `undefined`.
 */
export function validateManualAssetSelection(
  row: ManualAssetRow | undefined,
  expectedLibraryId: string | undefined,
  accountId: string | undefined,
): string | null {
  if (!row) return "asset introuvable.";
  if (expectedLibraryId && row.libraryId !== expectedLibraryId) {
    return "n'appartient pas à la bibliothèque attendue par ce bloc.";
  }
  if (row.disabled) {
    return "cet asset est désactivé.";
  }
  if (row.accessAccountIds.length > 0) {
    if (!accountId || !row.accessAccountIds.includes(accountId)) {
      return "cet asset n'est pas accessible pour ce compte.";
    }
  }
  return null;
}
