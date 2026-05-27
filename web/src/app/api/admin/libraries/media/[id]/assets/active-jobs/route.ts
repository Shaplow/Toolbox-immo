import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/libraries/media/[id]/assets/active-jobs
 *
 * Endpoint léger pour le polling de statut. Retourne deux groupes :
 * 1. Assets avec un job actif (pending/processing) — recentlyCompleted: false
 * 2. Assets dont le dernier job vient de se terminer (done/failed < 120s) — recentlyCompleted: true
 *    avec url/duration déjà mis à jour par le worker.
 *
 * Permet à silentPoll() de mettre à jour l'UI sans rechargement complet.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: libraryId } = await params;

  const cutoff = new Date(Date.now() - 120_000);

  const [activeAssets, completedAssets] = await Promise.all([
    prisma.mediaAsset.findMany({
      where: {
        libraryId,
        editJobs: { some: { status: { in: ["pending", "processing"] } } },
      },
      select: {
        id: true,
        url: true,
        duration: true,
        editJobs: {
          where: { status: { in: ["pending", "processing"] } },
          select: { id: true, status: true },
          take: 1,
        },
      },
    }),
    prisma.mediaAsset.findMany({
      where: {
        libraryId,
        NOT: { editJobs: { some: { status: { in: ["pending", "processing"] } } } },
        editJobs: {
          some: {
            status: { in: ["done", "failed"] },
            updatedAt: { gte: cutoff },
          },
        },
      },
      select: { id: true, url: true, duration: true },
    }),
  ]);

  return NextResponse.json([
    ...activeAssets.map((a) => ({
      id: a.id,
      url: a.url,
      duration: a.duration,
      pendingEditJob: a.editJobs[0] ?? null,
      recentlyCompleted: false,
    })),
    ...completedAssets.map((a) => ({
      id: a.id,
      url: a.url,
      duration: a.duration,
      pendingEditJob: null,
      recentlyCompleted: true,
    })),
  ]);
}
