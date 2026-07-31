/**
 * Statuts de slot où la validation client a été passée OU n'est plus pertinente.
 *
 * Utilisée par les triggers auto (cover, description) et les sections UI pour
 * gater l'action sur `needsClientValidation` : si le slot est encore en attente
 * du client, on diffère ; sinon on peut se lancer.
 *
 * - SCHEDULED → post-approve client OK (magic link ou bypass admin)
 * - PUBLISHED → déjà publié (idempotence)
 * - CANCELLED → annulé, pas la peine de générer
 * - ARCHIVED  → archivé, idem
 * - DONE      → statut legacy terminal (Phase 1.2 backfill incomplet)
 *
 * Avant Phase 1.x : redéfinie 5 fois localement avec des membres divergents
 * (certains avaient DONE, d'autres CANCELLED+ARCHIVED). Cette divergence
 * causait deux bugs concrets :
 *   - description auto se déclenchait sur des slots déjà annulés
 *   - cover skip vs steps step "cover" affichait des états contradictoires
 */
export const POST_VALIDATION_STATUSES: ReadonlySet<string> = new Set([
  "SCHEDULED",
  "PUBLISHED",
  "CANCELLED",
  "ARCHIVED",
  "DONE",
]);

/**
 * Statuts depuis lesquels un slot peut être marqué publié EN LOT.
 *
 * Ce sont les seuls que STATUS_TRANSITIONS autorise à passer à PUBLISHED, soit
 * les créneaux dont la vidéo est validée. Le filtre doit être explicite : côté
 * serveur `canTransition` renvoie toujours true pour un ADMIN et ne filtrerait
 * rien, or un lot ne doit pas emporter des créneaux encore en production.
 *
 * Vit ici (et non dans transitions.ts, qui importe Prisma) pour être lisible
 * par le calendrier côté client comme par le service. Un test verrouille sa
 * cohérence avec STATUS_TRANSITIONS.
 */
export const BULK_PUBLISHABLE_STATUSES: ReadonlySet<string> = new Set([
  "READY_FOR_CM",
  "SCHEDULED",
]);
