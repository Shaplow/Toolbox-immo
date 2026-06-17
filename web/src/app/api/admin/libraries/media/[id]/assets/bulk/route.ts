import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { deleteFromR2, r2Configured } from "@/lib/r2";
import {
  isBulkParseError,
  parseBulkAccessBody,
} from "@/lib/admin/libraryBulkHelpers";

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

  const body = (await req.json()) as Record<string, unknown>;

  const parsed = parseBulkAccessBody(body, "assetIds");
  if (isBulkParseError(parsed)) {
    return NextResponse.json({ error: parsed.message }, { status: parsed.status });
  }
  const { ids: assetIds, action: accessAction, accountIds: accessAccountIds } = parsed;

  // H.2 — Le prefix `pack_` est réservé aux groupes auto-générés.
  // Bloque toute tentative manuelle d'écrire un setTag avec ce prefix.
  if (
    "setTag" in body &&
    typeof body.setTag === "string" &&
    body.setTag.startsWith("pack_")
  ) {
    return NextResponse.json(
      { error: "Le préfixe « pack_ » est réservé. Choisis un autre nom de groupe." },
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

  const hasFieldUpdate = Object.keys(data).length > 0;
  const hasAccessUpdate = accessAction === "add" || accessAction === "remove_all";

  if (!hasFieldUpdate && !hasAccessUpdate) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
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

  // Refuse si un MediaEditJob actif existe sur l'un des assets — alignement
  // avec la DELETE single-asset (évite FK violations + zombies RunPod).
  const activeEditJob = await prisma.mediaEditJob.findFirst({
    where: { assetId: { in: assetIds }, status: { in: ["pending", "processing"] } },
    select: { assetId: true },
  });
  if (activeEditJob) {
    return NextResponse.json(
      {
        error:
          "Un job d'édition est en cours sur au moins un des assets. Attendez la fin du traitement avant de supprimer en masse.",
      },
      { status: 409 },
    );
  }

  // Charger les r2Key avant la suppression DB pour pouvoir nettoyer R2.
  // Sans ça, la suppression DB rendait les fichiers R2 orphelins (fuite permanente).
  let assets: { id: string; r2Key: string }[];
  try {
    assets = await prisma.mediaAsset.findMany({
      where: { id: { in: assetIds }, libraryId },
      select: { id: true, r2Key: true },
    });
  } catch (err) {
    console.error(`[admin/libraries/media/${libraryId}/assets/bulk] findMany error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }

  // Supprimer les fichiers R2 en premier (idempotent côté S3 sur NoSuchKey).
  // En cas d'échec partiel : on abort sans toucher la DB pour que l'admin puisse
  // retry. Pattern miroir de /api/admin/libraries/media/[id]/route.ts.
  if (r2Configured() && assets.length > 0) {
    const results = await Promise.allSettled(assets.map((a) => deleteFromR2(a.r2Key)));
    const r2Errors = results
      .map((r, i) => (r.status === "rejected" ? assets[i].r2Key : null))
      .filter((k): k is string => k !== null);
    if (r2Errors.length > 0) {
      r2Errors.forEach((key) =>
        console.error(`[admin/libraries/media/${libraryId}/assets/bulk] R2 delete failed for ${key}`),
      );
      return NextResponse.json(
        {
          error: `Échec suppression R2 pour ${r2Errors.length} fichier(s) sur ${assets.length}. Réessayez (les suppressions déjà réalisées sont idempotentes).`,
        },
        { status: 500 },
      );
    }
  }

  try {
    const result = await prisma.mediaAsset.deleteMany({
      where: { id: { in: assetIds }, libraryId },
    });
    return NextResponse.json({ deleted: result.count });
  } catch (err) {
    console.error(`[admin/libraries/media/${libraryId}/assets/bulk] DELETE error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
