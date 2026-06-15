import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { DataEntriesPanel } from "@/components/admin/libraries/DataEntriesPanel";
import { CursorSectionForLibrary } from "@/components/admin/libraries/CursorSectionForLibrary";

type Props = { params: Promise<{ id: string }> };

export default async function DataLibraryDetailPage({ params }: Props) {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/templates");
  }

  const { id } = await params;
  const library = await prisma.dataLibrary.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      templateType: true,
      description: true,
      fieldsSchema: true,
      // Phase 1.x — UX simplification : la lib expose désormais directement
      // sa campagne active (concept invisible côté UI). On la résout côté serveur
      // pour éviter un second fetch côté client.
      campaigns: {
        where: { isActive: true },
        select: { id: true },
        take: 1,
      },
      _count: { select: { campaigns: true } },
      rotationScope: true,
    },
  });
  if (!library) notFound();

  // Migration douce : libs créées avant Phase 1.x peuvent ne pas avoir de
  // campagne active. On en crée une silencieusement au premier accès.
  let activeCampaignId = library.campaigns[0]?.id;
  if (!activeCampaignId) {
    const created = await prisma.dataCampaign.create({
      data: {
        libraryId: library.id,
        name: "Default",
        isActive: true,
        usagePolicy: "unlimited",
      },
      select: { id: true },
    });
    activeCampaignId = created.id;
  }

  return (
    <div className="min-h-screen">
      <div
        className="my-11 ml-[60px] mr-[100px] rounded-3xl min-h-[calc(100vh-5.5rem)] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.10)]"
        style={{
          background: "var(--gradient-page-shell)",
        }}
      >
        <div className="rounded-t-3xl overflow-hidden">
          <div className="max-w-6xl mx-auto px-6 sm:px-8 pt-6 pb-2">
            <nav className="flex items-center gap-1.5 text-[10px] text-gray-400 mb-3 flex-wrap">
              <Link
                href="/admin/libraries/data"
                className="inline-flex items-center gap-1 hover:text-gray-700 transition-colors"
              >
                <ChevronLeft size={10} className="flex-shrink-0" />
                Bibliothèques données
              </Link>
            </nav>

            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
                  Médiathèque · Données · {library.templateType}
                </p>
                <h1 className="mt-2 text-[36px] sm:text-[44px] font-semibold tracking-tight text-gray-950 leading-[1.05]">
                  {library.name}
                </h1>
                {library.description && (
                  <p className="mt-2 text-[13px] text-gray-500">{library.description}</p>
                )}
              </div>

              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white/55 backdrop-blur-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sage-500 shadow-[0_0_6px_rgba(111,162,128,0.6)]" />
                <span className="text-[11px] font-mono text-gray-700 tabular-nums">
                  {library.templateType}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-6 md:pt-8 pb-12 px-4 sm:px-6 md:px-8 space-y-10">
          {/* Pas de max-w ici : la spreadsheet utilise toute la largeur disponible
              pour pouvoir scroller horizontalement sur les schémas lourds (RPI = 177 cols). */}
          <DataEntriesPanel
            campaignId={activeCampaignId}
            libraryId={library.id}
            fieldsSchema={library.fieldsSchema}
          />

          {/* Curseurs de rotation — symétrique fiche MediaLibrary. */}
          <div className="max-w-6xl mx-auto">
            <CursorSectionForLibrary
              libraryId={library.id}
              libraryType="data"
              rotationScope={
                library.rotationScope === "shared" ? "shared" : "per_account"
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
