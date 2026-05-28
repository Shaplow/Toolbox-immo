import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Instagram, Film, Database, ArrowRight } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { AccountPatternsList } from "@/components/admin/AccountPatternsList";

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

  const account = await prisma.instagramAccount.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      accountPatterns: {
        orderBy: [{ publishTime: "asc" }, { label: "asc" }],
        include: {
          template: { select: { id: true, name: true } },
          defaultAssigneeMonteur: { select: { id: true, name: true } },
          defaultAssigneeCm: { select: { id: true, name: true } },
          _count: { select: { publicationSlots: true } },
        },
      },
    },
  });

  if (!account) notFound();

  // Bibliothèques média accessibles : on agrège via MediaAssetAccess (entrées
  // explicites) + libs avec assets globaux (0 access). Ordre : libs explicitement
  // partagées avec ce compte d'abord. Le compte d'usages permet de signaler les
  // libs "vivantes" pour ce compte.
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

  return (
    <div className="p-8 max-w-screen-xl mx-auto">
      {/* Breadcrumb */}
      <Link
        href={account.client ? `/admin/clients/${account.client.id}?tab=accounts` : "/admin/clients"}
        className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-6 transition-colors"
      >
        <ChevronLeft size={13} />
        {account.client?.name ?? "Clients"}
      </Link>

      {/* Header */}
      <ToolPageHeader
        icon={Instagram}
        iconColor="indigo"
        title={`@${account.handle}`}
        subtitle={`${account.client?.name ?? "Sans client"}`}
      />

      {/* Section Patterns */}
      <AccountPatternsList
        account={{ id: account.id, handle: account.handle }}
        patterns={account.accountPatterns}
      />

      {/* Section Bibliothèques liées — visibilité claire de ce que ce compte
           a accès à consommer. Approche "1 lib par compte" : on liste celles
           accessibles, l'idée est qu'il n'y en ait qu'une par type à terme. */}
      <section className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Bibliothèques liées</h2>
          <Link
            href="/admin/libraries"
            className="text-xs text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1"
          >
            Hub ressources <ArrowRight size={11} />
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Médias */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-8 h-8 rounded-lg bg-violet-50 border border-violet-200 flex items-center justify-center">
                <Film size={14} className="text-violet-600" />
              </span>
              <div>
                <p className="text-sm font-medium text-gray-900">Médias</p>
                <p className="text-[11px] text-gray-400">
                  {mediaLibrariesAccessible.length === 0
                    ? "Aucune bibliothèque accessible — crée-en une"
                    : mediaLibrariesAccessible.length === 1
                    ? "1 bibliothèque (configuration idéale)"
                    : `${mediaLibrariesAccessible.length} bibliothèques — pense à n'en garder qu'une`}
                </p>
              </div>
            </div>
            {mediaLibrariesAccessible.length > 0 ? (
              <ul className="space-y-1.5">
                {mediaLibrariesAccessible.slice(0, 4).map((lib) => (
                  <li key={lib.id}>
                    <Link
                      href={`/admin/libraries/media/${lib.id}`}
                      className="flex items-center justify-between px-2 py-1.5 rounded-lg border border-gray-100 hover:border-violet-300 hover:bg-violet-50/40 transition-colors group"
                    >
                      <span className="text-xs font-medium text-gray-700 group-hover:text-violet-700 truncate">
                        {lib.name}
                      </span>
                      <span className="text-[10px] text-gray-400 shrink-0 ml-2">
                        {lib._count.assets} asset{lib._count.assets !== 1 ? "s" : ""} · {lib.type}
                      </span>
                    </Link>
                  </li>
                ))}
                {mediaLibrariesAccessible.length > 4 && (
                  <li className="text-[11px] text-gray-400 italic px-2">
                    + {mediaLibrariesAccessible.length - 4} autres
                  </li>
                )}
              </ul>
            ) : (
              <Link
                href="/admin/libraries/media"
                className="block text-center text-xs text-violet-600 hover:text-violet-800 border border-dashed border-violet-200 rounded-lg py-2"
              >
                + Créer la bibliothèque média de ce compte
              </Link>
            )}
          </div>
          {/* Données */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                <Database size={14} className="text-emerald-600" />
              </span>
              <div>
                <p className="text-sm font-medium text-gray-900">Données</p>
                <p className="text-[11px] text-gray-400">
                  {dataLibrariesAccessible.length === 0
                    ? "Aucune bibliothèque accessible — crée-en une"
                    : dataLibrariesAccessible.length === 1
                    ? "1 bibliothèque (configuration idéale)"
                    : `${dataLibrariesAccessible.length} bibliothèques — pense à n'en garder qu'une`}
                </p>
              </div>
            </div>
            {dataLibrariesAccessible.length > 0 ? (
              <ul className="space-y-1.5">
                {dataLibrariesAccessible.slice(0, 4).map((lib) => (
                  <li key={lib.id}>
                    <Link
                      href={`/admin/libraries/data/${lib.id}`}
                      className="flex items-center justify-between px-2 py-1.5 rounded-lg border border-gray-100 hover:border-emerald-300 hover:bg-emerald-50/40 transition-colors group"
                    >
                      <span className="text-xs font-medium text-gray-700 group-hover:text-emerald-700 truncate">
                        {lib.name}
                      </span>
                      <span className="text-[10px] text-gray-400 shrink-0 ml-2">
                        {lib._count.campaigns} campagne{lib._count.campaigns !== 1 ? "s" : ""} · {lib.templateType}
                      </span>
                    </Link>
                  </li>
                ))}
                {dataLibrariesAccessible.length > 4 && (
                  <li className="text-[11px] text-gray-400 italic px-2">
                    + {dataLibrariesAccessible.length - 4} autres
                  </li>
                )}
              </ul>
            ) : (
              <Link
                href="/admin/libraries/data"
                className="block text-center text-xs text-emerald-600 hover:text-emerald-800 border border-dashed border-emerald-200 rounded-lg py-2"
              >
                + Créer la bibliothèque données de ce compte
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* F3.3 — Lien direct vers le calendrier filtré (la section "Slots récents"
           placeholder a été retirée car elle donnait l'impression d'une feature
           inachevée). */}
      <div className="mt-10 pt-6 border-t border-gray-100">
        <Link
          href={`/calendar?accountId=${account.id}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
        >
          Voir les slots de ce compte dans le calendrier →
        </Link>
      </div>
    </div>
  );
}
