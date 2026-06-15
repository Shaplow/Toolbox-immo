/**
 * Sentinels accountId pour les rotations "shared" — quand une library est en
 * scope `shared`, son cursor (et ses lignes d'usage) sont keyed par une valeur
 * sentinelle plutôt que par un vrai accountId, ce qui permet à tous les
 * comptes de tourner sur le même cursor global.
 *
 * Source unique : ce fichier. Avant la consolidation, les 2 sentinelles
 * étaient déclarées 1700 lignes l'une de l'autre dans contentLibraryResolver.ts —
 * un typo dans un raw SQL aurait routé vers un cursor inexistant sans erreur.
 */
export const SHARED_CURSOR_ACCOUNT_ID = "__shared__";
export const SHARED_DATA_CURSOR_ACCOUNT_ID = "__shared__data__";

export const ROTATION_SENTINELS = {
  SHARED_MEDIA: SHARED_CURSOR_ACCOUNT_ID,
  SHARED_DATA: SHARED_DATA_CURSOR_ACCOUNT_ID,
} as const;

/**
 * Liste prête à brancher sur `where: { id: { notIn: SHARED_SENTINEL_IDS } }`
 * dans toute query Prisma `instagramAccount.findMany` qui ne doit pas exposer
 * les comptes virtuels (listings admin, pickers UI, search palette…).
 */
export const SHARED_SENTINEL_IDS: readonly string[] = [
  SHARED_CURSOR_ACCOUNT_ID,
  SHARED_DATA_CURSOR_ACCOUNT_ID,
];

export function isSharedSentinel(accountId: string): boolean {
  return accountId === SHARED_CURSOR_ACCOUNT_ID || accountId === SHARED_DATA_CURSOR_ACCOUNT_ID;
}
