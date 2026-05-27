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
import {
  resolveLibraryPrefill,
  selectMediaAssetByMetadataValue,
} from "@/lib/contentLibraryResolver";
import type {
  TemplateJSON,
  MusicBlock,
  VideoBlock,
  SchemaField,
} from "@/types/template";
import type {
  LibraryPrefillContext,
  MetadataDrivenLink,
} from "@/types/libraryPrefill";

interface BuildArgs {
  json: TemplateJSON;
  mergedSchema: SchemaField[];
  initialValues: Record<string, unknown> | undefined;
  accountId: string | null;
  slotId: string | null;
  listingId: string | null;
}

interface BuildResult {
  context: LibraryPrefillContext | undefined;
  updatedInitialValues: Record<string, unknown> | undefined;
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
}: BuildArgs): Promise<BuildResult> {
  let initialValues = initialValuesIn;

  const hasLibraryBindings =
    json.blocks.some((b) => (b.type === "video" || b.type === "music") && b.libraryId) ||
    (json.videoSequence ?? []).some((s) => !!s.libraryId) ||
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

  const fieldLibraryMap: Record<
    string,
    { libraryId: string; blockId: string; type: "video" | "audio"; tagFilterParam?: string }
  > = {};
  const initialSuggestions: Record<
    string,
    { id: string; url: string; filename: string } | null
  > = {};
  const prefilledDataKeys: string[] = [];
  let dataSuggestion: { entryId: string; fields: Record<string, string> } | null = null;

  // Build fieldLibraryMap — always, even when regenerating
  for (const block of json.blocks) {
    if (block.type === "video" && block.binding && block.libraryId) {
      const rule = block.selectionRule;
      const tagFilterParam =
        typeof rule === "object" && rule !== null && "tagFilterParam" in rule
          ? (rule as { tagFilterParam?: string }).tagFilterParam
          : undefined;
      fieldLibraryMap[block.binding] = {
        libraryId: block.libraryId,
        blockId: block.id,
        type: "video" as const,
        tagFilterParam,
      };
    }
  }

  // Also add videoSequence slots that have a libraryId — in sequence mode, the
  // libraryId lives on the slot, not on the VideoBlock. We need these in
  // fieldLibraryMap so the generation form shows the LibraryFieldInput +
  // "depuis la bibliothèque" badge. Note: slots may use `label` instead of
  // `binding` as the form field key.
  for (const slot of json.videoSequence ?? []) {
    if (!slot.libraryId) continue;
    const rule = slot.selectionRule;
    const tagFilterParam =
      typeof rule === "object" && rule !== null && "tagFilterParam" in rule
        ? (rule as { tagFilterParam?: string }).tagFilterParam
        : undefined;
    const slotLibMeta = {
      libraryId: slot.libraryId,
      blockId: slot.id,
      type: "video" as const,
      tagFilterParam,
    };

    // Priority 1: explicit binding (exact match)
    // Priority 2: label lowercased (handles labels like "OUTRO" when field key is "outro")
    const primaryKey = slot.binding ?? slot.label?.toLowerCase();
    if (primaryKey) fieldLibraryMap[primaryKey] = slotLibMeta;

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
    const rule = musicBlock.audioSelectionRule;
    const tagFilterParam =
      typeof rule === "object" && rule !== null && "tagFilterParam" in rule
        ? (rule as { tagFilterParam?: string }).tagFilterParam
        : undefined;
    fieldLibraryMap[musicBlock.binding] = {
      libraryId: musicBlock.libraryId,
      blockId: musicBlock.id,
      type: "audio" as const,
      tagFilterParam,
    };
  }

  // Fetch Instagram accounts if needed (for theme_sequence blocks)
  const instagramAccounts = hasThemeSequenceBlocks
    ? await prisma.instagramAccount.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, handle: true },
      })
    : [];

  let setSequencedLibraryIds: string[] = [];
  let usedSetTagByLibrary: Record<string, string> | undefined;
  let usedCategoryByLibrary: Record<string, string> | undefined;
  let prevDataEntryState:
    | {
        entryId: string;
        campaignId: string;
        usagePolicy: string;
        claimType: "usedInCycle" | "perAccountUsage";
        accountId?: string;
      }
    | undefined;

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
    usedCategoryByLibrary =
      prefill.usedCategoryByLibrary && Object.keys(prefill.usedCategoryByLibrary).length > 0
        ? prefill.usedCategoryByLibrary
        : undefined;
    prevDataEntryState = prefill.prevDataEntryState ?? undefined;

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
      // Build a lowercase-key → value lookup so that CSV headers lowercased
      // by the import route (e.g. "c2l1") can still match schema field keys
      // stored in any case (e.g. "C2L1").
      const lowerToValue = new Map<string, string>(
        Object.entries(rawFields).map(([k, v]) => [k.toLowerCase(), v]),
      );
      for (const schemaField of json.schema) {
        // Exact match first; fall back to case-insensitive
        let value: string | undefined =
          rawFields[schemaField.key] ?? lowerToValue.get(schemaField.key.toLowerCase());
        if (value === undefined) continue;
        // For select fields: normalize value to match the canonical option
        // string (e.g. stored "quartier" → option "Quartier").
        if (
          schemaField.type === "select" &&
          Array.isArray(schemaField.options) &&
          schemaField.options.length > 0
        ) {
          const matched = schemaField.options.find(
            (opt) => opt.toLowerCase() === value!.toLowerCase(),
          );
          if (matched) value = matched;
        }
        initialValues = { ...initialValues, [schemaField.key]: value };
        prefilledDataKeys.push(schemaField.key);
      }
      dataSuggestion = prefill.dataSuggestion;
    }
  }

  const context: LibraryPrefillContext = {
    fieldLibraryMap,
    initialSuggestions,
    prefilledDataKeys,
    dataSuggestion,
    setSequencedLibraryIds,
    usedSetTagByLibrary,
    usedCategoryByLibrary,
    prevDataEntryState,
    instagramAccounts,
    selectedAccountId: accountId,
    slotId,
    metadataDrivenLinks: buildMetadataDrivenLinks(json),
  };

  return { context, updatedInitialValues: initialValues };
}
