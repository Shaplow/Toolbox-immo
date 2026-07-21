import { redirect, notFound } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import {
  canAccessMediaLibrary,
  canManageMediaLibraries,
} from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";
import { MediaAssetsPanel } from "@/components/admin/libraries/MediaAssetsPanel";

type Props = { params: Promise<{ id: string }> };

/**
 * /admin/libraries/audio/[id] — wrapper minimal (I.3).
 *
 * MediaAssetsPanel porte désormais le shell (strip + sidebar + grid), pas
 * besoin de big header ici.
 */
export default async function AudioLibraryDetailPage({ params }: Props) {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || !canAccessMediaLibrary(userContext.effectiveUser.role)) {
    redirect("/templates");
  }
  const canManage = canManageMediaLibraries(userContext.effectiveUser.role);

  const { id } = await params;
  const library = await prisma.mediaLibrary.findUnique({
    where: { id },
    include: { _count: { select: { assets: true } } },
  });
  if (!library) notFound();
  if (library.type !== "audio") redirect(`/admin/libraries/media/${id}`);

  return (
    <MediaAssetsPanel
      library={{
        id: library.id,
        name: library.name,
        type: library.type as "video" | "audio",
        setSequence: library.setSequence,
        metadataSchema: library.metadataSchema,
        rotationMode: library.rotationMode,
        rotationScope: library.rotationScope,
        maxUsageCount: library.maxUsageCount,
      }}
      canManageLibraries={canManage}
    />
  );
}
