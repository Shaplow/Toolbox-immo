import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { ListingForm } from "@/components/form/ListingForm";
import { collectTemplateConditionValues, normalizeTemplateJSON } from "@/lib/templateNormalization";
import type { TemplateJSON, MusicBlock, VideoBlock } from "@/types/template";
import { DPE_AUTO_FIELDS } from "@/lib/renderer/blocks/renderDPEBlock";
import { getUserContext } from "@/lib/userContext";
import { resolveLibraryPrefill, selectMediaAssetByMetadataValue } from "@/lib/contentLibraryResolver";
import type { LibraryPrefillContext, MetadataDrivenLink } from "@/types/libraryPrefill";

/**
 * Computes the list of metadata-driven links between select fields and video fields.
 * Each link describes: when the user selects a value in the source select field,
 * the form should auto-resolve the matching video from the library and populate
 * the target video field.
 */
function buildMetadataDrivenLinks(json: TemplateJSON): MetadataDrivenLink[] {
  const links: MetadataDrivenLink[] = [];
  for (const slot of (json.videoSequence ?? [])) {
    if (!slot.videoBlockId) continue;
    const linkedBlock = json.blocks.find((b) => b.type === "video" && b.id === slot.videoBlockId) as VideoBlock | undefined;
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

function buildMediaFieldAspectRatios(json: TemplateJSON): Record<string, number> {
  const ratios = new Map<string, { ratio: number; area: number }>();

  for (const block of json.blocks) {
    if ((block.type !== "image" && block.type !== "video") || !block.binding || block.w <= 0 || block.h <= 0) {
      continue;
    }

    const area = block.w * block.h;
    const current = ratios.get(block.binding);
    if (!current || area > current.area) {
      ratios.set(block.binding, {
        ratio: block.w / block.h,
        area,
      });
    }
  }

  return Object.fromEntries(Array.from(ratios.entries()).map(([key, value]) => [key, value.ratio]));
}

type Props = {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<{ listingId?: string; accountId?: string; slotId?: string }>;
};

export default async function GeneratePage({ params, searchParams }: Props) {
  const { templateId } = await params;
  const { listingId, accountId: rawAccountId, slotId } = await searchParams;
  let accountId: string | undefined = rawAccountId;
  const userContext = await getUserContext();
  if (!userContext) notFound();
  const userId = userContext.effectiveUser.id;

  // If listingId provided, pre-fill form with its data
  let initialValues: Record<string, unknown> | undefined;
  if (listingId) {
    const existingListing = await prisma.listing.findFirst({
      where: userContext.canAdminBypass ? { id: listingId } : { id: listingId, userId },
    });
    if (existingListing) {
      initialValues = JSON.parse(existingListing.jsonData) as Record<string, unknown>;
    }
  }

  // If slotId provided: load slot to derive accountId and merge flex fields
  if (slotId) {
    const slot = await prisma.publicationSlot.findFirst({
      where: { id: slotId },
      select: { accountId: true, fields: true },
    });
    if (slot) {
      if (!accountId) accountId = slot.accountId;
      try {
        const slotFields = JSON.parse(slot.fields) as Record<string, string>;
        // Slot fields are base values; listingId data (if any) takes precedence
        initialValues = { ...slotFields, ...initialValues };
      } catch { /* ignore malformed JSON */ }
    }
  }

  const { canAccessTemplate } = await import("@/lib/permissions");
  const ok = userContext.canAdminBypass
    ? true
    : await canAccessTemplate(userId, templateId, userContext.effectiveUser.role);
  if (!ok) notFound();

  const template = await prisma.template.findUnique({ where: { id: templateId } });
  if (!template) notFound();

  const json = normalizeTemplateJSON(JSON.parse(template.jsonData) as TemplateJSON);

  // Start from the user-defined schema (source of truth for manual variables)
  const schemaMap = new Map(json.schema.map((f) => [f.key, f]));

  // If the template contains at least one DPE block, inject the 4 fixed DPE fields
  // (only for keys not already declared manually in the schema)
  const hasDpe = json.blocks.some((b) => b.type === "dpe");
  if (hasDpe) {
    for (const field of DPE_AUTO_FIELDS) {
      if (!schemaMap.has(field.key)) schemaMap.set(field.key, field);
    }
  }

  // Auto-inject video fields for video blocks with a binding not already in schema
  for (const block of json.blocks) {
    if (block.type === "video" && block.binding && !schemaMap.has(block.binding)) {
      schemaMap.set(block.binding, {
        key: block.binding,
        label: block.binding.charAt(0).toUpperCase() + block.binding.slice(1).replace(/_/g, " "),
        type: "video",
        required: true,
        description: "Vidéo à intégrer dans le template (MP4 · MOV · WEBM)",
      });
    }
  }

  // Auto-inject audio fields for music blocks with a binding not already in schema
  for (const block of json.blocks) {
    if (block.type === "music" && block.binding && !schemaMap.has(block.binding)) {
      schemaMap.set(block.binding, {
        key: block.binding,
        label: block.binding.charAt(0).toUpperCase() + block.binding.slice(1).replace(/_/g, " "),
        type: "audio",
        required: false,
        description: "Musique de fond (MP3 · WAV · AAC · M4A · OGG)",
      });
    }
  }

  const conditionValues = collectTemplateConditionValues(json);
  for (const [field, values] of conditionValues) {
    if (!schemaMap.has(field)) {
      schemaMap.set(field, {
        key: field,
        label: field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, " "),
        type: "select",
        required: false,
        options: [...Array.from(values)],
        description: "Champ conditionnel — laisser vide pour masquer les blocs conditionnels",
      });
    }
  }

  const mergedSchema = [...schemaMap.values()];

  // For video fields that will be auto-resolved from a metadata-values-from-library
  // select field at render time, remove the required constraint.
  // The video is always resolved server-side from the linked select field value;
  // blocking the form when the field is empty would be incorrect.
  for (const slot of (json.videoSequence ?? [])) {
    if (!slot.videoBlockId) continue;
    const isMetadataDriven = json.schema.some(
      (f) =>
        f.type === "select" &&
        f.optionsSource?.type === "metadata-values-from-library" &&
        f.optionsSource.blockId === slot.videoBlockId,
    );
    if (!isMetadataDriven) continue;
    const linkedBlock = json.blocks.find((b) => b.type === "video" && b.id === slot.videoBlockId) as VideoBlock | undefined;
    if (!linkedBlock?.binding) continue;
    const field = mergedSchema.find((f) => f.key === linkedBlock.binding);
    if (field) field.required = false;
  }

  const mediaFieldAspectRatios = buildMediaFieldAspectRatios(json);

  // ─── Resolve ig_account handle BEFORE library prefill ────────────────────
  // igAccountFilterParam in SelectionRuleEditor references a form field (e.g. "ig_account").
  // The value must be in formData when resolveLibraryPrefill is called so the resolver
  // can apply the IG tag filter correctly. Only inject if not already present.
  if (accountId && !initialValues?.ig_account) {
    const hasIgField = json.schema.some((f) => f.key === "ig_account");
    if (hasIgField) {
      const igAccount = await prisma.instagramAccount.findUnique({
        where: { id: accountId },
        select: { handle: true },
      });
      if (igAccount) initialValues = { ...initialValues, ig_account: igAccount.handle };
    }
  }

  // ─── Content Library pre-fill ──────────────────────────────────────────────
  let libraryPrefillContext: LibraryPrefillContext | undefined;
  const hasLibraryBindings =
    json.blocks.some((b) => (b.type === "video" || b.type === "music") && b.libraryId) ||
    (json.videoSequence ?? []).some((s) => !!s.libraryId) ||
    !!json.contentLibrary?.dataCampaignId;

  // Detect if any video block OR video sequence slot uses theme_sequence —
  // needs an Instagram account selector at generation time.
  const hasThemeSequenceBlocks =
    json.blocks.some((b) => {
      if (b.type !== "video" || !b.libraryId) return false;
      const rule = (b as import("@/types/template").VideoBlock).selectionRule;
      if (!rule) return false;
      if (typeof rule === "string") return rule === "theme_sequence";
      return rule.strategy === "theme_sequence";
    }) ||
    (json.videoSequence ?? []).some((s) => {
      if (!s.libraryId || !s.selectionRule) return false;
      if (typeof s.selectionRule === "string") return s.selectionRule === "theme_sequence";
      return (s.selectionRule as { strategy?: string }).strategy === "theme_sequence";
    });

  if (hasLibraryBindings) {
    const fieldLibraryMap: Record<string, { libraryId: string; blockId: string; type: "video" | "audio"; tagFilterParam?: string }> = {};
    const initialSuggestions: Record<string, { id: string; url: string; filename: string } | null> = {};
    const prefilledDataKeys: string[] = [];
    let dataSuggestion: { entryId: string; fields: Record<string, string> } | null = null;

    // Build fieldLibraryMap — always, even when regenerating
    for (const block of json.blocks) {
      if (block.type === "video" && block.binding && block.libraryId) {
        const rule = block.selectionRule;
        const tagFilterParam = (typeof rule === "object" && rule !== null && "tagFilterParam" in rule)
          ? (rule as { tagFilterParam?: string }).tagFilterParam
          : undefined;
        fieldLibraryMap[block.binding] = { libraryId: block.libraryId, blockId: block.id, type: "video" as const, tagFilterParam };
      }
    }
    // Also add videoSequence slots that have a libraryId — in sequence mode, the libraryId
    // lives on the slot, not on the VideoBlock. We need these in fieldLibraryMap so the
    // generation form shows the LibraryFieldInput + "depuis la bibliothèque" badge.
    // Note: slots may use `label` instead of `binding` as the form field key.
    for (const slot of (json.videoSequence ?? [])) {
      if (!slot.libraryId) continue;
      const rule = slot.selectionRule;
      const tagFilterParam = (typeof rule === "object" && rule !== null && "tagFilterParam" in rule)
        ? (rule as { tagFilterParam?: string }).tagFilterParam
        : undefined;
      const slotLibMeta = { libraryId: slot.libraryId, blockId: slot.id, type: "video" as const, tagFilterParam };

      // Priority 1: explicit binding (exact match)
      // Priority 2: label lowercased (handles labels like "OUTRO" when field key is "outro")
      const primaryKey = slot.binding ?? slot.label?.toLowerCase();
      if (primaryKey) fieldLibraryMap[primaryKey] = slotLibMeta;

      // Priority 3: videoBlockId → VideoBlock.binding
      // Handles cases where the slot label doesn't match the schema field key at all
      // (e.g. slot label "CONTENT" but field key "rva3raw", linked via VideoBlock "RVA3")
      if (slot.videoBlockId) {
        const linkedBlock = json.blocks.find((b) => b.type === "video" && b.id === slot.videoBlockId) as VideoBlock | undefined;
        if (linkedBlock?.binding && !fieldLibraryMap[linkedBlock.binding]) {
          fieldLibraryMap[linkedBlock.binding] = slotLibMeta;
        }
      }
    }
    const musicBlock = json.blocks.find((b): b is MusicBlock => b.type === "music" && !!b.libraryId);
    if (musicBlock?.binding && musicBlock.libraryId) {
      const rule = musicBlock.audioSelectionRule;
      const tagFilterParam = (typeof rule === "object" && rule !== null && "tagFilterParam" in rule)
        ? (rule as { tagFilterParam?: string }).tagFilterParam
        : undefined;
      fieldLibraryMap[musicBlock.binding] = { libraryId: musicBlock.libraryId, blockId: musicBlock.id, type: "audio" as const, tagFilterParam };
    }

    // Fetch Instagram accounts if needed (for theme_sequence blocks)
    const instagramAccounts = hasThemeSequenceBlocks
      ? await prisma.instagramAccount.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, handle: true, offre: true } })
      : [];

    let setSequencedLibraryIds: string[] = [];
    let usedSetTagByLibrary: Record<string, string> | undefined;
    let usedCategoryByLibrary: Record<string, string> | undefined;
    let prevCursorStateByLibrary: Record<string, { prevCursor: number; claimedCursor: number; prevLastUsedCategory: string | null; claimedLastUsedCategory: string | null }> | undefined;
    let prevDataEntryState: { entryId: string; campaignId: string; usagePolicy: string; claimType: "usedInCycle" | "perAccountUsage"; accountId?: string } | undefined;
    let prevAudioUsageState: { assetId: string; accountId: string; prevLastUsedAt: string | null; claimedLastUsedAt: string } | undefined;

    if (listingId) {
      // Regenerating from an existing listing: try to match stored URLs back to library assets
      // so the picker shows the previously used asset as the current selection.
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
      // No dataSuggestion when regenerating — text fields already pre-filled from listing
    } else {
      // Fresh generation: use resolveLibraryPrefill (pass accountId if a theme_sequence block exists)
      const prefill = await resolveLibraryPrefill(json, initialValues ?? undefined, accountId ?? undefined);
      setSequencedLibraryIds = prefill.setSequencedLibraryIds ?? [];
      usedSetTagByLibrary = prefill.usedSetTagByLibrary && Object.keys(prefill.usedSetTagByLibrary).length > 0
        ? prefill.usedSetTagByLibrary
        : undefined;
      usedCategoryByLibrary = prefill.usedCategoryByLibrary && Object.keys(prefill.usedCategoryByLibrary).length > 0
        ? prefill.usedCategoryByLibrary
        : undefined;
      prevCursorStateByLibrary = prefill.prevCursorStateByLibrary && Object.keys(prefill.prevCursorStateByLibrary).length > 0
        ? prefill.prevCursorStateByLibrary
        : undefined;
      prevDataEntryState = prefill.prevDataEntryState ?? undefined;
      prevAudioUsageState = prefill.prevAudioUsageState ?? undefined;

      for (const block of json.blocks) {
        if (block.type === "video" && block.binding && block.libraryId) {
          const suggestion = prefill.videoSuggestions[block.id] ?? null;
          initialSuggestions[block.binding] = suggestion;
          if (suggestion) initialValues = { ...initialValues, [block.binding]: suggestion.url };
        }
      }
      // Map videoSequence slot suggestions (keyed by slot.id in the resolver)
      for (const slot of (json.videoSequence ?? [])) {
        if (!slot.libraryId) continue;

        const primaryKey = slot.binding ?? slot.label?.toLowerCase();
        const linkedBlock = slot.videoBlockId
          ? (json.blocks.find((b) => b.type === "video" && b.id === slot.videoBlockId) as VideoBlock | undefined)
          : undefined;
        const blockBinding = linkedBlock?.binding;

        // Detect metadata-driven slots (videoBlockId linked to a metadata-values-from-library select field).
        // For these slots, skip rotation-based suggestion and instead resolve the correct asset
        // from the metadata field value already present in initialValues (e.g. client name).
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
                effectiveSuggestion = { id: metaAsset.id, url: metaAsset.url, filename: metaAsset.filename };
              }
            }
            // If no client selected yet or no matching asset: effectiveSuggestion stays null
            // (do not fall back to rotation — that would show a misleading video)
          }
        }

        if (!isMetadataDriven) {
          effectiveSuggestion = prefill.videoSuggestions[slot.id] ?? null;
        }

        if (primaryKey) {
          initialSuggestions[primaryKey] = effectiveSuggestion;
          if (effectiveSuggestion) initialValues = { ...initialValues, [primaryKey]: effectiveSuggestion.url };
        }
        if (blockBinding && !initialSuggestions[blockBinding]) {
          initialSuggestions[blockBinding] = effectiveSuggestion;
          if (effectiveSuggestion) initialValues = { ...initialValues, [blockBinding]: effectiveSuggestion.url };
        }
      }
      if (musicBlock?.binding && musicBlock.libraryId) {
        initialSuggestions[musicBlock.binding] = prefill.audioSuggestion ?? null;
        if (prefill.audioSuggestion) initialValues = { ...initialValues, [musicBlock.binding]: prefill.audioSuggestion.url };
      }
      if (prefill.dataSuggestion) {
        const rawFields = prefill.dataSuggestion.fields;
        // Build a lowercase-key → value lookup so that CSV headers lowercased by the
        // import route (e.g. "c2l1") can still match schema field keys stored in any case
        // (e.g. "C2L1").
        const lowerToValue = new Map<string, string>(
          Object.entries(rawFields).map(([k, v]) => [k.toLowerCase(), v])
        );
        for (const schemaField of json.schema) {
          // Exact match first; fall back to case-insensitive
          let value: string | undefined = rawFields[schemaField.key] ?? lowerToValue.get(schemaField.key.toLowerCase());
          if (value === undefined) continue;
          // For select fields: normalize value to match the canonical option string
          // (e.g. stored "quartier" → option "Quartier")
          if (schemaField.type === "select" && Array.isArray(schemaField.options) && schemaField.options.length > 0) {
            const matched = schemaField.options.find((opt) => opt.toLowerCase() === value!.toLowerCase());
            if (matched) value = matched;
          }
          initialValues = { ...initialValues, [schemaField.key]: value };
          prefilledDataKeys.push(schemaField.key);
        }
        dataSuggestion = prefill.dataSuggestion;
      }
    }

    libraryPrefillContext = {
      fieldLibraryMap,
      initialSuggestions,
      prefilledDataKeys,
      dataSuggestion,
      setSequencedLibraryIds,
      usedSetTagByLibrary,
      usedCategoryByLibrary,
      prevCursorStateByLibrary,
      prevDataEntryState,
      prevAudioUsageState,
      instagramAccounts,
      selectedAccountId: accountId,
      slotId,
      metadataDrivenLinks: buildMetadataDrivenLinks(json),
    };
  }

  // For "auto" mode: filter out video schema fields covered by videoSequence libraryId slots
  const autoMode = json.generationMode === "auto";
  // Collect the bindings of sequence slots that are manually fed from form fields.
  // Video schema fields whose key matches one of these bindings are kept even in
  // auto mode. Video fields that would feed a library-resolved slot (or are
  // completely orphaned) are removed so the form isn't cluttered.
  const sequenceManualSlotBindings = new Set(
    (json.videoSequence ?? [])
      .filter((s) => s.binding && !s.libraryId) // explicit binding, no library
      .map((s) => s.binding as string),
  );
  // When generationMode is "auto" and videoSequence handles videos, remove orphan video fields
  const finalSchema = autoMode && (json.videoSequence?.length ?? 0) > 0
    ? mergedSchema.filter((f) => {
        if (f.type !== "video") return true;
        // Keep only video fields that feed a manual sequence slot
        return sequenceManualSlotBindings.has(f.key);
      })
    : mergedSchema;

  return (
    <div className="px-4 py-8 xl:px-8 max-w-[1680px] mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">
          {initialValues ? "Nouvelle variante" : "Générer un visuel"}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Template : <span className="text-indigo-700 font-medium">{template.name}</span>
          {template.client && ` · ${template.client}`}
          {initialValues && " · formulaire pré-rempli"}
          {autoMode && " · génération automatique"}
        </p>
      </div>
      <ListingForm
        key={accountId ?? ""}
        templateId={templateId}
        schema={finalSchema}
        formSections={json.formSections ?? []}
        mediaFieldAspectRatios={mediaFieldAspectRatios}
        initialValues={initialValues}
        libraryPrefillContext={libraryPrefillContext}
        autoSubmit={autoMode}
      />
    </div>
  );
}
