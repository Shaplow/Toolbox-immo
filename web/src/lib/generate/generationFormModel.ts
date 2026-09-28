/**
 * generationFormModel — modèle de formulaire de génération partagé entre
 * `/generate/[templateId]/page.tsx` (une publication) et `bulkRenderService`
 * (plan « lancer les rendus depuis le calendrier », étape 4 : garantie de
 * parité).
 *
 * `buildGenerationFormModel` reprend TEL QUEL l'enchaînement qui vivait dans
 * le Server Component (buildMergedSchema → buildSlotPrefill →
 * customFormFields → relaxation vidéos metadata-driven → ig_account →
 * buildLibraryPrefillContext → finalSchema auto-mode → templateNeedsAccount),
 * pour que le lot fasse EXACTEMENT ce que ferait le formulaire lancé une
 * publication après l'autre (principe directeur du plan).
 *
 * `projectFormValues` reproduit ce que `ListingForm` construit à l'init
 * (`values`, `provenance`) puis envoie dans `handleGenerate` — c'est ce que
 * `bulkRenderService` pose dans `Listing.jsonData` au lancement. La
 * précédence est garantie PAR CONSTRUCTION : `initFieldProvenance` est la
 * même fonction que `ListingForm` utilise pour son état initial (voir
 * `ListingForm.tsx`, useState `provenance`).
 *
 * Contrat dur : ne mute JAMAIS `args.json` — un appelant (le service de lot)
 * peut réutiliser un même `JSON.parse` mis en cache entre plusieurs
 * publications. La relaxation des champs vidéo metadata-driven CLONE le
 * champ visé (`{ ...field, required: false }`) au lieu de le muter en place —
 * `buildMergedSchema` renvoie un tableau frais, mais dont les éléments sont
 * les MÊMES références que `json.schema`/`DPE_AUTO_FIELDS`.
 */

import { prisma } from "@/lib/prisma";
import { buildMergedSchema } from "@/lib/generate/buildMergedSchema";
import { buildSlotPrefill } from "@/lib/generate/buildSlotPrefill";
import { buildLibraryPrefillContext } from "@/lib/generate/buildLibraryPrefillContext";
import { customFieldToSchemaField } from "@/lib/customFields";
import { canOverride, isEmptyValue, type ProvenanceMap } from "@/lib/generate/provenance";
import type { BatchUsageView } from "@/lib/rotation/batchUsage";
import type { LibraryPrefill } from "@/lib/contentLibraryResolver";
import type { LibraryPrefillContext } from "@/types/libraryPrefill";
import type { SchemaField, TemplateJSON, VideoBlock } from "@/types/template";

/** Vrai si le template lie au moins un bloc (vidéo ou musique) ou une DataLibrary.
 *  Déplacé depuis `app/(app)/generate/[templateId]/page.tsx` (inchangé). */
export function templateUsesLibrary(json: TemplateJSON): boolean {
  return (
    json.blocks.some((b) => (b.type === "video" || b.type === "music") && !!(b as { libraryId?: string }).libraryId) ||
    (json.videoSequence ?? []).some((s) => !!(s as { libraryId?: string }).libraryId) ||
    !!json.contentLibrary?.dataLibraryId ||
    !!json.contentLibrary?.dataCampaignId
  );
}

/** Déplacé depuis `ListingForm.tsx` (logique inchangée) — valeur affichée à
 *  l'init d'un champ : la valeur pré-remplie prime, sinon le default du
 *  schéma, sinon une chaîne vide. */
export function resolveInitialFieldValue(field: SchemaField, initialValue: unknown): unknown {
  if (initialValue !== undefined && initialValue !== null) return initialValue;
  if (field.default !== undefined && field.default !== null) return field.default;
  return "";
}

/**
 * Provenance initiale d'un formulaire — extrait de `ListingForm` (useState
 * `provenance`, ~95-103) pour être réutilisé PAR `projectFormValues` : les
 * deux doivent calculer exactement la même chose à partir des mêmes entrées,
 * donc l'un des deux appelle l'autre plutôt que de dupliquer la boucle.
 *
 * Part de `initialProvenance` (posé côté serveur — fiche, mission, DataEntry)
 * puis étend aux champs `metadataSource` (résolus depuis un asset au submit)
 * qui n'ont pas déjà une provenance plus forte.
 */
export function initFieldProvenance(
  schema: SchemaField[],
  initialProvenance: ProvenanceMap | undefined,
): ProvenanceMap {
  const base: ProvenanceMap = { ...(initialProvenance ?? {}) };
  for (const field of schema) {
    if (!field.metadataSource) continue;
    if (!canOverride(base[field.key], "assetMetadata")) continue;
    base[field.key] = "assetMetadata";
  }
  return base;
}

/**
 * Garde-fou RVA4 : select `metadata-values-from-library` encore vide après
 * pré-remplissage (choix du bien requis). Signal structurel — voir le plan,
 * section « Faits établis ».
 */
export function findEmptyMetadataDrivenSelects(
  schema: SchemaField[],
  values: Record<string, unknown>,
): SchemaField[] {
  return schema.filter(
    (f) =>
      f.type === "select" &&
      f.optionsSource?.type === "metadata-values-from-library" &&
      isEmptyValue(values[f.key]),
  );
}

export interface GenerationFormModel {
  json: TemplateJSON;
  mergedSchema: SchemaField[];
  finalSchema: SchemaField[];
  initialValues: Record<string, unknown>;
  provenance: ProvenanceMap;
  context: LibraryPrefillContext | undefined;
  accountId: string | null;
  templateNeedsAccount: boolean;
  /** Tirage en lot — propagé depuis `buildLibraryPrefillContext`. */
  usageKeyByPick?: Record<string, { libraryId: string; usageKey: string | null }>;
  /**
   * Pick de musique SANS binding — propagé depuis `buildLibraryPrefillContext`
   * (`unboundAudioSuggestion`). `undefined` hors du cas unbound, `null` si le
   * résolveur n'a rien trouvé. Voir le commentaire de `BuildResult` pour le
   * pourquoi : ce pick n'a aucun champ de formulaire, donc n'apparaît jamais
   * dans `initialSuggestions`.
   */
  unboundAudioSuggestion?: { id: string; url: string; filename: string } | null;
  /** Plancher de durée du pick musique (bound ou non) — voir `LibraryPrefill.audioMinDuration`. */
  audioMinDuration?: number;
  /** Bandeau « pré-rempli depuis slot X » — `page.tsx` en a besoin pour son bandeau. */
  slotBannerContext: { title: string | null; handle: string } | null;
}

export interface BuildGenerationFormModelArgs {
  json: TemplateJSON;
  slotId: string | null;
  accountId: string | null;
  listingId?: string | null;
  existingValues?: Record<string, unknown>;
  existingProvenance?: ProvenanceMap;
  forceRedraw?: boolean;
  batchUsage?: BatchUsageView;
  resolvedPrefill?: LibraryPrefill;
}

export async function buildGenerationFormModel({
  json,
  slotId,
  accountId: accountIdIn,
  listingId = null,
  existingValues,
  existingProvenance,
  forceRedraw = false,
  batchUsage,
  resolvedPrefill,
}: BuildGenerationFormModelArgs): Promise<GenerationFormModel> {
  // `accountId` explicite (query param / arg appelant) prime ; sinon on
  // retombe sur celui du slot — même résolution que le Server Component.
  let accountId: string | null = accountIdIn;

  const mergedSchema = buildMergedSchema(json);

  // Phase 5 (métaobjet) + Phase 3 (socle prefill) — fiche data (Entity),
  // fiche tournage (shootEntity) et overrides mission (slot.fields).
  const slotPrefill = await buildSlotPrefill({
    slotId,
    schema: mergedSchema,
    existingValues,
    existingProvenance,
  });
  if (!accountId) accountId = slotPrefill.accountId ?? null;
  let initialValues: Record<string, unknown> = slotPrefill.initialValues;
  let provenance: ProvenanceMap = slotPrefill.provenance;

  // Phase 4 — fusionne les champs perso typés de la fiche absents du template
  // (le template reste prioritaire sur conflit de clé).
  for (const cf of slotPrefill.customFormFields) {
    if (!mergedSchema.some((f) => f.key === cf.key)) {
      mergedSchema.push(customFieldToSchemaField(cf));
    }
  }

  // For video fields that will be auto-resolved from a metadata-values-from-library
  // select field at render time, remove the required constraint. The video is
  // always resolved server-side from the linked select field value; blocking
  // the form when the field is empty would be incorrect.
  //
  // CLONE le champ visé plutôt que de le muter en place : `mergedSchema`
  // porte les MÊMES références que `json.schema` (buildMergedSchema ne copie
  // pas les champs eux-mêmes) — muter `.required` mutait donc directement
  // l'objet du `json` appelant, ce qui fuitait vers toute autre publication
  // réutilisant le même parse en cache.
  for (const slot of json.videoSequence ?? []) {
    if (!slot.videoBlockId) continue;
    const isMetadataDriven = json.schema.some(
      (f) =>
        f.type === "select" &&
        f.optionsSource?.type === "metadata-values-from-library" &&
        f.optionsSource.blockId === slot.videoBlockId,
    );
    if (!isMetadataDriven) continue;
    const linkedBlock = json.blocks.find(
      (b) => b.type === "video" && b.id === slot.videoBlockId,
    ) as VideoBlock | undefined;
    if (!linkedBlock?.binding) continue;
    const idx = mergedSchema.findIndex((f) => f.key === linkedBlock!.binding);
    if (idx !== -1 && mergedSchema[idx].required) {
      mergedSchema[idx] = { ...mergedSchema[idx], required: false };
    }
  }

  // ─── Resolve ig_account handle BEFORE library prefill ────────────────────
  if (accountId && !initialValues.ig_account) {
    const hasIgField = json.schema.some((f) => f.key === "ig_account");
    if (hasIgField) {
      const igAccount = await prisma.instagramAccount.findUnique({
        where: { id: accountId },
        select: { handle: true },
      });
      if (igAccount) initialValues = { ...initialValues, ig_account: igAccount.handle };
    }
  }

  const templateNeedsAccount = templateUsesLibrary(json) && !accountId;

  let context: LibraryPrefillContext | undefined;
  let usageKeyByPick: GenerationFormModel["usageKeyByPick"];
  let unboundAudioSuggestion: GenerationFormModel["unboundAudioSuggestion"];
  let audioMinDuration: GenerationFormModel["audioMinDuration"];
  if (!templateNeedsAccount) {
    const result = await buildLibraryPrefillContext({
      json,
      mergedSchema,
      initialValues,
      accountId: accountId ?? null,
      slotId: slotId ?? null,
      listingId: listingId ?? null,
      provenance,
      forceRedraw,
      batchUsage,
      resolvedPrefill,
    });
    context = result.context;
    initialValues = result.updatedInitialValues ?? initialValues;
    usageKeyByPick = result.usageKeyByPick;
    unboundAudioSuggestion = result.unboundAudioSuggestion;
    audioMinDuration = result.audioMinDuration;
    // La boucle DataEntry étend `provenance` (dataEntry) — c'est la map
    // complète qui part au client, pas seulement les couches fiche/mission.
    if (context) provenance = context.prefilledKeys;
  }

  // For "auto" mode: filter out video schema fields covered by videoSequence
  // libraryId slots.
  const autoMode = json.generationMode === "auto";
  const sequenceManualSlotBindings = new Set(
    (json.videoSequence ?? [])
      .filter((s) => s.binding && !s.libraryId) // explicit binding, no library
      .map((s) => s.binding as string),
  );
  const finalSchema =
    autoMode && (json.videoSequence?.length ?? 0) > 0
      ? mergedSchema.filter((f) => {
          if (f.type !== "video") return true;
          return sequenceManualSlotBindings.has(f.key);
        })
      : mergedSchema;

  return {
    json,
    mergedSchema,
    finalSchema,
    initialValues,
    provenance,
    context,
    accountId,
    templateNeedsAccount,
    usageKeyByPick,
    unboundAudioSuggestion,
    audioMinDuration,
    slotBannerContext: slotPrefill.slotBannerContext,
  };
}

/**
 * Reproduit EXACTEMENT ce qu'un `ListingForm` non modifié construit à l'init
 * puis envoie dans `handleGenerate` (moins `PROVENANCE_KEY`, ajoutée par
 * l'appelant) :
 *  - `values` : une entrée par champ de `finalSchema`, via
 *    `resolveInitialFieldValue` (mêmes règles que le `useState` `values`).
 *  - `provenance` : la provenance d'init (`context.prefilledKeys ??
 *    model.provenance`, étendue aux champs `metadataSource` via
 *    `initFieldProvenance`), puis `"manual"` sur `manualFieldKeys` — les
 *    champs changés via « Changer » dans la modale de lot, au même titre
 *    qu'une édition manuelle dans le formulaire (`markProvenance`).
 */
export function projectFormValues(
  model: GenerationFormModel,
  manualFieldKeys?: string[],
): { values: Record<string, unknown>; provenance: ProvenanceMap } {
  const values: Record<string, unknown> = Object.fromEntries(
    model.finalSchema.map((field) => [field.key, resolveInitialFieldValue(field, model.initialValues[field.key])]),
  );

  const baseProvenance = model.context?.prefilledKeys ?? model.provenance;
  const provenance = initFieldProvenance(model.finalSchema, baseProvenance);
  for (const key of manualFieldKeys ?? []) {
    if (canOverride(provenance[key], "manual")) provenance[key] = "manual";
  }

  return { values, provenance };
}
