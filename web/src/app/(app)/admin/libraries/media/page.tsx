import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import {
  canViewMediaLibrary,
  canManageMediaAssets,
  canManageMediaLibraries,
} from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";
import { MediaLibrariesPanel } from "@/components/admin/libraries/MediaLibrariesPanel";
import { BackfillDurationButton } from "@/components/admin/libraries/BackfillDurationButton";
import { LibrariesSubPageShell } from "@/components/admin/libraries/shared/LibrariesSubPageShell";

export default async function MediaLibrariesPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || !canViewMediaLibrary(userContext.effectiveUser.role)) {
    redirect("/templates");
  }
  const canManageAssets = canManageMediaAssets(userContext.effectiveUser.role);
  const canManage = canManageMediaLibraries(userContext.effectiveUser.role);

  const [libCount, assetCount] = await Promise.all([
    prisma.mediaLibrary.count({ where: { type: "video" } }),
    prisma.mediaAsset.count({ where: { library: { type: "video" } } }),
  ]);

  return (
    <LibrariesSubPageShell
      eyebrow="Médiathèque · Vidéo"
      title="Bibliothèques vidéo"
      actions={canManage ? <BackfillDurationButton /> : undefined}
      counter={
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-card border border-border ">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-info-600 shadow-[0_0_6px_rgba(125,180,210,0.6)]" />
          <span className="text-[11px] font-mono text-foreground tabular-nums">
            {libCount} libs · {assetCount} vidéos
          </span>
        </div>
      }
    >
      <MediaLibrariesPanel typeFilter="video" canManageAssets={canManageAssets} canManageLibraries={canManage} />
    </LibrariesSubPageShell>
  );
}
