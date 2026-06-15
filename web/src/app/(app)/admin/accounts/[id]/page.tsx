import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Film, Database, ArrowRight, CalendarDays, Instagram } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { AccountBindingsList } from "@/components/admin/AccountBindingsList";
import { AccountCursorsButton } from "@/components/admin/AccountCursorsButton";

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

  // P2 — la fiche compte n'expose plus AccountPattern legacy (drop net).
  // Les recettes liées sont gérées via PatternBinding + AccountBindingsList.
  // Le modèle Prisma AccountPattern reste conservé pour la rétrocompat des
  // slots historiques (shims dans createSlot/bulkStockSlots).
  const account = await prisma.instagramAccount.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      patternBindings: {
        orderBy: [{ publishTime: "asc" }],
        include: {
          patternTemplate: { select: { id: true, label: true, source: true } },
          defaultAssigneeMonteur: { select: { id: true, name: true } },
          defaultAssigneeCm: { select: { id: true, name: true } },
          defaultAssigneeVideaste: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!account) notFound();

  // P2 — Données pour AccountBindingsList (catalogue + listes d'assignés).
  // Sprint B — `builderTemplates` ajouté pour permettre la création de
  // recette inline depuis le picker (cascade PatternTemplateForm).
  const [
    catalogTemplates,
    builderTemplates,
    monteurUsers,
    cmUsers,
    videasteUsers,
    captionPresets,
    descriptionPrompts,
  ] = await Promise.all([
    prisma.patternTemplate.findMany({
      where: { isArchived: false },
      select: { id: true, label: true, source: true },
      orderBy: [{ source: "asc" }, { label: "asc" }],
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

  // Drop net P2 : fetch des dernières vidéos par template retiré
  // (uniquement utilisé par AccountPatternsList legacy qui a été supprimée).

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

  // P2 — KPI piloté désormais par patternBindings (recettes liées) au lieu
  // de l'ancien AccountPattern legacy.
  const activeRecipesCount = account.patternBindings.filter((b) => b.isActive).length;
  const totalRecipesCount = account.patternBindings.length;
  // Phase 9 V2 — breadcrumb hiérarchique (Admin › Comptes/Clients › @handle).
  // Permet de remonter à l'index amont d'un clic sans repasser par le menu.
  const breadcrumbTrail: { href: string; label: string }[] = account.client
    ? [
        { href: "/admin/clients", label: "Clients" },
        {
          href: `/admin/clients/${account.client.id}?tab=accounts`,
          label: account.client.name,
        },
      ]
    : [{ href: "/admin/accounts", label: "Comptes Instagram" }];

  return (
    <div className="min-h-screen">
      <div
        className="my-11 ml-[60px] mr-[100px] rounded-3xl min-h-[calc(100vh-5.5rem)] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.10)]"
        style={{
          background: "var(--gradient-page-shell)",
        }}
      >
        {/* Header Control Center */}
        <div className="rounded-t-3xl overflow-hidden">
          <div className="max-w-6xl mx-auto px-6 sm:px-8 pt-6 pb-2">
            {/* Phase 9 V2 — breadcrumb hiérarchique (Admin › … › @handle). */}
            <nav
              aria-label="Fil d'Ariane"
              className="flex items-center gap-1.5 text-[11px] text-gray-500 mb-3 flex-wrap"
            >
              <Link
                href="/home"
                className="inline-flex items-center gap-1 hover:text-gray-800 transition-colors"
              >
                <ChevronLeft size={11} className="flex-shrink-0" />
                Admin
              </Link>
              {breadcrumbTrail.map((step) => (
                <span
                  key={step.href}
                  className="inline-flex items-center gap-1.5"
                >
                  <span className="text-gray-300">/</span>
                  <Link
                    href={step.href}
                    className="hover:text-gray-800 transition-colors"
                  >
                    {step.label}
                  </Link>
                </span>
              ))}
              <span className="text-gray-300">/</span>
              <span className="text-gray-700 font-medium">@{account.handle}</span>
            </nav>

            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
                  Planification · Compte Instagram
                </p>
                <h1 className="mt-2 text-[36px] sm:text-[44px] font-semibold tracking-tight text-gray-950 leading-[1.05]">
                  @{account.handle}
                </h1>
                <p className="mt-2 text-[13px] text-gray-500">
                  {account.name}
                  {account.client && (
                    <>
                      {" · "}
                      <Link
                        href={`/admin/clients/${account.client.id}?tab=accounts`}
                        className="hover:text-gray-700 transition-colors"
                      >
                        {account.client.name}
                      </Link>
                    </>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Live pill */}
                <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white/55 backdrop-blur-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-rose-400 shadow-[0_0_6px_rgba(201,113,133,0.6)]" />
                  <span className="text-[11px] font-mono text-gray-700 tabular-nums">
                    {activeRecipesCount}/{totalRecipesCount} recettes actives
                  </span>
                </div>

                {/* Sprint D — bouton curseurs cross-libs */}
                <AccountCursorsButton
                  accountId={account.id}
                  accountHandle={account.handle}
                />

                {/* Lien rapide calendar */}
                <Link
                  href={`/calendar?accountId=${account.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/55 backdrop-blur-[12px] text-gray-700 hover:text-gray-950 text-[11px] font-medium shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.12),0_2px_6px_rgba(15,23,42,0.06)] transition-all"
                  title="Voir les slots de ce compte dans le calendrier"
                >
                  <CalendarDays size={12} />
                  Calendrier
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Inner content */}
        <div className="pt-6 md:pt-8 pb-12 px-4 sm:px-6 md:px-8">
          <div className="max-w-6xl mx-auto space-y-8">
            {/* Section "Recettes liées" (P2 — nouveau modèle) */}
            <AccountBindingsList
              accountId={account.id}
              accountHandle={account.handle}
              initialBindings={account.patternBindings.map((b) => ({
                id: b.id,
                patternTemplateId: b.patternTemplateId,
                templateLabel: b.patternTemplate.label,
                templateSource: b.patternTemplate.source,
                customLabel: b.customLabel,
                dayOfWeek: b.dayOfWeek,
                publishTime: b.publishTime,
                isActive: b.isActive,
                defaultAssigneeMonteurName: b.defaultAssigneeMonteur?.name ?? null,
                defaultAssigneeCmName: b.defaultAssigneeCm?.name ?? null,
                defaultAssigneeVideasteName: b.defaultAssigneeVideaste?.name ?? null,
              }))}
              catalogTemplates={catalogTemplates}
              builderTemplates={builderTemplates}
              monteurs={monteurUsers.map((u) => ({ id: u.id, name: u.name }))}
              cms={cmUsers.map((u) => ({ id: u.id, name: u.name }))}
              videastes={videasteUsers.map((u) => ({ id: u.id, name: u.name }))}
              captionPresets={captionPresets}
              descriptionPrompts={descriptionPrompts}
            />

            {/* Section Bibliothèques liées */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
                    Ressources liées
                  </p>
                  <p className="text-[13px] font-semibold tracking-tight text-gray-950 mt-1">
                    Bibliothèques accessibles
                  </p>
                </div>
                <Link
                  href="/admin/libraries"
                  className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-950 transition-colors"
                >
                  Hub Médiathèque
                  <ArrowRight size={11} />
                </Link>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <LibraryCard
                  icon={Film}
                  tint="sky"
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
                  tint="sage"
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

        {/* Décor Instagram subtle en fond bottom-right */}
        <div className="absolute bottom-8 right-8 pointer-events-none opacity-[0.04]" aria-hidden>
          <Instagram size={120} className="text-gray-950" />
        </div>
      </div>
    </div>
  );
}

// ─── LibraryCard ────────────────────────────────────────────────────────────

interface LibraryCardProps {
  icon: typeof Film;
  tint: "sky" | "sage" | "peach" | "rose";
  label: string;
  count: number;
  countSuffix: string;
  emptyHref: string;
  emptyLabel: string;
  items: Array<{ id: string; href: string; label: string; meta: string }>;
  overflow: number;
}

const LIBRARY_TINT: Record<LibraryCardProps["tint"], string> = {
  sky: "bg-sky-100/70 text-sky-700",
  sage: "bg-sage-100/70 text-sage-700",
  peach: "bg-peach-100/70 text-peach-700",
  rose: "bg-rose-100/70 text-rose-700",
};

function LibraryCard({
  icon: Icon,
  tint,
  label,
  count,
  countSuffix,
  emptyHref,
  emptyLabel,
  items,
  overflow,
}: LibraryCardProps) {
  return (
    <div className="rounded-2xl bg-gradient-to-b from-white/75 to-white/55 backdrop-blur-[8px] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_8px_-2px_rgba(15,23,42,0.06)]">
      <div className="flex items-center gap-2.5 mb-4">
        <span className={`shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md ${LIBRARY_TINT[tint]}`}>
          <Icon size={14} />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-gray-950 leading-tight">{label}</p>
          <p className="text-[10.5px] uppercase tracking-widest font-medium text-gray-400 mt-0.5">
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
                className="group flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white/60 backdrop-blur-[6px] hover:bg-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.1)] transition-all"
              >
                <span className="text-[12.5px] font-medium text-gray-800 group-hover:text-gray-950 truncate">
                  {item.label}
                </span>
                <span className="text-[10.5px] text-gray-400 font-mono tabular-nums shrink-0">
                  {item.meta}
                </span>
              </Link>
            </li>
          ))}
          {overflow > 0 && (
            <li className="text-[10.5px] text-gray-400 italic px-3">
              + {overflow} autre{overflow > 1 ? "s" : ""}
            </li>
          )}
        </ul>
      ) : (
        <Link
          href={emptyHref}
          className="block text-center text-[12px] text-gray-500 hover:text-gray-950 transition-colors px-4 py-3 rounded-lg bg-white/40 backdrop-blur-[6px] shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)] hover:shadow-[inset_0_0_0_1px_rgba(15,23,42,0.12)]"
        >
          + {emptyLabel}
        </Link>
      )}
    </div>
  );
}
