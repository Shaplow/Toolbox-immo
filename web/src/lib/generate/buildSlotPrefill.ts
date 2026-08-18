/**
 * buildSlotPrefill — résout le pré-remplissage du formulaire de génération
 * depuis un `PublicationSlot` : fiche data (Entity), fiche tournage
 * (shootEntity) et overrides mission (`slot.fields`), avec provenance
 * explicite par clé. Extrait du Server Component `/generate/[templateId]`
 * (Phase 3, socle pré-remplissage) pour être partagé avec
 * `POST /api/templates/[id]/prefill` — jusqu'ici seule la fiche data était
 * lue (`entity`), et uniquement côté SSR : la route de prefill rejouée après
 * choix de compte perdait ces valeurs (asymétrie SSR/CSR), et la fiche
 * tournage n'était jamais lue du tout.
 *
 * Ordre de merge (du plus faible au plus fort) :
 *   shootEntityFields < entityFields < slot.fields < existingValues
 *
 * `slot.fields` reçoit la provenance `"manual"` : ce sont des valeurs
 * explicitement saisies sur la mission (override), pas une suggestion — au
 * même titre qu'une saisie manuelle dans le formulaire, elles ne doivent
 * jamais être silencieusement écrasées par la fiche.
 *
 * `existingValues` (listing existant en régénération, ou valeurs de
 * formulaire courantes côté client) est la couche de plus haute précédence.
 * Sa provenance vient de `existingProvenance` quand l'appelant la connaît
 * (ex. `readProvenance` sur un listing existant) ; à défaut, une clé déjà
 * présente est traitée comme `"manual"`.
 *
 * Chaque clé de fiche (`entityFields`/`shootEntityFields`) est d'abord
 * confrontée à `schema` (voir `matchFieldValue` — fallback case-insensitive +
 * normalisation des options `select`) : une clé de fiche « Prix » remplit
 * ainsi un champ de template « prix ». Une clé sans champ correspondant dans
 * `schema` est conservée sous sa propre clé — c'est elle que
 * `customFormFields` expose comme champ à part entière dans le formulaire.
 */

import { prisma } from "@/lib/prisma";
import { normalizeCustomFields, type CustomField } from "@/lib/customFields";
import type { SchemaField } from "@/types/template";
import { isEmptyValue, type ProvenanceMap, type ValueProvenance } from "@/lib/generate/provenance";
import { buildLowerKeyMap, canAssignFieldValue, matchFieldValue } from "@/lib/generate/matchFieldValue";

/** Forme du slot attendue par `buildSlotPrefill` — un seul select Prisma étendu. */
export interface SlotPrefillRecord {
  accountId: string | null;
  fields: string;
  title: string | null;
  account: { handle: string } | null;
  entity: { fields: string; type: { fieldSchema: string } } | null;
  shootEntity: { fields: string; type: { fieldSchema: string } } | null;
}

export interface BuildSlotPrefillArgs {
  /** Ignoré quand `slot` est fourni. */
  slotId?: string | null;
  /** Slot déjà chargé (tests, ou appelant qui l'a en main) — évite une requête. */
  slot?: SlotPrefillRecord | null;
  /** Schéma cible pour le matching des clés de fiche (voir `matchFieldValue`) —
   *  typiquement le schéma du template AVANT fusion de `customFormFields`. */
  schema: SchemaField[];
  /** Valeurs déjà connues — couche de plus haute précédence (listing existant
   *  en régénération, ou valeurs de formulaire côté client au changement de compte). */
  existingValues?: Record<string, unknown>;
  /** Provenance déjà connue pour `existingValues` (ex. `readProvenance` sur un
   *  listing existant). Toute clé de `existingValues` sans entrée ici est
   *  traitée comme `"manual"`. */
  existingProvenance?: ProvenanceMap;
}

export interface BuildSlotPrefillResult {
  entityFields: Record<string, string>;
  shootEntityFields: Record<string, string>;
  /** Fusion des `fieldSchema` des deux types de fiche — l'entity l'emporte sur collision de clé. */
  customFormFields: CustomField[];
  initialValues: Record<string, unknown>;
  provenance: ProvenanceMap;
  accountId: string | undefined;
  slotBannerContext: { title: string | null; handle: string } | null;
}

function parseFieldsJson(raw: string | undefined | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * Applique une couche de champs bruts (clés arbitraires) sur `values`/`provenance`,
 * mutés en place. Les clés matchant un champ de `schema` (voir `matchFieldValue`)
 * sont posées sous la clé canonique du schéma ; les autres sous leur propre clé.
 */
function applyFieldsLayer(
  rawFields: Record<string, string>,
  schema: SchemaField[],
  layerProvenance: ValueProvenance,
  values: Record<string, unknown>,
  provenance: ProvenanceMap,
): void {
  const lowerMap = buildLowerKeyMap(rawFields);
  const matchedLowerKeys = new Set<string>();

  for (const field of schema) {
    const matched = matchFieldValue(field, rawFields, lowerMap);
    if (matched === undefined) continue;
    matchedLowerKeys.add(field.key.toLowerCase());
    if (!canAssignFieldValue(values[field.key], provenance[field.key], layerProvenance)) continue;
    values[field.key] = matched;
    provenance[field.key] = layerProvenance;
  }

  for (const [rawKey, rawValue] of Object.entries(rawFields)) {
    if (isEmptyValue(rawValue)) continue;
    if (matchedLowerKeys.has(rawKey.toLowerCase())) continue;
    if (!canAssignFieldValue(values[rawKey], provenance[rawKey], layerProvenance)) continue;
    values[rawKey] = rawValue;
    provenance[rawKey] = layerProvenance;
  }
}

export async function buildSlotPrefill({
  slotId,
  slot: slotIn,
  schema,
  existingValues,
  existingProvenance,
}: BuildSlotPrefillArgs): Promise<BuildSlotPrefillResult> {
  let slot: SlotPrefillRecord | null = null;
  if (slotIn !== undefined) {
    slot = slotIn;
  } else if (slotId) {
    slot = await prisma.publicationSlot.findFirst({
      where: { id: slotId },
      select: {
        accountId: true,
        fields: true,
        title: true,
        account: { select: { handle: true } },
        entity: { select: { fields: true, type: { select: { fieldSchema: true } } } },
        shootEntity: { select: { fields: true, type: { select: { fieldSchema: true } } } },
      },
    });
  }

  const entityFields = parseFieldsJson(slot?.entity?.fields);
  const shootEntityFields = parseFieldsJson(slot?.shootEntity?.fields);
  const slotFields = parseFieldsJson(slot?.fields);

  const customFormFieldsMap = new Map<string, CustomField>();
  for (const cf of normalizeCustomFields(slot?.shootEntity?.type.fieldSchema)) {
    customFormFieldsMap.set(cf.key, cf);
  }
  for (const cf of normalizeCustomFields(slot?.entity?.type.fieldSchema)) {
    customFormFieldsMap.set(cf.key, cf); // entity l'emporte sur shootEntity en cas de collision
  }
  const customFormFields = [...customFormFieldsMap.values()];

  const values: Record<string, unknown> = {};
  const provenance: ProvenanceMap = {};

  applyFieldsLayer(shootEntityFields, schema, "shootEntity", values, provenance);
  applyFieldsLayer(entityFields, schema, "entity", values, provenance);
  applyFieldsLayer(slotFields, schema, "manual", values, provenance);

  for (const [key, value] of Object.entries(existingValues ?? {})) {
    if (isEmptyValue(value)) continue;
    const trackedProvenance = existingProvenance?.[key];
    if (trackedProvenance !== undefined) {
      // Provenance connue (ex. lue via `readProvenance` sur un listing
      // existant) : ne l'emporte que si `canOverride` l'autorise — une valeur
      // de listing figée en "dataEntry" ne doit pas primer sur une fiche
      // re-résolue fraîchement ("entity").
      if (!canAssignFieldValue(values[key], provenance[key], trackedProvenance)) continue;
      values[key] = value;
      provenance[key] = trackedProvenance;
      continue;
    }
    // Couche de plus haute précédence sans provenance connue (listing
    // legacy antérieur à `__provenance`, ou valeurs de formulaire courantes
    // côté client) : gagne toujours, conformément à l'ordre de merge
    // shootEntityFields < entityFields < slot.fields < existingValues.
    values[key] = value;
    provenance[key] = "manual";
  }

  return {
    entityFields,
    shootEntityFields,
    customFormFields,
    initialValues: values,
    provenance,
    accountId: slot?.accountId ?? undefined,
    slotBannerContext: slot ? { title: slot.title, handle: slot.account?.handle ?? "Sans compte" } : null,
  };
}
