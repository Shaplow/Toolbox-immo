/**
 * enrichListingWithEntityFields — injection déclarative des champs de fiche
 * (Entity) dans listingData, résolue AU RENDU. Miroir de
 * `enrichListingWithAssetMetadata` (métadonnées d'asset) mais pour les
 * fiches data/tournage rattachées au `PublicationSlot` du render : ce patron
 * remplace la coïncidence implicite de nom de clé, figée au submit, par une
 * source déclarée dans le template et rejouée à chaque rendu.
 *
 * Contrat de provenance partagé : `@/lib/generate/provenance.ts`. Ce module
 * LIT la map (`readProvenance`) — il ne l'écrit jamais ; le formulaire de
 * génération est seul responsable de sa mise à jour au submit.
 *
 * Règles, dans l'ordre (la première qui s'applique gagne) :
 *   1. `entitySource` déclaré explicitement sur le SchemaField → TOUJOURS
 *      re-résolu live depuis la fiche désignée, SAUF si la provenance de la
 *      clé est `"manual"`.
 *   2. Pas de `entitySource`, mais provenance `"entity"`/`"shootEntity"`
 *      (`isLiveResolved`) → re-résolue live par son propre nom de clé (la
 *      fiche a pu être éditée ou re-rattachée depuis le submit).
 *   3. Sinon, clé VIDE dans listingData qui matche implicitement par nom
 *      dans les champs de la fiche → remplie. Précédence fiche data > fiche
 *      tournage.
 *   4. Une clé de provenance `"manual"` n'est JAMAIS touchée, quelle que
 *      soit la règle qui s'appliquerait sinon.
 */

import { prisma } from "@/lib/prisma";
import type { ListingData } from "@/types/listing";
import type { SchemaField } from "@/types/template";
import { isEmptyValue, isLiveResolved, readProvenance } from "@/lib/generate/provenance";

export interface RenderEntityContext {
  /** Champs de la fiche data (`slot.entity`), parsés — `null` si aucune fiche data rattachée. */
  entityFields: Record<string, string> | null;
  /** Champs de la fiche tournage (`slot.shootEntity`), parsés — `null` si aucune fiche rattachée. */
  shootEntityFields: Record<string, string> | null;
}

function parseEntityFieldsJson(raw: string | null | undefined): Record<string, string> | null {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return null;
  }
}

/**
 * Charge le contexte fiche d'un render depuis son `publicationSlotId`.
 * NO-OP strict (aucune requête DB) quand `publicationSlotId` est absent —
 * cas majoritaire (render one-off, hors pipeline slot).
 */
export async function loadRenderEntityContext(
  publicationSlotId: string | null | undefined,
): Promise<RenderEntityContext | null> {
  if (!publicationSlotId) return null;
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: publicationSlotId },
    select: {
      entity: { select: { fields: true } },
      shootEntity: { select: { fields: true } },
    },
  });
  if (!slot) return null;
  return {
    entityFields: slot.entity ? parseEntityFieldsJson(slot.entity.fields) : null,
    shootEntityFields: slot.shootEntity ? parseEntityFieldsJson(slot.shootEntity.fields) : null,
  };
}

/**
 * Enrichit `listingData` avec les valeurs live de la fiche rattachée au
 * render, pour chaque `SchemaField` du template. Retourne une copie
 * superficielle ; l'original n'est jamais muté. `entityContext: null` (pas
 * de slot, ou slot sans aucune fiche rattachée) → no-op, `listingData`
 * renvoyée telle quelle.
 */
export function enrichListingWithEntityFields(
  listingData: ListingData,
  schema: SchemaField[],
  entityContext: RenderEntityContext | null,
): ListingData {
  if (!entityContext || (!entityContext.entityFields && !entityContext.shootEntityFields)) {
    return listingData;
  }
  const { entityFields, shootEntityFields } = entityContext;
  const provenanceMap = readProvenance(listingData);
  const data = listingData as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  for (const field of schema) {
    const provenance = provenanceMap[field.key];
    if (provenance === "manual") continue; // règle 4 — jamais touché, prime sur tout le reste

    if (field.entitySource) {
      // Règle 1 — source déclarée explicitement : toujours re-résolue live.
      const source = field.entitySource.slot === "data" ? entityFields : shootEntityFields;
      const liveValue = source ? source[field.entitySource.fieldKey] : undefined;
      if (liveValue !== undefined) patch[field.key] = liveValue;
      continue;
    }

    if (isLiveResolved(provenance)) {
      // Règle 2 — provenance déjà "entity"/"shootEntity" sans entitySource
      // déclaré sur ce champ : re-résolue live par son propre nom de clé.
      const source = provenance === "entity" ? entityFields : shootEntityFields;
      const liveValue = source ? source[field.key] : undefined;
      if (liveValue !== undefined) patch[field.key] = liveValue;
      continue;
    }

    // Règle 3 — match implicite par nom, seulement si la valeur courante
    // est vide. Précédence fiche data > fiche tournage.
    if (!isEmptyValue(data[field.key])) continue;
    const fromEntity = entityFields?.[field.key];
    if (fromEntity !== undefined && !isEmptyValue(fromEntity)) {
      patch[field.key] = fromEntity;
      continue;
    }
    const fromShoot = shootEntityFields?.[field.key];
    if (fromShoot !== undefined && !isEmptyValue(fromShoot)) {
      patch[field.key] = fromShoot;
    }
  }

  return Object.keys(patch).length > 0 ? ({ ...listingData, ...patch } as ListingData) : listingData;
}
