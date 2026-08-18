import { redirect, notFound } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import {
  canViewMediaLibrary,
  canManageMediaAssets,
  canManageMediaLibraries,
} from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";
import { MediaAssetsPanel } from "@/components/admin/libraries/MediaAssetsPanel";

type Props = { params: Promise<{ id: string }> };

/**
 * /admin/libraries/media/[id] — page wrapper minimal.
 *
 * I.2 — Le shell complet (strip header + sidebar + grid + curseurs) est
 * désormais rendu par MediaAssetsPanel. La page SSR ne fait qu'auth + fetch
 * de la lib et passe les props. Le big header de 180px a été retiré : le
 * strip 60px du panel donne tout le contexte (nom lib + counts + actions).
 */
export default async function MediaLibraryDetailPage({ params }: Props) {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || !canViewMediaLibrary(userContext.effectiveUser.role)) {
    redirect("/templates");
  }
  const canManageAssets = canManageMediaAssets(userContext.effectiveUser.role);
  const canManage = canManageMediaLibraries(userContext.effectiveUser.role);

  const { id } = await params;
  const library = await prisma.mediaLibrary.findUnique({
    where: { id },
    include: { _count: { select: { assets: true } } },
  });
  if (!library) notFound();
  if (library.type === "audio") redirect(`/admin/libraries/audio/${id}`);

  return (
    <MediaAssetsPanel
      library={{
        id: library.id,
        name: library.name,
        type: library.type as "video" | "audio",
        metadataSchema: library.metadataSchema,
        description: library.description,
        tags: library.tags,
        rotationMode: library.rotationMode,
        rotationScope: library.rotationScope,
        maxUsageCount: library.maxUsageCount,
      }}
      canManageAssets={canManageAssets}
      canManageLibraries={canManage}
    />
  );
}
