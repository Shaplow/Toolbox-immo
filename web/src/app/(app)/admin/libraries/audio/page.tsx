import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import {
  canViewMediaLibrary,
  canManageMediaAssets,
  canManageMediaLibraries,
} from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";
import { MediaLibrariesPanel } from "@/components/admin/libraries/MediaLibrariesPanel";
import { LibrariesSubPageShell } from "@/components/admin/libraries/shared/LibrariesSubPageShell";
import { BackfillDurationButton } from "@/components/admin/libraries/BackfillDurationButton";

export default async function AudioLibrariesPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || !canViewMediaLibrary(userContext.effectiveUser.role)) {
    redirect("/templates");
  }
  const canManageAssets = canManageMediaAssets(userContext.effectiveUser.role);
  const canManage = canManageMediaLibraries(userContext.effectiveUser.role);

  // `missingDuration` : une piste sans durée en base est EXCLUE du tirage dès
  // qu'un minimum s'applique (le filtre est strict côté audio). Le compteur rend
  // ce stock invisible visible — sans lui, on constate juste que « la rotation
  // ne sert jamais ces musiques ».
  const [libCount, assetCount, missingDuration] = await Promise.all([
    prisma.mediaLibrary.count({ where: { type: "audio" } }),
    prisma.mediaAsset.count({ where: { library: { type: "audio" } } }),
    prisma.mediaAsset.count({ where: { library: { type: "audio" }, duration: null } }),
  ]);

  return (
    <LibrariesSubPageShell
      eyebrow="Médiathèque · Son"
      title="Bibliothèques son"
      actions={canManage ? <BackfillDurationButton /> : undefined}
      counter={
        <div className="inline-flex items-center gap-2">
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-card border border-border ">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-success-600 shadow-[0_0_6px_rgba(111,162,128,0.55)]" />
            <span className="text-[11px] font-mono text-foreground tabular-nums">
              {libCount} libs · {assetCount} pistes
            </span>
          </div>
          {missingDuration > 0 && (
            <div
              className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-warning-100 border border-warning-200"
              title="Ces pistes sont ignorées par le tirage automatique tant que leur durée n'est pas connue. Lance « Backfill durées »."
            >
              <span className="text-[11px] font-mono text-warning-700 tabular-nums">
                {missingDuration} sans durée
              </span>
            </div>
          )}
        </div>
      }
    >
      <MediaLibrariesPanel typeFilter="audio" canManageAssets={canManageAssets} canManageLibraries={canManage} />
    </LibrariesSubPageShell>
  );
}
