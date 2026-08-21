/**
 * buildPrefillRequestPayload — filtre les `values` du formulaire avant de les
 * envoyer comme `initialValues` au POST `/api/templates/[id]/prefill`.
 *
 * Bug P6/B.1 (plan 21/08) : `ListingForm` envoyait `values` en entier (toutes
 * les clés du schéma, y compris `field.default` jamais touché par
 * l'utilisateur). Côté serveur, `buildSlotPrefill` traite toute clé non vide
 * de `existingValues` SANS entrée dans `existingProvenance` comme `"manual"`
 * (verrou fort — voir `buildSlotPrefill.ts:165-184`). Résultat : dès le premier
 * changement de compte, des valeurs jamais éditées (defaults, ou simplement
 * posées par un précédent prefill fiche/tournage sans que leur provenance ait
 * été trackée côté client) se retrouvaient gelées `"manual"` — le 2e
 * changement de compte ne re-seedait plus rien depuis la fiche, alors que les
 * médias (résolus séparément) continuaient de changer → « les médias
 * changent mais pas les infos ».
 *
 * Fix : ne transmettre que les clés déjà tracées dans `provenance` — la
 * source de vérité de « cette valeur a une origine connue ». Une clé absente
 * de `provenance` est explicitement laissée à `buildSlotPrefill` pour être
 * (re)résolue depuis la fiche/le tournage avec la précédence normale, plutôt
 * que d'être silencieusement figée `"manual"`.
 *
 * Ne touche PAS `buildSlotPrefill.ts` (contrat legacy documenté) — le filtrage
 * se fait uniquement côté client, avant l'envoi.
 */

import type { ProvenanceMap } from "@/lib/generate/provenance";

/**
 * Retourne le sous-ensemble de `values` dont la clé est présente dans
 * `provenance` (quelle que soit la provenance — "manual" y compris : une
 * édition manuelle DOIT rester "manual" au serveur, pas redevenir un candidat
 * "sans provenance connue" à figer à tort).
 */
export function buildTrackedInitialValues(
  values: Record<string, unknown>,
  provenance: ProvenanceMap,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => provenance[key] !== undefined),
  );
}
