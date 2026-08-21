/**
 * buildLibraryPrefillContext — extrait la logique de pré-remplissage Content
 * Library du Server Component /generate/[templateId]/page.tsx pour la rendre
 * lisible et testable. Phase 1.9 C2.
 *
 * Cette fonction :
 *  - calcule `fieldLibraryMap` (mapping fieldKey → library meta) à partir des
 *    VideoBlock, MusicBlock et videoSequence slots ;
 *  - charge les InstagramAccount si au moins un block utilise `theme_sequence` ;
 *  - en régénération (listingId présent) : retrouve les assets liés aux URLs
 *    déjà stockés dans `initialValues` ;
 *  - sinon : appelle `resolveLibraryPrefill` pour rotation auto + applique les
 *    suggestions au form (videos par binding et videoSequence, music, data) ;
 *  - gère le cas metadata-driven (videoBlockId lié à un select
 *    `metadata-values-from-library`) via `selectMediaAssetByMetadataValue`.
 *
 * Retourne le `LibraryPrefillContext` consommé par `ListingForm` ainsi que
 * `updatedInitialValues` (les suggestions appliquées prennent la place des
 * valeurs vides du form).
 */

import { prisma } from "@/lib/prisma";
import { SHARED_SENTINEL_IDS } from "@/lib/rotation/sentinels";
import {
  resolveLibraryPrefill,
  selectMediaAssetByMetadataValue,
} from "@/lib/contentLibraryResolver";
import type {
  TemplateJSON,
  MusicBlock,
  VideoBlock,
  SchemaField,
  MediaSelectionRule,
  MediaSelectionRuleConfig,
  TagCondition,
} from "@/types/template";
import type {
  LibraryPrefillContext,
  MetadataDrivenLink,
} from "@/types/libraryPrefill";
import type { ProvenanceMap } from "@/lib/generate/provenance";
import { buildLowerKeyMap, canAssignFieldValue, matchFieldValue } from "@/lib/generate/matchFieldValue";

interface BuildArgs {
  json: TemplateJSON;
  mergedSchema: SchemaField[];
  initialValues: Record<string, unknown> | undefined;
  accountId: string | null;
  slotId: string | null;
  listingId: string | null;
  /** Provenance déjà connue pour `initialValues` (posée par `buildSlotPrefill`
   *  en amont) — la boucle DataEntry l'étend plutôt que de la recalculer. */
  provenance?: ProvenanceMap;
}

interface BuildResult {
  context: LibraryPrefillContext | undefined;
  updatedInitialValues: Record<string, unknown> | undefined;
}

/**
 * Fix #3 (P8 rotation) : deux blocks/slots partageant le même field key
 * s'écrasent silencieusement dans `fieldLibraryMap` (ex. deux slots
 * videoSequence avec le même `binding`/`label`) — un des deux blockId perd
 * son entrée, un seul des deux assets est donc claimé au submit et l'autre
 * repart en redécouverte à la prochaine génération (cf. skill
 * asset-rotation, fix #2). Chirurgie du modèle de form hors périmètre ici :
 * on se contente de signaler la collision pour permettre le diagnostic.
 */
type FieldLibraryMapEntry = {
  libraryId: string;
  blockId: string;
  type: "video" | "audio";
  tagFilterParam?: string;
  minDuration?: number;
  /** A.4 (P5 hardening) — voir `extractTagRuleMeta`. */
  tagConditions?: TagCondition[];
  tagConditionsOperator?: "AND" | "OR";
  tagFilter?: string;
};

function setFieldLibraryMapEntry(
  map: Record<string, FieldLibraryMapEntry>,
  key: string,
  meta: FieldLibraryMapEntry,
): void {
  const existing = map[key];
  if (existing && existing.blockId !== meta.blockId) {
    console.warn(
      `[buildLibraryPrefillContext] collision fieldLibraryMap sur la clé "${key}" : le block/slot "${meta.blockId}" écrase le mapping déjà posé par "${existing.blockId}" — un seul des deux assets sera claimé au submit.`,
    );
  }
  map[key] = meta;
}

/**
 * Extrait les métadonnées de filtre tag d'une règle de sélection — legacy
 * `tagFilterParam` (déjà transmis) + `tagFilter` littéral + `tagConditions`/
 * `tagConditionsOperator` (A.4, P5 hardening 21/08) : avant ce fix, seul
 * `tagFilterParam` atteignait `fieldLibraryMap`, si bien que le picker
 * « Changer » ne reflétait jamais un filtre par tag littéral ni les règles
 * avancées `tagConditions` — la liste montrée à l'user pouvait contenir des
 * assets que le tirage automatique n'aurait jamais servis (mauvais tag).
 * `tagConditions` est transmis TEL QUEL (peut contenir des conditions
 * `fromParam` non résolues) — la résolution contre les valeurs du formulaire
 * se fait côté client (`resolveTagConditionsForForm`, `ListingForm`).
 */
function extractTagRuleMeta(rule: MediaSelectionRule | undefined): {
  tagFilterParam?: string;
  tagFilter?: string;
  tagConditions?: TagCondition[];
  tagConditionsOperator?: "AND" | "OR";
} {
  if (typeof rule !== "object" || rule === null) return {};
  const cfg = rule as MediaSelectionRuleConfig;
  return {
    tagFilterParam: cfg.tagFilterParam,
    tagFilter: cfg.tagFilter,
    tagConditions: cfg.tagConditions,
    tagConditionsOperator: cfg.tagConditionsOperator,
  };
}

function buildMetadataDrivenLinks(json: TemplateJSON): MetadataDrivenLink[] {
  const links: MetadataDrivenLink[] = [];
  for (const slot of json.videoSequence ?? []) {
    if (!slot.videoBlockId) continue;
    const linkedBlock = json.blocks.find(
      (b) => b.type === "video" && b.id === slot.videoBlockId,
    ) as VideoBlock | undefined;
    if (!linkedBlock?.binding) continue;
    const metaSelectField = json.schema.find(
      (f) =>
        f.type === "select" &&
        f.optionsSource?.type === "metadata-values-from-library" &&
        f.optionsSource.blockId === slot.videoBlockId &&
        f.optionsSource.libraryId &&
        f.optionsSource.metadataKey,
    );
    if (metaSelectField?.optionsSource?.type === "metadata-values-from-library") {
      links.push({
        sourceFieldKey: metaSelectField.key,
        targetFieldKey: linkedBlock.binding,
        libraryId: metaSelectField.optionsSource.libraryId!,
        metadataKey: metaSelectField.optionsSource.metadataKey!,
      });
    }
  }
  return links;
}

export async function buildLibraryPrefillContext({
  json,
  mergedSchema,
  initialValues: initialValuesIn,
  accountId,
  slotId,
  listingId,
  provenance: provenanceIn,
}: BuildArgs): Promise<BuildResult> {
  let initialValues = initialValuesIn;
  const provenance: ProvenanceMap = { ...(provenanceIn ?? {}) };

  const hasLibraryBindings =
    json.blocks.some((b) => (b.type === "video" || b.type === "music") && b.libraryId) ||
    (json.videoSequence ?? []).some((s) => !!s.libraryId) ||
    !!json.contentLibrary?.dataLibraryId ||
    !!json.contentLibrary?.dataCampaignId;

  if (!hasLibraryBindings) {
    return { context: undefined, updatedInitialValues: initialValues };
  }

  // Detect if any video block OR video sequence slot uses theme_sequence —
  // needs an Instagram account selector at generation time.
  const hasThemeSequenceBlocks =
    json.blocks.some((b) => {
      if (b.type !== "video" || !b.libraryId) return false;
      const rule = (b as VideoBlock).selectionRule;
      if (!rule) return false;
      if (typeof rule === "string") return rule === "theme_sequence";
      return rule.strategy === "theme_sequence";
    }) ||
    (json.videoSequence ?? []).some((s) => {
      if (!s.libraryId || !s.selectionRule) return false;
      if (typeof s.selectionRule === "string")
        return s.selectionRule === "theme_sequence";
      return (s.selectionRule as { strategy?: string }).strategy === "theme_sequence";
    });

  const fieldLibraryMap: Record<string, FieldLibraryMapEntry> = {};
  const initialSuggestions: Record<
    string,
    { id: string; url: string; filename: string } | null
  > = {};

  // Build fieldLibraryMap — always, even when regenerating
  for (const block of json.blocks) {
    if (block.type === "video" && block.binding && block.libraryId) {
      setFieldLibraryMapEntry(fieldLibraryMap, block.binding, {
        libraryId: block.libraryId,
        blockId: block.id,
        type: "video" as const,
        ...extractTagRuleMeta(block.selectionRule),
        minDuration: (block as VideoBlock).minDuration,
      });
    }
  }

  // Also add videoSequence slots that have a libraryId — in sequence mode, the
  // libraryId lives on the slot, not on the VideoBlock. We need these in
  // fieldLibraryMap so the generation form shows the LibraryFieldInput +
  // "depuis la bibliothèque" badge. Note: slots may use `label` instead of
  // `binding` as the form field key.
  for (const slot of json.videoSequence ?? []) {
    if (!slot.libraryId) continue;
    // Resolve minDuration from the linked VideoBlock if available
    const linkedVideoBlock = slot.videoBlockId
      ? (json.blocks.find((b) => b.type === "video" && b.id === slot.videoBlockId) as VideoBlock | undefined)
      : slot.binding
        ? (json.blocks.find((b) => b.type === "video" && b.binding === slot.binding) as VideoBlock | undefined)
        : undefined;
    const slotMinDuration: number | undefined = linkedVideoBlock?.minDuration ?? (slot.maxDuration && slot.maxDuration > 0 ? slot.maxDuration : undefined);
    const slotLibMeta: FieldLibraryMapEntry = {
      libraryId: slot.libraryId,
      blockId: slot.id,
      type: "video" as const,
      ...extractTagRuleMeta(slot.selectionRule),
      minDuration: slotMinDuration,
    };

    // Priority 1: explicit binding (exact match)
    // Priority 2: label lowercased (handles labels like "OUTRO" when field key is "outro")
    const primaryKey = slot.binding ?? slot.label?.toLowerCase();
    if (primaryKey) setFieldLibraryMapEntry(fieldLibraryMap, primaryKey, slotLibMeta);

    // Priority 3: videoBlockId → VideoBlock.binding
    // Handles cases where the slot label doesn't match the schema field key at
    // all (e.g. slot label "CONTENT" but field key "rva3raw", linked via
    // VideoBlock "RVA3")
    if (slot.videoBlockId) {
      const linkedBlock = json.blocks.find(
        (b) => b.type === "video" && b.id === slot.videoBlockId,
      ) as VideoBlock | undefined;
      if (linkedBlock?.binding && !fieldLibraryMap[linkedBlock.binding]) {
        fieldLibraryMap[linkedBlock.binding] = slotLibMeta;
      }
    }
  }

  const musicBlock = json.blocks.find(
    (b): b is MusicBlock => b.type === "music" && !!b.libraryId,
  );
  if (musicBlock?.binding && musicBlock.libraryId) {
    // Fix mineur (post #3) : route via setFieldLibraryMapEntry comme les
    // blocks vidéo / slots videoSequence, pour une couverture homogène du
    // warn de collision de clé (avant ce fix, une collision sur la clé du
    // champ musique n'était jamais loguée).
    setFieldLibraryMapEntry(fieldLibraryMap, musicBlock.binding, {
      libraryId: musicBlock.libraryId,
      blockId: musicBlock.id,
      type: "audio" as const,
      ...extractTagRuleMeta(musicBlock.audioSelectionRule),
      minDuration: musicBlock.minDuration,
    });
  }

  // Fetch Instagram accounts if needed (for theme_sequence blocks).
  // Exclut les sentinels (curseurs partagés) — la rotation scope "shared"
  // utilise directement SHARED_USAGE_ACCOUNT_ID sans passer par cette liste.
  const instagramAccounts = hasThemeSequenceBlocks
    ? await prisma.instagramAccount.findMany({
        where: { id: { notIn: [...SHARED_SENTINEL_IDS] } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, handle: true },
      })
    : [];

  let setSequencedLibraryIds: string[] = [];
  let usedSetTagByLibrary: Record<string, string> | undefined;
  let dataSuggestion: {
    entryId: string;
    fields: Record<string, string>;
    resolvedSetTag?: string | null;
  } | null = null;

  if (listingId) {
    // Regenerating from an existing listing: try to match stored URLs back to
    // library assets so the picker shows the previously used asset as the
    // current selection.
    for (const [fieldKey, meta] of Object.entries(fieldLibraryMap)) {
      const existingUrl = initialValues?.[fieldKey] as string | undefined;
      if (existingUrl) {
        const asset = await prisma.mediaAsset.findFirst({
          where: { libraryId: meta.libraryId, url: existingUrl },
          select: { id: true, filename: true, url: true },
        });
        initialSuggestions[fieldKey] = asset ?? null;
      } else {
        initialSuggestions[fieldKey] = null;
      }
    }
    // No dataSuggestion when regenerating — text fields already pre-filled
    // from listing.
  } else {
    // Fresh generation: use resolveLibraryPrefill (pass accountId if a
    // theme_sequence block exists).
    const prefill = await resolveLibraryPrefill(
      json,
      initialValues ?? undefined,
      accountId ?? undefined,
    );
    setSequencedLibraryIds = prefill.setSequencedLibraryIds ?? [];
    usedSetTagByLibrary =
      prefill.usedSetTagByLibrary && Object.keys(prefill.usedSetTagByLibrary).length > 0
        ? prefill.usedSetTagByLibrary
        : undefined;

    for (const block of json.blocks) {
      if (block.type === "video" && block.binding && block.libraryId) {
        const suggestion = prefill.videoSuggestions[block.id] ?? null;
        initialSuggestions[block.binding] = suggestion;
        if (suggestion)
          initialValues = { ...initialValues, [block.binding]: suggestion.url };
      }
    }

    // Map videoSequence slot suggestions (keyed by slot.id in the resolver)
    for (const slot of json.videoSequence ?? []) {
      if (!slot.libraryId) continue;

      const primaryKey = slot.binding ?? slot.label?.toLowerCase();
      const linkedBlock = slot.videoBlockId
        ? (json.blocks.find(
            (b) => b.type === "video" && b.id === slot.videoBlockId,
          ) as VideoBlock | undefined)
        : undefined;
      const blockBinding = linkedBlock?.binding;

      // Detect metadata-driven slots (videoBlockId linked to a
      // metadata-values-from-library select field). For these slots, skip
      // rotation-based suggestion and instead resolve the correct asset from
      // the metadata field value already present in initialValues (e.g.
      // client name).
      let effectiveSuggestion: { id: string; url: string; filename: string } | null = null;
      let isMetadataDriven = false;

      if (slot.videoBlockId) {
        const metaSelectField = mergedSchema.find(
          (f) =>
            f.type === "select" &&
            f.optionsSource?.type === "metadata-values-from-library" &&
            f.optionsSource.blockId === slot.videoBlockId &&
            f.optionsSource.libraryId &&
            f.optionsSource.metadataKey,
        );
        if (metaSelectField?.optionsSource?.type === "metadata-values-from-library") {
          isMetadataDriven = true;
          const { libraryId: metaLibId, metadataKey } = metaSelectField.optionsSource;
          const selectedValue = initialValues?.[metaSelectField.key];
          if (selectedValue && typeof selectedValue === "string" && selectedValue.trim()) {
            const metaAsset = await selectMediaAssetByMetadataValue(
              metaLibId!,
              metadataKey!,
              selectedValue.trim(),
              accountId ?? undefined,
            );
            if (metaAsset) {
              effectiveSuggestion = {
                id: metaAsset.id,
                url: metaAsset.url,
                filename: metaAsset.filename,
              };
            }
          }
          // If no client selected yet or no matching asset: effectiveSuggestion
          // stays null (do not fall back to rotation — would show misleading
          // video).
        }
      }

      if (!isMetadataDriven) {
        effectiveSuggestion = prefill.videoSuggestions[slot.id] ?? null;
      }

      if (primaryKey) {
        initialSuggestions[primaryKey] = effectiveSuggestion;
        if (effectiveSuggestion)
          initialValues = { ...initialValues, [primaryKey]: effectiveSuggestion.url };
      }
      if (blockBinding && !initialSuggestions[blockBinding]) {
        initialSuggestions[blockBinding] = effectiveSuggestion;
        if (effectiveSuggestion)
          initialValues = { ...initialValues, [blockBinding]: effectiveSuggestion.url };
      }
    }

    if (musicBlock?.binding && musicBlock.libraryId) {
      initialSuggestions[musicBlock.binding] = prefill.audioSuggestion ?? null;
      if (prefill.audioSuggestion)
        initialValues = { ...initialValues, [musicBlock.binding]: prefill.audioSuggestion.url };
    }

    if (prefill.dataSuggestion) {
      const rawFields = prefill.dataSuggestion.fields;
      // Lowercase-key → value lookup partagé par matchFieldValue, pour que les
      // headers CSV lowercased par la route d'import (ex. "c2l1") matchent
      // quand même une clé de schéma stockée dans une autre casse (ex. "C2L1").
      const lowerToValue = buildLowerKeyMap(rawFields);
      for (const schemaField of json.schema) {
        const value = matchFieldValue(schemaField, rawFields, lowerToValue);
        if (value === undefined) continue;
        // Précédence de pré-remplissage (voir lib/generate/provenance.ts) :
        // manual > entity > shootEntity > dataEntry > assetMetadata. À ce
        // stade `initialValues`/`provenance` portent déjà la fiche/le
        // tournage/les overrides mission (posés en amont par buildSlotPrefill)
        // — ne jamais les écraser avec la DataEntry.
        const existing = initialValues?.[schemaField.key];
        if (!canAssignFieldValue(existing, provenance[schemaField.key], "dataEntry")) continue;
        initialValues = { ...initialValues, [schemaField.key]: value };
        provenance[schemaField.key] = "dataEntry";
      }
      dataSuggestion = prefill.dataSuggestion
        ? {
            entryId: prefill.dataSuggestion.entryId,
            fields: prefill.dataSuggestion.fields,
            resolvedSetTag: prefill.dataSuggestion.resolvedSetTag,
          }
        : null;
    }
  }

  const context: LibraryPrefillContext = {
    fieldLibraryMap,
    initialSuggestions,
    prefilledKeys: provenance,
    dataSuggestion,
    setSequencedLibraryIds,
    usedSetTagByLibrary,
    instagramAccounts,
    selectedAccountId: accountId ?? undefined,
    slotId: slotId ?? undefined,
    metadataDrivenLinks: buildMetadataDrivenLinks(json),
  };

  return { context, updatedInitialValues: initialValues };
}
