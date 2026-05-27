import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { ListingForm } from "@/components/form/ListingForm";
import { collectTemplateConditionValues, normalizeTemplateJSON } from "@/lib/templateNormalization";
import type { TemplateJSON, VideoBlock } from "@/types/template";
import { DPE_AUTO_FIELDS } from "@/lib/renderer/blocks/renderDPEBlock";
import { getUserContext } from "@/lib/userContext";
import { buildLibraryPrefillContext } from "@/lib/generate/buildLibraryPrefillContext";

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

  // ─── Content Library pre-fill (extrait dans le helper Phase 1.9 C2) ────────
  const { context: libraryPrefillContext, updatedInitialValues } =
    await buildLibraryPrefillContext({
      json,
      mergedSchema,
      initialValues,
      accountId,
      slotId,
      listingId,
    });
  initialValues = updatedInitialValues;

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
