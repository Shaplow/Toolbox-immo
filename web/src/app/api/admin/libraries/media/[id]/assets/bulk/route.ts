import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

type Params = { params: Promise<{ id: string }> };

// PATCH /api/admin/libraries/media/[id]/assets/bulk
// Applique tags, setTag, category et/ou contrôle d'accès à plusieurs assets d'un coup
// Body : { assetIds: string[], tags?: string[], setTag?: string | null, category?: string | null,
//          accessAction?: "add" | "remove_all", accountId?: string }
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: libraryId } = await params;

  const body = await req.json() as {
    assetIds?: unknown;
    tags?: unknown;
    setTag?: unknown;
    category?: unknown;
    accessAction?: unknown;
    accountId?: unknown;
  };

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

  const accessAction = typeof body.accessAction === "string" ? body.accessAction : null;
  const accessAccountId = typeof body.accountId === "string" ? body.accountId : null;

  const hasFieldUpdate = Object.keys(data).length > 0;
  const hasAccessUpdate = accessAction === "add" || accessAction === "remove_all";

  if (!hasFieldUpdate && !hasAccessUpdate) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
  }

  if (accessAction === "add" && !accessAccountId) {
    return NextResponse.json({ error: "accountId requis pour l'action add" }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (hasFieldUpdate) {
        await tx.mediaAsset.updateMany({
          where: { id: { in: assetIds }, libraryId },
          data,
        });
      }
      if (accessAction === "add" && accessAccountId) {
        await tx.mediaAssetAccess.createMany({
          data: assetIds.map((assetId) => ({ assetId, accountId: accessAccountId })),
          skipDuplicates: true,
        });
      } else if (accessAction === "remove_all") {
        await tx.mediaAssetAccess.deleteMany({
          where: { assetId: { in: assetIds } },
        });
      }
    });
    return NextResponse.json({ updated: assetIds.length });
  } catch (err) {
    console.error(`[admin/libraries/media/${libraryId}/assets/bulk] PATCH error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
