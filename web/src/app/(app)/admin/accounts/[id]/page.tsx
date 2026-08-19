import { patternLabel } from "@/lib/services/pattern/resolveEffective";
import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Film, Database, ArrowRight, CalendarDays, Instagram } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { AccountRecipesList, type RecipeItem } from "@/components/admin/AccountRecipesList";
import { PageShell } from "@/components/ui/PageShell";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { KPIPill } from "@/components/ui/molecules/KPIPill";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const account = await prisma.instagramAccount.findUnique({
    where: { id },
    select: { handle: true },
  });
  return { title: `@${account?.handle ?? "Compte"} | Toolbox Immo Admin` };
}

export default async function AccountFichePage({ params }: Props) {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/home");
  }

  const { id } = await params;

  // G.1 — Query enrichie : on flatten PatternTemplate dans chaque PatternBinding
  // pour que l'UI affiche les recettes du compte comme entités unifiées (l'admin
  // ne voit plus la distinction template / binding). On capture aussi le count
  // des bindings de chaque template pour l'indicateur de réutilisation.
  const account = await prisma.instagramAccount.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      patternBindings: {
        orderBy: [{ publishTime: "asc" }],
        include: {
          patternTemplate: {
            include: {
              _count: { select: { bindings: true } },
            },
          },
          defaultAssigneeMonteur: { select: { id: true, name: true } },
          defaultAssigneeCm: { select: { id: true, name: true } },
          defaultAssigneeVideaste: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!account) notFound();

  // Données pour le drawer d'édition (catalogue + listes d'assignés / presets).
  const [
    catalogTemplates,
    videoLibraries,
    builderTemplates,
    monteurUsers,
    cmUsers,
    videasteUsers,
    captionPresets,
    descriptionPrompts,
  ] = await Promise.all([
    prisma.patternTemplate.findMany({
      where: { isArchived: false },
      select: {
        id: true,
        label: true,
        source: true,
        coverMode: true,
        needsCaptionsMode: true,
        needsDescription: true,
        needsAdminValidation: true,
        needsClientValidation: true,
        allowsClientRevision: true,
        needsBrief: true,
        requiresProperty: true,
        requiresEntityTypeId: true,
        templateId: true,
        captionPresetId: true,
        descriptionPromptId: true,
        descriptionSourceFieldKey: true,
        descriptionFixedText: true,
        descriptionDataLibraryId: true,
        descriptionDataSetTag: true,
        autoSaveToLibraryId: true,
        notes: true,
        _count: { select: { bindings: true } },
      },
      orderBy: [{ source: "asc" }, { label: "asc" }],
    }),
    prisma.mediaLibrary.findMany({
      where: { type: "video" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.template.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { role: { in: ["MONTEUR", "ADMIN"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { role: { in: ["CM", "ADMIN"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { role: { in: ["VIDEASTE", "ADMIN"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.captionPreset.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.descriptionPrompt.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const mediaLibrariesAccessible = await prisma.mediaLibrary.findMany({
    where: {
      assets: {
        some: {
          OR: [
            { accesses: { some: { accountId: account.id } } },
            { accesses: { none: {} } },
          ],
        },
      },
    },
    select: {
      id: true,
      name: true,
      type: true,
      _count: { select: { assets: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const dataLibrariesAccessible = await prisma.dataLibrary.findMany({
    where: {
      campaigns: {
        some: {
          entries: {
            some: {
              OR: [
                { accesses: { some: { accountId: account.id } } },
                { accesses: { none: {} } },
              ],
            },
          },
        },
      },
    },
    select: {
      id: true,
      name: true,
      templateType: true,
      _count: { select: { campaigns: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const activeRecipesCount = account.patternBindings.filter((b) => b.isActive).length;
  const totalRecipesCount = account.patternBindings.length;

  // G.1 — flatten binding + template en RecipeItem unique. L'UI consomme
  // une seule structure sans connaître la mécanique template/binding.
  const recipes: RecipeItem[] = account.patternBindings.map((b) => {
    const tpl = b.patternTemplate;
    const overrideCount = [
      b.captionPresetIdOverride,
      b.descriptionPromptIdOverride,
      b.coverModeOverride,
    ].filter((v) => v != null && v !== "").length;
    return {
      id: b.id,
      bindingId: b.id,
      patternTemplateId: b.patternTemplateId,
      label: patternLabel(b),
      // Template fields
      templateLabel: tpl.label,
      source: tpl.source,
      templateId: tpl.templateId,
      coverMode: tpl.coverMode,
      needsCaptionsMode: tpl.needsCaptionsMode,
      needsDescription: tpl.needsDescription,
      needsAdminValidation: tpl.needsAdminValidation,
      needsClientValidation: tpl.needsClientValidation,
      allowsClientRevision: tpl.allowsClientRevision,
      needsBrief: tpl.needsBrief,
      requiresProperty: tpl.requiresProperty,
      requiresEntityTypeId: tpl.requiresEntityTypeId,
      captionPresetId: tpl.captionPresetId,
      descriptionPromptId: tpl.descriptionPromptId,
      descriptionSourceFieldKey: tpl.descriptionSourceFieldKey,
      descriptionFixedText: tpl.descriptionFixedText,
      descriptionDataLibraryId: tpl.descriptionDataLibraryId,
      descriptionDataSetTag: tpl.descriptionDataSetTag,
      autoSaveToLibraryId: tpl.autoSaveToLibraryId,
      templateNotes: tpl.notes,
      // Binding-only
      customLabel: b.customLabel,
      dayOfWeek: b.dayOfWeek,
      publishTime: b.publishTime,
      isActive: b.isActive,
      defaultAssigneeMonteurId: b.defaultAssigneeMonteurId,
      defaultAssigneeCmId: b.defaultAssigneeCmId,
      defaultAssigneeVideasteId: b.defaultAssigneeVideasteId,
      defaultAssigneeMonteurName: b.defaultAssigneeMonteur?.name ?? null,
      defaultAssigneeCmName: b.defaultAssigneeCm?.name ?? null,
      defaultAssigneeVideasteName: b.defaultAssigneeVideaste?.name ?? null,
      captionPresetIdOverride: b.captionPresetIdOverride,
      descriptionPromptIdOverride: b.descriptionPromptIdOverride,
      coverModeOverride: b.coverModeOverride,
      bindingNotes: b.notes,
      hasCaptionPresetOverride: !!b.captionPresetIdOverride,
      hasDescriptionPromptOverride: !!b.descriptionPromptIdOverride,
      hasCoverModeOverride: !!b.coverModeOverride,
      overrideCount,
      sharedWithCount: tpl._count.bindings,
    };
  });

  // Recettes du catalogue PAS encore liées à ce compte → cartes « disponibles »
  // (toggle off). Toutes les recettes sont ainsi présentes par défaut ; activer
  // crée le binding (planning saisi au moment de l'activation).
  const boundTemplateIds = new Set(
    account.patternBindings.map((b) => b.patternTemplateId),
  );
  const availableRecipes: RecipeItem[] = catalogTemplates
    .filter((t) => !boundTemplateIds.has(t.id))
    .map((t) => ({
      id: `tpl-${t.id}`,
      bindingId: null,
      patternTemplateId: t.id,
      label: t.label,
      templateLabel: t.label,
      source: t.source,
      templateId: t.templateId,
      coverMode: t.coverMode,
      needsCaptionsMode: t.needsCaptionsMode,
      needsDescription: t.needsDescription,
      needsAdminValidation: t.needsAdminValidation,
      needsClientValidation: t.needsClientValidation,
      allowsClientRevision: t.allowsClientRevision,
      needsBrief: t.needsBrief,
      requiresProperty: t.requiresProperty,
      requiresEntityTypeId: t.requiresEntityTypeId,
      captionPresetId: t.captionPresetId,
      descriptionPromptId: t.descriptionPromptId,
      descriptionSourceFieldKey: t.descriptionSourceFieldKey,
      descriptionFixedText: t.descriptionFixedText,
      descriptionDataLibraryId: t.descriptionDataLibraryId,
      descriptionDataSetTag: t.descriptionDataSetTag,
      autoSaveToLibraryId: t.autoSaveToLibraryId,
      templateNotes: t.notes,
      customLabel: null,
      dayOfWeek: [],
      publishTime: "",
      isActive: false,
      defaultAssigneeMonteurId: null,
      defaultAssigneeCmId: null,
      defaultAssigneeVideasteId: null,
      defaultAssigneeMonteurName: null,
      defaultAssigneeCmName: null,
      defaultAssigneeVideasteName: null,
      captionPresetIdOverride: null,
      descriptionPromptIdOverride: null,
      coverModeOverride: null,
      bindingNotes: null,
      hasCaptionPresetOverride: false,
      hasDescriptionPromptOverride: false,
      hasCoverModeOverride: false,
      overrideCount: 0,
      sharedWithCount: t._count.bindings,
    }));
  const allRecipes: RecipeItem[] = [...recipes, ...availableRecipes];

  const breadcrumb = account.client ? (
    <>
      <Link href="/admin/clients" className="hover:text-foreground transition-colors inline-flex items-center gap-1">
        <ChevronLeft size={11} /> Clients
      </Link>
      <span className="text-muted-foreground/60">/</span>
      <Link
        href={`/admin/clients/${account.client.id}?tab=accounts`}
        className="hover:text-foreground transition-colors"
      >
        {account.client.name}
      </Link>
      <span className="text-muted-foreground/60">/</span>
      <span className="text-foreground font-medium">@{account.handle}</span>
    </>
  ) : (
    <>
      <Link href="/admin/accounts" className="hover:text-foreground transition-colors inline-flex items-center gap-1">
        <ChevronLeft size={11} /> Comptes Instagram
      </Link>
      <span className="text-muted-foreground/60">/</span>
      <span className="text-foreground font-medium">@{account.handle}</span>
    </>
  );

  return (
    <PageShell variant="wide">
      <div className="px-6 sm:px-8 pt-6 pb-12">
        <ToolPageHeader
          icon={Instagram}
          title={`@${account.handle}`}
          subtitle={account.name}
          breadcrumb={breadcrumb}
          kpis={
            <>
              <KPIPill label="Recettes actives" value={`${activeRecipesCount}/${totalRecipesCount}`} />
            </>
          }
          actions={
            <>
              <Link
                href={`/calendar?accountId=${account.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-card border border-input text-foreground hover:bg-muted text-[12px] font-medium transition-colors"
                title="Voir les slots de ce compte dans le calendrier"
              >
                <CalendarDays size={13} />
                Calendrier
              </Link>
            </>
          }
        />

        <div className="space-y-8">
          <AccountRecipesList
            accountId={account.id}
            accountHandle={account.handle}
            initialRecipes={allRecipes}
            catalogTemplates={catalogTemplates}
            builderTemplates={builderTemplates}
            videoLibraries={videoLibraries}
            monteurs={monteurUsers.map((u) => ({ id: u.id, name: u.name }))}
            cms={cmUsers.map((u) => ({ id: u.id, name: u.name }))}
            videastes={videasteUsers.map((u) => ({ id: u.id, name: u.name }))}
            captionPresets={captionPresets}
            descriptionPrompts={descriptionPrompts}
          />

          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
                Bibliothèques accessibles
              </h2>
              <Link
                href="/admin/libraries"
                className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Hub Médiathèque
                <ArrowRight size={11} />
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <LibraryCard
                icon={Film}
                label="Médias"
                count={mediaLibrariesAccessible.length}
                countSuffix={mediaLibrariesAccessible.length > 1 ? "bibliothèques" : "bibliothèque"}
                emptyHref="/admin/libraries/media"
                emptyLabel="Créer la bibliothèque média de ce compte"
                items={mediaLibrariesAccessible.slice(0, 4).map((lib) => ({
                  id: lib.id,
                  href: `/admin/libraries/media/${lib.id}`,
                  label: lib.name,
                  meta: `${lib._count.assets} ${lib._count.assets !== 1 ? "assets" : "asset"} · ${lib.type}`,
                }))}
                overflow={Math.max(0, mediaLibrariesAccessible.length - 4)}
              />
              <LibraryCard
                icon={Database}
                label="Données"
                count={dataLibrariesAccessible.length}
                countSuffix={dataLibrariesAccessible.length > 1 ? "bibliothèques" : "bibliothèque"}
                emptyHref="/admin/libraries/data"
                emptyLabel="Créer la bibliothèque données de ce compte"
                items={dataLibrariesAccessible.slice(0, 4).map((lib) => ({
                  id: lib.id,
                  href: `/admin/libraries/data/${lib.id}`,
                  label: lib.name,
                  meta: `${lib._count.campaigns} ${lib._count.campaigns !== 1 ? "campagnes" : "campagne"} · ${lib.templateType}`,
                }))}
                overflow={Math.max(0, dataLibrariesAccessible.length - 4)}
              />
            </div>
          </section>
        </div>
      </div>
    </PageShell>
  );
}

interface LibraryCardProps {
  icon: typeof Film;
  label: string;
  count: number;
  countSuffix: string;
  emptyHref: string;
  emptyLabel: string;
  items: Array<{ id: string; href: string; label: string; meta: string }>;
  overflow: number;
}

function LibraryCard({
  icon: Icon,
  label,
  count,
  countSuffix,
  emptyHref,
  emptyLabel,
  items,
  overflow,
}: LibraryCardProps) {
  return (
    <div className="rounded-md bg-card border border-border p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md bg-muted border border-border text-foreground">
          <Icon size={14} />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-foreground leading-tight">{label}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {count === 0 ? "Aucune bibliothèque" : `${count} ${countSuffix}`}
          </p>
        </div>
      </div>

      {items.length > 0 ? (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="group flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-card border border-border hover:bg-muted transition-colors"
              >
                <span className="text-[12.5px] font-medium text-foreground truncate">
                  {item.label}
                </span>
                <span className="text-[10.5px] text-muted-foreground font-mono tabular-nums shrink-0">
                  {item.meta}
                </span>
              </Link>
            </li>
          ))}
          {overflow > 0 && (
            <li className="text-[10.5px] text-muted-foreground italic px-3">
              + {overflow} autre{overflow > 1 ? "s" : ""}
            </li>
          )}
        </ul>
      ) : (
        <Link
          href={emptyHref}
          className="block text-center text-[12px] text-muted-foreground hover:text-foreground transition-colors px-4 py-3 rounded-md bg-card border border-border hover:bg-muted"
        >
          + {emptyLabel}
        </Link>
      )}
    </div>
  );
}
