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
