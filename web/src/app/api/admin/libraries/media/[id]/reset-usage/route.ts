import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/libraries/media/[id]/reset-usage
 *
 * Remet usageCount = 0 et lastUsedAt = null sur tous les MediaAsset de la bibliothèque.
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

    const { count } = await prisma.mediaAsset.updateMany({
      where: { libraryId },
      data: { usageCount: 0, lastUsedAt: null },
    });

    return NextResponse.json({ reset: count });
  } catch (err) {
    console.error(`[admin/libraries/media/${libraryId}/reset-usage] error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors du reset" }, { status: 500 });
  }
}
