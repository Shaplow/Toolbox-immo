import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Clapperboard, Info, RotateCcw } from "lucide-react";
import { ListingForm } from "@/components/form/ListingForm";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
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
  // + capture context for banner (title, account handle).
  let slotBannerContext: { title: string | null; handle: string } | null = null;
  if (slotId) {
    const slot = await prisma.publicationSlot.findFirst({
      where: { id: slotId },
      select: {
        accountId: true,
        fields: true,
        title: true,
        account: { select: { handle: true } },
      },
    });
    if (slot) {
      if (!accountId) accountId = slot.accountId;
      slotBannerContext = { title: slot.title, handle: slot.account.handle };
      try {
        const slotFields = JSON.parse(slot.fields) as Record<string, string>;
        // Slot fields are base values; listingId data (if any) takes precedence
        initialValues = { ...slotFields, ...initialValues };
      } catch { /* ignore malformed JSON */ }
    }
  }

  // Listing présent pour banner (le modèle Listing n'a pas de nom propre,
  // donc on affiche juste un label "annonce existante" sans creuser jsonData).
  const hasListingPrefill = !!listingId && !!initialValues;

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
  // Auto-injecte le handle IG dans formData["ig_account"] si le template
  // déclare ce champ. Utile pour les conditions de tag fromParam=true qui
  // pointent sur ig_account, ou pour un usage textuel direct dans le rendu.
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
      accountId: accountId ?? null,
      slotId: slotId ?? null,
      listingId: listingId ?? null,
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

  const subtitleParts: string[] = [`Template : ${template.name}`];
  if (template.client) subtitleParts.push(template.client);
  if (autoMode) subtitleParts.push("génération automatique");

  // Sources de pré-remplissage pour le bandeau (Phase nav 2026-05-28).
  // Avant : "formulaire pré-rempli" en subtitle, peu visible. Maintenant
  // banner explicite avec source + bouton "Repartir vierge".
  const prefillSources: string[] = [];
  if (slotBannerContext) {
    prefillSources.push(
      `slot ${slotBannerContext.title ?? `@${slotBannerContext.handle}`}`,
    );
  }
  if (hasListingPrefill) prefillSources.push("une annonce existante");
  const hasPrefill = prefillSources.length > 0;

  return (
    <div className="min-h-screen">
      <div
        className="my-11 ml-[60px] mr-[100px] rounded-3xl min-h-[calc(100vh-5.5rem)] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.10)]"
        style={{ background: "var(--gradient-page-shell)" }}
      >
        {/* Header (icon + titre + subtitle) */}
        <div className="rounded-t-3xl overflow-hidden">
          <div className="px-6 sm:px-8 pt-6 pb-2">
            <ToolPageHeader
              icon={Clapperboard}
              iconColor="peach"
              title={initialValues ? "Nouvelle variante" : "Générer un visuel"}
              subtitle={subtitleParts.join(" · ")}
            />
          </div>
        </div>

        {/* Banner prérempli glass v2 — apparaît juste sous le header si applicable */}
        {hasPrefill && (
          <div className="px-6 sm:px-8 pb-3">
            <div className="rounded-2xl bg-gradient-to-b from-sky-50/85 to-sky-50/55 backdrop-blur-[10px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(125,180,210,0.32)] px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0 text-[12.5px]">
                <Info size={13} className="text-sky-600 shrink-0" />
                <span className="text-sky-900">
                  Formulaire pré-rempli depuis{" "}
                  <span className="font-semibold">{prefillSources.join(" + ")}</span>
                </span>
              </div>
              <Link
                href={`/generate/${templateId}`}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 hover:text-sky-900 transition-colors shrink-0"
                title="Charger le formulaire sans pré-remplissage"
              >
                <RotateCcw size={11} />
                Repartir vierge
              </Link>
            </div>
          </div>
        )}

        {/* Body : form */}
        <div className="px-4 sm:px-6 md:px-8 pt-2 pb-12">
          <ListingForm
            key={accountId ?? ""}
            templateId={templateId}
            currentUserId={userId}
            schema={finalSchema}
            formSections={json.formSections ?? []}
            mediaFieldAspectRatios={mediaFieldAspectRatios}
            initialValues={initialValues}
            libraryPrefillContext={libraryPrefillContext}
            autoSubmit={autoMode}
          />
        </div>
      </div>
    </div>
  );
}
