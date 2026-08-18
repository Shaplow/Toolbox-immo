import Link from "next/link";
import { PageShell } from "@/components/ui/PageShell";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Clapperboard, Info, RotateCcw } from "lucide-react";
import { ListingForm } from "@/components/form/ListingForm";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { normalizeTemplateJSON } from "@/lib/templateNormalization";
import type { TemplateJSON, VideoBlock } from "@/types/template";
import { getUserContext } from "@/lib/userContext";
import { buildLibraryPrefillContext } from "@/lib/generate/buildLibraryPrefillContext";
import { buildSlotPrefill } from "@/lib/generate/buildSlotPrefill";
import { SHARED_SENTINEL_IDS } from "@/lib/rotation/sentinels";
import { buildMergedSchema } from "@/lib/generate/buildMergedSchema";
import { customFieldToSchemaField } from "@/lib/customFields";
import { readProvenance, stripProvenance, type ProvenanceMap } from "@/lib/generate/provenance";

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

/** Vrai si le template lie au moins un bloc (vidéo ou musique) ou une DataLibrary. */
function templateUsesLibrary(json: TemplateJSON): boolean {
  return (
    json.blocks.some((b) => (b.type === "video" || b.type === "music") && !!(b as { libraryId?: string }).libraryId) ||
    (json.videoSequence ?? []).some((s) => !!(s as { libraryId?: string }).libraryId) ||
    !!json.contentLibrary?.dataLibraryId ||
    !!json.contentLibrary?.dataCampaignId
  );
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

  // If listingId provided, pre-fill form with its data. `__provenance` (posé
  // au submit par ListingForm) est séparé des valeurs — il pilote la
  // précédence de buildSlotPrefill, pas le contenu du formulaire.
  let existingListingValues: Record<string, unknown> | undefined;
  let existingListingProvenance: ProvenanceMap = {};
  let existingListingFound = false;
  if (listingId) {
    const existingListing = await prisma.listing.findFirst({
      where: userContext.canAdminBypass ? { id: listingId } : { id: listingId, userId },
    });
    if (existingListing) {
      existingListingFound = true;
      const parsed = JSON.parse(existingListing.jsonData) as Record<string, unknown>;
      existingListingProvenance = readProvenance(parsed);
      existingListingValues = stripProvenance(parsed);
    }
  }
  // Listing présent pour banner (le modèle Listing n'a pas de nom propre,
  // donc on affiche juste un label "annonce existante" sans creuser jsonData).
  const hasListingPrefill = !!listingId && existingListingFound;

  const { canAccessTemplate } = await import("@/lib/permissions");
  const ok = userContext.canAdminBypass
    ? true
    : await canAccessTemplate(userId, templateId, userContext.effectiveUser.role);
  if (!ok) notFound();

  const template = await prisma.template.findUnique({ where: { id: templateId } });
  if (!template) notFound();

  const json = normalizeTemplateJSON(JSON.parse(template.jsonData) as TemplateJSON);

  const mergedSchema = buildMergedSchema(json);

  // Phase 5 (métaobjet) + Phase 3 (socle prefill) — fiche data (Entity),
  // fiche tournage (shootEntity) et overrides mission (slot.fields), avec
  // provenance explicite par clé. `mergedSchema` (pré-customFormFields) sert
  // de cible au matching case-insensitive des clés de fiche — voir
  // `buildSlotPrefill`/`matchFieldValue`.
  const slotPrefill = await buildSlotPrefill({
    slotId: slotId ?? null,
    schema: mergedSchema,
    existingValues: existingListingValues,
    existingProvenance: existingListingProvenance,
  });
  if (!accountId) accountId = slotPrefill.accountId;
  let initialValues: Record<string, unknown> | undefined = slotPrefill.initialValues;
  let provenance: ProvenanceMap = slotPrefill.provenance;
  const slotBannerContext = slotPrefill.slotBannerContext;

  // Phase 4 — fusionne les champs perso typés de la fiche absents du template
  // (le template reste prioritaire sur conflit de clé).
  for (const cf of slotPrefill.customFormFields) {
    if (!mergedSchema.some((f) => f.key === cf.key)) {
      mergedSchema.push(customFieldToSchemaField(cf));
    }
  }

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
  // Phase 2.2 : si pas d'accountId ET le template utilise une bibliothèque
  // (MediaLibrary ou DataLibrary), on bloque le prefill SSR ici. Le form
  // affichera un sélecteur compte IG et chargera le prefill côté client via
  // POST /api/templates/[id]/prefill une fois le compte choisi.
  const templateNeedsAccount = templateUsesLibrary(json) && !accountId;

  // Charge la liste des comptes IG pour le dropdown du sélecteur (toujours,
  // même si accountId est déjà connu — permet de changer de compte après coup).
  // Exclut les comptes sentinels (curseurs partagés) qui ne sont pas
  // sélectionnables manuellement.
  const instagramAccounts = await prisma.instagramAccount.findMany({
    where: { id: { notIn: [...SHARED_SENTINEL_IDS] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, handle: true },
  });

  let libraryPrefillContext: import("@/types/libraryPrefill").LibraryPrefillContext | undefined;
  if (!templateNeedsAccount) {
    // accountId connu (ou template sans lib) : prefill SSR normal.
    const { context, updatedInitialValues } = await buildLibraryPrefillContext({
      json,
      mergedSchema,
      initialValues,
      accountId: accountId ?? null,
      slotId: slotId ?? null,
      listingId: listingId ?? null,
      provenance,
    });
    libraryPrefillContext = context;
    initialValues = updatedInitialValues;
    // La boucle DataEntry étend `provenance` (dataEntry) — c'est la map
    // complète qui part au client, pas seulement les couches fiche/mission.
    if (context) provenance = context.prefilledKeys;
  }
  // Sinon : prefill différé côté client après sélection du compte IG.

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
    <PageShell variant="wide">
        {/* Header (icon + titre + subtitle) */}
        <div className="rounded-t-xl overflow-hidden">
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
            <div className="rounded-2xl bg-info-50  px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0 text-[12.5px]">
                <Info size={13} className="text-info-600 shrink-0" />
                <span className="text-info-700">
                  Formulaire pré-rempli depuis{" "}
                  <span className="font-semibold">{prefillSources.join(" + ")}</span>
                </span>
              </div>
              <Link
                href={`/generate/${templateId}`}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-info-700 hover:text-info-700 transition-colors shrink-0"
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
            initialProvenance={provenance}
            libraryPrefillContext={libraryPrefillContext}
            autoSubmit={autoMode}
            instagramAccounts={instagramAccounts}
            templateNeedsAccount={templateNeedsAccount}
            /* Portés explicitement : `libraryPrefillContext` est undefined quand
               le template n'a aucun binding bibliothèque, et perd `slotId` au
               changement de compte — le rendu partait alors sans compte ni slot. */
            accountId={accountId}
            slotId={slotId}
          />
        </div>
    </PageShell>
  );
}
