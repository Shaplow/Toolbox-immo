import { redirect, notFound } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { DataEntriesPanel } from "@/components/admin/libraries/DataEntriesPanel";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

type Props = { params: Promise<{ id: string; campaignId: string }> };

export default async function DataCampaignDetailPage({ params }: Props) {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/tools/templates");
  }

  const { id, campaignId } = await params;
  const [library, campaign] = await Promise.all([
    prisma.dataLibrary.findUnique({ where: { id } }),
    prisma.dataCampaign.findUnique({ where: { id: campaignId } }),
  ]);
  if (!library || !campaign || campaign.libraryId !== id) notFound();

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <Link href={`/admin/libraries/data/${id}`} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-6">
        <ChevronLeft size={14} /> {library.name}
      </Link>
      <DataEntriesPanel campaignId={campaignId} libraryId={id} />
    </div>
  );
}
