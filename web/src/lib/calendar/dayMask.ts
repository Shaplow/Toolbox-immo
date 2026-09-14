/**
 * Le masque « ce compte ne publie pas ce jour-là » — pur, sans React ni Prisma.
 *
 * Le besoin : « parfois j'ai des comptes qui n'ont pas de contenu certains jours
 * et d'autres oui ». Le périmètre d'un remplissage n'est donc PAS le produit
 * cartésien comptes × jours : il a des trous, creusés à la main.
 *
 * On stocke les EXCLUSIONS, jamais les jours retenus. Quatre conséquences, et
 * c'est ce qui rend ce choix meilleur qu'une liste positive :
 *  - `{}` = aucun masque = l'état d'ouverture, sans rien construire depuis les
 *    comptes ni les jours (donc rien qui puisse se désynchroniser d'eux) ;
 *  - un compte coché après coup n'a rien à initialiser : clé absente = tout allumé ;
 *  - ajouter samedi aux jours retenus ne rallume jamais un jour éteint à l'insu
 *    de l'admin, et n'oblige à réécrire aucune entrée ;
 *  - décocher puis recocher un compte conserve son masque, sans une ligne de code.
 *
 * Les jours sont des OFFSETS relatifs au début de la semaine affichée, jamais
 * « lundi = 1 » : la semaine du calendrier peut commencer un dimanche, et un
 * masque en jours ISO dériverait en silence.
 */

/** `accountId` → offsets éteints. Une clé absente signifie « tous les jours ». */
export type DayMask = Record<string, number[]>;

export function isDayActive(mask: DayMask, accountId: string, offset: number): boolean {
  return !(mask[accountId] ?? []).includes(offset);
}

/**
 * La charge de chaque jour retenu : combien de publications y naîtraient.
 *
 * Sert aux deux bornes affichées par l'écran (globale et par famille) — c'est la
 * même arithmétique sur deux périmètres de comptes, d'où la fonction partagée.
 */
export function publicationsByDay(
  dayOffsets: number[],
  accountIds: string[],
  mask: DayMask,
  perDay: number,
): number[] {
  return [...dayOffsets]
    .sort((a, b) => a - b)
    .map(
      (offset) => accountIds.filter((id) => isDayActive(mask, id, offset)).length * perDay,
    );
}
