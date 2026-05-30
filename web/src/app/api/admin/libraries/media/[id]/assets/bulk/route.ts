import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/admin/libraries/media/[id]/assets/bulk
// Applique tags, setTag, category et/ou contrôle d'accès à plusieurs assets d'un coup
// Body : { assetIds: string[], tags?: string[], setTag?: string | null, category?: string | null,
//          accessAction?: "add" | "remove_all", accountId?: string }
export async function PATCH(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
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
    accountIds?: unknown; // Phase γ — multi-select comptes pour add
    metadata?: unknown; // Phase rotation=none — bulk set metadata (remplace le JSON existant)
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
  if (body.metadata !== undefined && body.metadata !== null && typeof body.metadata === "object") {
    data.metadata = JSON.stringify(body.metadata);
  }

  const accessAction = typeof body.accessAction === "string" ? body.accessAction : null;
  // Phase γ — supporte soit accountId (legacy, 1 compte) soit accountIds (multi).
  const accessAccountIds: string[] = (() => {
    if (Array.isArray(body.accountIds)) {
      return body.accountIds.filter((s): s is string => typeof s === "string");
    }
    if (typeof body.accountId === "string") return [body.accountId];
    return [];
  })();

  const hasFieldUpdate = Object.keys(data).length > 0;
  const hasAccessUpdate = accessAction === "add" || accessAction === "remove_all";

  if (!hasFieldUpdate && !hasAccessUpdate) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
  }

  if (accessAction === "add" && accessAccountIds.length === 0) {
    return NextResponse.json({ error: "accountId (ou accountIds[]) requis pour l'action add" }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (hasFieldUpdate) {
        await tx.mediaAsset.updateMany({
          where: { id: { in: assetIds }, libraryId },
          data,
        });
      }
      if (accessAction === "add" && accessAccountIds.length > 0) {
        // Cross-product : 1 row par (asset, account) sélectionné.
        const rows = assetIds.flatMap((assetId) =>
          accessAccountIds.map((accountId) => ({ assetId, accountId })),
        );
        await tx.mediaAssetAccess.createMany({
          data: rows,
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

// DELETE /api/admin/libraries/media/[id]/assets/bulk
// Supprime plusieurs assets en une seule transaction
// Body : { assetIds: string[] }
export async function DELETE(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: libraryId } = await params;

  const body = await req.json() as { assetIds?: unknown };

  if (!Array.isArray(body.assetIds) || body.assetIds.length === 0) {
    return NextResponse.json({ error: "assetIds est requis et doit être un tableau non vide" }, { status: 400 });
  }

  const assetIds = (body.assetIds as unknown[]).filter((id): id is string => typeof id === "string");
  if (assetIds.length === 0) {
    return NextResponse.json({ error: "assetIds invalides" }, { status: 400 });
  }

  try {
    await prisma.mediaAsset.deleteMany({
      where: { id: { in: assetIds }, libraryId },
    });
    return NextResponse.json({ deleted: assetIds.length });
  } catch (err) {
    console.error(`[admin/libraries/media/${libraryId}/assets/bulk] DELETE error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
