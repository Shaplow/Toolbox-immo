import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { canViewMediaLibrary } from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";
import { resolveUsageKey } from "@/lib/generate/libraryAssetsQuery";

type Params = { params: Promise<{ id: string }> };

// GET /api/admin/libraries/media/[id]/usages?accountId=…
//
// Renvoie uniquement la carte d'usage par compte d'une bibliothèque :
// [{ assetId, usageCount, lastUsedAt }]. Payload minuscule (3 champs/asset) —
// permet au panel de remapper usageCount/lastUsedAt au changement de compte
// SANS retélécharger tout le tableau d'assets (url/metadata/etc.).
export async function GET(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  if (!canViewMediaLibrary(auth.ctx.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  const accountId = req.nextUrl.searchParams.get("accountId") ?? undefined;
  if (!accountId) {
    return NextResponse.json({ error: "accountId requis" }, { status: 400 });
  }

  try {
    // La clé d'usage suit le scope de la bibliothèque : une lib `shared` stocke son
    // ancienneté sous la sentinelle __shared__, pas sous le compte réel. Lire le
    // compte réel y afficherait « jamais utilisé » pour tous les assets.
    const library = await prisma.mediaLibrary.findUnique({
      where: { id },
      select: { rotationScope: true },
    });
    const usageAccountId = resolveUsageKey(library?.rotationScope, accountId) ?? accountId;
    const usages = await prisma.mediaAssetUsage.findMany({
      where: { accountId: usageAccountId, asset: { libraryId: id } },
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
