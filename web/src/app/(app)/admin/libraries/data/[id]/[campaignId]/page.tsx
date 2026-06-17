import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { DataEntriesPanel } from "@/components/admin/libraries/DataEntriesPanel";

type Props = { params: Promise<{ id: string; campaignId: string }> };

export default async function DataCampaignDetailPage({ params }: Props) {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/templates");
  }

  const { id, campaignId } = await params;
  const [library, campaign] = await Promise.all([
    prisma.dataLibrary.findUnique({ where: { id } }),
    prisma.dataCampaign.findUnique({
      where: { id: campaignId },
      include: { _count: { select: { entries: true } } },
    }),
  ]);
  if (!library || !campaign || campaign.libraryId !== id) notFound();

  return (
    <div className="min-h-screen">
      <div
        className="mx-auto max-w-[1400px] px-6 py-8"
      >
        <div className="rounded-t-3xl overflow-hidden">
          <div className="max-w-6xl mx-auto px-6 sm:px-8 pt-6 pb-2">
            <nav className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-3 flex-wrap">
              <Link
                href={`/admin/libraries/data/${id}`}
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <ChevronLeft size={10} className="flex-shrink-0" />
                {library.name}
              </Link>
            </nav>

            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
                  Médiathèque · Données · {library.templateType} · Campagne
                </p>
                <h1 className="mt-2 text-[36px] sm:text-[44px] font-semibold tracking-tight text-foreground leading-[1.05]">
                  {campaign.name}
                </h1>
                <p className="mt-2 text-[13px] text-muted-foreground">
                  {campaign._count.entries} entrée
                  {campaign._count.entries !== 1 ? "s" : ""}
                </p>
              </div>

              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-card border border-border ">
                {campaign.isActive ? (
                  <>
                    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-success-600 shadow-[0_0_6px_rgba(111,162,128,0.6)]" />
                    <span className="text-[11px] font-mono text-foreground">Active</span>
                  </>
                ) : (
                  <>
                    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-gray-400" />
                    <span className="text-[11px] font-mono text-foreground">Inactive</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="pt-6 md:pt-8 pb-12 px-4 sm:px-6 md:px-8">
          <div className="max-w-6xl mx-auto">
            <DataEntriesPanel campaignId={campaignId} libraryId={id} />
          </div>
        </div>
      </div>
    </div>
  );
}
