/**
 * Types de fiches système (Phase 5 métaobjet) — source de vérité unique pour
 * les ids seedés, jusque-là codés en dur dans une dizaine de fichiers
 * applicatifs (redirects /biens et /events, HomeVideaste, CreateEntityModal,
 * fallbacks legacy `requiresProperty`…).
 *
 * Ces ids sont posés par le seed et garantis stables : les types portent
 * `isSystem = true` et ne sont pas supprimables. Tout autre EntityType est
 * créé par l'admin avec un cuid, donc jamais comparable à ces constantes.
 */

export const SYSTEM_ENTITY_TYPE_IDS = {
  /** Fiche « Bien » — ex-modèle Property. */
  bien: "etype_bien",
  /** Fiche « Tournage » — ex-modèle ShootEvent. */
  tournage: "etype_tournage",
} as const;

/**
 * Clé du champ « Type de tournage » (RVA / RPOD / Interview) sur le type
 * système « Tournage ». C'est un customField `select`, pas un EntityType :
 * trois types de fiches auraient démultiplié les onglets, les
 * `OrderTemplateItem` et les gardes de `instantiateOrderSlots`.
 *
 * Posé par la migration 20260914120000. Exporté ici pour que le code qui
 * voudra s'y raccrocher (conditionner les recettes d'une commande, filtrer le
 * calendrier) ne réécrive pas la clé à la main.
 */
export const SHOOT_SUBTYPE_FIELD_KEY = "type_tournage";

export type SystemEntityTypeId =
  (typeof SYSTEM_ENTITY_TYPE_IDS)[keyof typeof SYSTEM_ENTITY_TYPE_IDS];

export function isSystemEntityTypeId(id: string | null | undefined): id is SystemEntityTypeId {
  return id === SYSTEM_ENTITY_TYPE_IDS.bien || id === SYSTEM_ENTITY_TYPE_IDS.tournage;
}
