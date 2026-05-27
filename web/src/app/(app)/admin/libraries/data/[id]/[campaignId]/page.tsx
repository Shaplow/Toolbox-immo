import { redirect, notFound } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { DataEntriesPanel } from "@/components/admin/libraries/DataEntriesPanel";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Props = { params: Promise<{ id: string; campaignId: string }> };

export default async function DataCampaignDetailPage({ params }: Props) {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/templates");
  }

  const { id, campaignId } = await params;
  const [library, campaign] = await Promise.all([
    prisma.dataLibrary.findUnique({ where: { id } }),
    prisma.dataCampaign.findUnique({ where: { id: campaignId } }),
  ]);
  if (!library || !campaign || campaign.libraryId !== id) notFound();

  // Breadcrumb complet : Ressources > Données > [Library] > [Campaign]
  const breadcrumb = [
    { href: "/admin/libraries", label: "Ressources" },
    { href: "/admin/libraries/data", label: "Données" },
    { href: `/admin/libraries/data/${id}`, label: library.name },
  ];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6 space-y-1.5">
        <Link
          href={`/admin/libraries/data/${id}`}
          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          <ChevronLeft size={14} /> {library.name}
        </Link>
        <nav className="flex items-center gap-1 text-xs text-gray-400 flex-wrap">
          {breadcrumb.map((item) => (
            <span key={item.href} className="flex items-center gap-1">
              <Link
                href={item.href}
                className="hover:text-indigo-600 transition-colors truncate max-w-[200px]"
              >
                {item.label}
              </Link>
              <ChevronRight size={11} className="text-gray-300" />
            </span>
          ))}
          <span className="text-gray-600 font-medium truncate max-w-[240px]">
            {campaign.name}
          </span>
        </nav>
      </div>
      <DataEntriesPanel campaignId={campaignId} libraryId={id} />
    </div>
  );
}
