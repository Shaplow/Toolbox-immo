/**
 * Références stables des fichiers d'un lien d'export.
 *
 *   média       `m.<assetId>.<accountId|c>`
 *   données     `d.<libraryId>.<accountId|c>`
 *   publication `p.<slotId>`
 *
 * Le navigateur du client renvoie ces refs à /api/export/[token]/urls pour
 * obtenir une URL signée. Une ref n'est JAMAIS parsée côté serveur : elle n'est
 * signée que si elle figure telle quelle dans le manifeste du lien (table
 * ref → élément, cf. services/clientExport/exportManifest.ts). C'est toute la
 * garde anti-IDOR ; le format sert seulement à rester stable et sans collision
 * (aucun id ne contient de point).
 *
 * Pur : aucun import serveur (ce module est aussi chargé dans le navigateur).
 */

/**
 * Marque « Commun » (aucun compte) à la place d'un accountId. Un cuid fait 25
 * caractères : aucun compte réel ne peut s'appeler « c ».
 */
export const COMMON_ACCOUNT_REF = "c";

export function mediaRef(assetId: string, accountId: string | null): string {
  return `m.${assetId}.${accountId ?? COMMON_ACCOUNT_REF}`;
}

export function dataRef(libraryId: string, accountId: string | null): string {
  return `d.${libraryId}.${accountId ?? COMMON_ACCOUNT_REF}`;
}

export function publicationRef(slotId: string): string {
  return `p.${slotId}`;
}
