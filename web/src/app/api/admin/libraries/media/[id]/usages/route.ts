import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

// GET /api/admin/libraries/media/[id]/usages?accountId=…
//
// Renvoie uniquement la carte d'usage par compte d'une bibliothèque :
// [{ assetId, usageCount, lastUsedAt }]. Payload minuscule (3 champs/asset) —
// permet au panel de remapper usageCount/lastUsedAt au changement de compte
// SANS retélécharger tout le tableau d'assets (url/metadata/etc.).
export async function GET(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  const accountId = req.nextUrl.searchParams.get("accountId") ?? undefined;
  if (!accountId) {
    return NextResponse.json({ error: "accountId requis" }, { status: 400 });
  }

  try {
    const usages = await prisma.mediaAssetUsage.findMany({
      where: { accountId, asset: { libraryId: id } },
      select: { assetId: true, usageCount: true, lastUsedAt: true },
    });
    return NextResponse.json(usages, {
      headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
    });
  } catch (err) {
    console.error(`[admin/libraries/media/${id}/usages] findMany error:`, err);
    return NextResponse.json(
      { error: "Erreur serveur lors du chargement des usages" },
      { status: 500 },
    );
  }
}
