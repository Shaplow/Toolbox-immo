import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

type Params = { params: Promise<{ id: string }> };

// PATCH /api/admin/libraries/media/[id]/assets/bulk
// Applique tags et/ou setTag à plusieurs assets d'un coup
// Body : { assetIds: string[], tags?: string[], setTag?: string | null }
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: libraryId } = await params;

  const body = await req.json() as { assetIds?: unknown; tags?: unknown; setTag?: unknown; category?: unknown };

  if (!Array.isArray(body.assetIds) || body.assetIds.length === 0) {
    return NextResponse.json({ error: "assetIds est requis et doit être un tableau non vide" }, { status: 400 });
  }

  const rawIds = body.assetIds as unknown[];
  const assetIds = rawIds.filter((id): id is string => typeof id === "string");
  if (assetIds.length === 0) {
    return NextResponse.json({ error: "assetIds invalides" }, { status: 400 });
  }
  if (assetIds.length !== rawIds.length) {
    return NextResponse.json(
      { error: `assetIds invalides : ${rawIds.length - assetIds.length} entrée(s) ne sont pas des chaînes de caractères` },
      { status: 400 },
    );
  }

  const data: Record<string, unknown> = {};
  if (Array.isArray(body.tags)) data.tags = JSON.stringify(body.tags);
  if ("setTag" in body) data.setTag = (body.setTag as string | null | undefined) ?? null;
  if ("category" in body) data.category = (body.category as string | null | undefined) ?? null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
  }

  try {
    const result = await prisma.mediaAsset.updateMany({
      where: { id: { in: assetIds }, libraryId },
      data,
    });
    if (result.count !== assetIds.length) {
      return NextResponse.json(
        {
          error: `${assetIds.length - result.count} asset(s) non mis à jour — ils n'appartiennent peut-être pas à cette bibliothèque`,
          updated: result.count,
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ updated: result.count });
  } catch (err) {
    console.error(`[admin/libraries/media/${libraryId}/assets/bulk] PATCH error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
