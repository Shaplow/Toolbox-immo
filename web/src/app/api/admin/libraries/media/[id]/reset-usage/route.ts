import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/libraries/media/[id]/reset-usage
 *
 * Remet à zéro l'usage de tous les MediaAsset de la bibliothèque :
 *  - global counters (MediaAsset.usageCount, lastUsedAt)
 *  - per-account history (MediaAssetUsage rows pour la lib)
 *  - cursor de rotation (AccountLibraryCursor rows pour la lib)
 *
 * Sans le nettoyage MediaAssetUsage, le resolver continue d'ordonner les
 * assets par usage per-account stale → le reset était sans effet pour les
 * comptes ayant déjà des lignes d'usage (la promesse "rotation repart de
 * zéro" était cassée). Sans le reset des AccountLibraryCursor, les comptes
 * gardaient lastUsedSetTag/Category historique → anti-repetition appliquée
 * sur un état périmé.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: libraryId } = await params;
  try {
    const library = await prisma.mediaLibrary.findUnique({ where: { id: libraryId } });
    if (!library) {
      return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const assets = await tx.mediaAsset.updateMany({
        where: { libraryId },
        data: { usageCount: 0, lastUsedAt: null },
      });
      const usage = await tx.mediaAssetUsage.deleteMany({
        where: { asset: { libraryId } },
      });
      const cursors = await tx.accountLibraryCursor.deleteMany({
        where: { libraryId },
      });
      return {
        reset: assets.count,
        usageRowsDeleted: usage.count,
        cursorsCleared: cursors.count,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error(`[admin/libraries/media/${libraryId}/reset-usage] error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors du reset" }, { status: 500 });
  }
}
