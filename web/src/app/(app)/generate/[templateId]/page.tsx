import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { ListingForm } from "@/components/form/ListingForm";
import { collectTemplateConditionValues, normalizeTemplateJSON } from "@/lib/templateNormalization";
import type { TemplateJSON, MusicBlock } from "@/types/template";
import { DPE_AUTO_FIELDS } from "@/lib/renderer/blocks/renderDPEBlock";
import { getUserContext } from "@/lib/userContext";
import { resolveLibraryPrefill } from "@/lib/contentLibraryResolver";
import type { LibraryPrefillContext } from "@/types/libraryPrefill";

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
  searchParams: Promise<{ listingId?: string }>;
};

export default async function GeneratePage({ params, searchParams }: Props) {
  const { templateId } = await params;
  const { listingId } = await searchParams;
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
  const mediaFieldAspectRatios = buildMediaFieldAspectRatios(json);

  // ─── Content Library pre-fill ──────────────────────────────────────────────
  let libraryPrefillContext: LibraryPrefillContext | undefined;
  const hasLibraryBindings =
    json.blocks.some((b) => (b.type === "video" || b.type === "music") && b.libraryId) ||
    !!json.contentLibrary?.dataCampaignId;

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
    const musicBlock = json.blocks.find((b): b is MusicBlock => b.type === "music" && !!b.libraryId);
    if (musicBlock?.binding && musicBlock.libraryId) {
      const rule = musicBlock.audioSelectionRule;
      const tagFilterParam = (typeof rule === "object" && rule !== null && "tagFilterParam" in rule)
        ? (rule as { tagFilterParam?: string }).tagFilterParam
        : undefined;
      fieldLibraryMap[musicBlock.binding] = { libraryId: musicBlock.libraryId, blockId: musicBlock.id, type: "audio" as const, tagFilterParam };
    }

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
      // Fresh generation: use resolveLibraryPrefill
      const prefill = await resolveLibraryPrefill(json, initialValues ?? undefined);

      for (const block of json.blocks) {
        if (block.type === "video" && block.binding && block.libraryId) {
          const suggestion = prefill.videoSuggestions[block.id] ?? null;
          initialSuggestions[block.binding] = suggestion;
          if (suggestion) initialValues = { ...initialValues, [block.binding]: suggestion.url };
        }
      }
      if (musicBlock?.binding && musicBlock.libraryId) {
        initialSuggestions[musicBlock.binding] = prefill.audioSuggestion ?? null;
        if (prefill.audioSuggestion) initialValues = { ...initialValues, [musicBlock.binding]: prefill.audioSuggestion.url };
      }
      if (prefill.dataSuggestion) {
        for (const [key, value] of Object.entries(prefill.dataSuggestion.fields)) {
          initialValues = { ...initialValues, [key]: value };
          prefilledDataKeys.push(key);
        }
        dataSuggestion = prefill.dataSuggestion;
      }
    }

    libraryPrefillContext = { fieldLibraryMap, initialSuggestions, prefilledDataKeys, dataSuggestion };
  }

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
        </p>
      </div>
      <ListingForm
        templateId={templateId}
        schema={mergedSchema}
        formSections={json.formSections ?? []}
        mediaFieldAspectRatios={mediaFieldAspectRatios}
        initialValues={initialValues}
        libraryPrefillContext={libraryPrefillContext}
      />
    </div>
  );
}
