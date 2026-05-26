import { redirect, notFound } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { MediaAssetsPanel } from "@/components/admin/libraries/MediaAssetsPanel";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

type Props = { params: Promise<{ id: string }> };

export default async function MediaLibraryDetailPage({ params }: Props) {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/templates");
  }

  const { id } = await params;
  const library = await prisma.mediaLibrary.findUnique({ where: { id } });
  if (!library) notFound();

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link href="/admin/libraries/media" className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-6 transition-colors">
        <ChevronLeft size={13} /> Ressources médias
      </Link>
      <MediaAssetsPanel library={{ id: library.id, name: library.name, type: library.type as "video" | "audio", setSequence: library.setSequence, metadataSchema: library.metadataSchema }} />
    </div>
  );
}
