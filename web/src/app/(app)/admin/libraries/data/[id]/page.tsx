import { redirect, notFound } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { DataCampaignsPanel } from "@/components/admin/libraries/DataCampaignsPanel";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

type Props = { params: Promise<{ id: string }> };

export default async function DataLibraryDetailPage({ params }: Props) {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/tools/templates");
  }

  const { id } = await params;
  const library = await prisma.dataLibrary.findUnique({ where: { id } });
  if (!library) notFound();

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link href="/admin/libraries/data" className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-6 transition-colors">
        <ChevronLeft size={13} /> Ressources données
      </Link>
      <DataCampaignsPanel libraryId={library.id} libraryName={library.name} />
    </div>
  );
}
