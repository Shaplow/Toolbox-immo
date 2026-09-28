import Link from "next/link";
import { PageShell } from "@/components/ui/PageShell";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Clapperboard, Info, RotateCcw } from "lucide-react";
import { ListingForm } from "@/components/form/ListingForm";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { normalizeTemplateJSON } from "@/lib/templateNormalization";
import type { TemplateJSON } from "@/types/template";
import { getUserContext } from "@/lib/userContext";
import { buildGenerationFormModel } from "@/lib/generate/generationFormModel";
import { SHARED_SENTINEL_IDS } from "@/lib/rotation/sentinels";
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

  // Modèle de formulaire partagé page ↔ lot (garantie de parité, plan
  // « lancer les rendus depuis le calendrier », étape 4) — reprend TEL QUEL
  // l'enchaînement buildMergedSchema → buildSlotPrefill → customFormFields →
  // relaxation vidéos metadata-driven → ig_account → buildLibraryPrefillContext
  // → finalSchema (auto-mode).
  const model = await buildGenerationFormModel({
    json,
    slotId: slotId ?? null,
    accountId: accountId ?? null,
    listingId: listingId ?? null,
    existingValues: existingListingValues,
    existingProvenance: existingListingProvenance,
  });
  accountId = model.accountId ?? undefined;
  const initialValues: Record<string, unknown> | undefined = model.initialValues;
  const provenance: ProvenanceMap = model.provenance;
  const slotBannerContext = model.slotBannerContext;
  const templateNeedsAccount = model.templateNeedsAccount;
  const libraryPrefillContext = model.context;
  const finalSchema = model.finalSchema;

  const mediaFieldAspectRatios = buildMediaFieldAspectRatios(json);

  // Charge la liste des comptes IG pour le dropdown du sélecteur (toujours,
  // même si accountId est déjà connu — permet de changer de compte après coup).
  // Exclut les comptes sentinels (curseurs partagés) qui ne sont pas
  // sélectionnables manuellement.
  const instagramAccounts = await prisma.instagramAccount.findMany({
    where: { id: { notIn: [...SHARED_SENTINEL_IDS] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, handle: true },
  });

  const autoMode = json.generationMode === "auto";

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
