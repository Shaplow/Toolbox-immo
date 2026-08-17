import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Database } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { DataEntriesPanel } from "@/components/admin/libraries/DataEntriesPanel";

type Props = { params: Promise<{ id: string }> };

/**
 * /admin/libraries/data/[id] — fiche bibliothèque de données (I.3).
 *
 * Shell minimal : strip 40px (breadcrumb + nom) → spreadsheet plein écran.
 * Pas de big header de 180px.
 *
 * Plan simplification Phase 4 : plus de wrapper DataCampaign — les fiches
 * sont rattachées directement à la bibliothèque (DataEntry.libraryId).
 */
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
      rotationMode: true,
    },
  });
  if (!library) notFound();

  return (
    <div className="flex flex-col h-full">
      {/* I.3 — Strip header compact */}
      <header className="shrink-0 sticky top-0 z-20 bg-card border-b border-border">
        <div className="px-4 sm:px-6 py-2 flex items-center gap-3">
          <Link
            href="/admin/libraries/data"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            title="Retour aux bibliothèques de données"
          >
            <ChevronLeft size={12} />
            <span className="hidden sm:inline">Données</span>
          </Link>
          <span className="text-muted-foreground/40">/</span>
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-foreground truncate">
            <Database size={13} className="text-muted-foreground" />
            {library.name}
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-normal ml-1.5">
              {library.templateType}
            </span>
          </span>
        </div>
        {library.description && (
          <div className="px-4 sm:px-6 pb-1.5 text-[11px] text-muted-foreground truncate">
            {library.description}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        <DataEntriesPanel
          libraryId={library.id}
          libraryName={library.name}
          fieldsSchema={library.fieldsSchema}
          rotationMode={library.rotationMode}
        />
      </div>
    </div>
  );
}
