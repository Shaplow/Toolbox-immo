import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { canViewMediaLibrary, canManageMediaAssets } from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";
import { deleteFromR2, createPresignedDownloadUrl, r2Configured } from "@/lib/r2";
import { isReservedSetTag } from "@/lib/rotation/sentinels";

type Params = { params: Promise<{ assetId: string }> };

// GET /api/admin/libraries/media/assets/[assetId] — URL de téléchargement
// Retourne une URL pré-signée R2 (valide 1h) avec Content-Disposition: attachment.
// En dev (R2 non configuré), renvoie directement l'URL publique.
//
// Lecture : ouverte à tous les rôles médiathèque, MONTEUR compris — télécharger
// un rush est précisément ce qu'il vient faire ici. Les mutations plus bas
// (DELETE, PATCH) restent réservées à `canManageMediaAssets`.
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  if (!canViewMediaLibrary(auth.ctx.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux rôles médiathèque" }, { status: 403 });
  }

  const { assetId } = await params;
  let asset;
  try {
    asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  } catch (err) {
    console.error(`[admin/libraries/media/assets/${assetId}] GET error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
  if (!asset) {
    return NextResponse.json({ error: "Asset introuvable" }, { status: 404 });
  }

  if (!r2Configured()) {
    // Dev fallback : URL publique directe
    return NextResponse.json({ downloadUrl: asset.url });
  }

  try {
    const downloadUrl = await createPresignedDownloadUrl(asset.r2Key, asset.filename, 3600);
    return NextResponse.json({ downloadUrl });
  } catch (err) {
    console.error(`[admin/libraries/media/assets/${assetId}] presign download error:`, err);
    return NextResponse.json({ error: "Impossible de générer l'URL de téléchargement" }, { status: 500 });
  }
}

// DELETE /api/admin/libraries/media/assets/[assetId] — supprime un asset (+ R2)
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  if (!canManageMediaAssets(auth.ctx.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { assetId } = await params;
  let asset;
  try {
    asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  } catch (err) {
    console.error(`[admin/libraries/media/assets/${assetId}] findUnique error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
  if (!asset) {
    return NextResponse.json({ error: "Asset introuvable" }, { status: 404 });
  }

  // Refuse deletion while an edit job is running — avoids FK violations and zombie RunPod jobs.
  const activeEditJob = await prisma.mediaEditJob.findFirst({
    where: { assetId, status: { in: ["pending", "processing"] } },
  });
  if (activeEditJob) {
    return NextResponse.json(
      { error: "Un job d'édition est en cours sur cet asset. Attendez la fin du traitement avant de supprimer." },
      { status: 409 }
    );
  }

  // R2 en premier — ne pas supprimer la row si R2 échoue (ignoré en dev sans config R2)
  if (r2Configured()) {
    try {
      await deleteFromR2(asset.r2Key);
    } catch (err) {
      console.error(`[admin/libraries/media/assets] R2 delete failed for ${asset.r2Key}:`, err);
      return NextResponse.json(
        { error: "Échec suppression du fichier sur R2. Réessayez." },
        { status: 500 }
      );
    }
  }

  try {
    await prisma.mediaAsset.delete({ where: { id: assetId } });
  } catch (err) {
    console.error(`[admin/libraries/media/assets/${assetId}] delete error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors de la suppression" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// PATCH /api/admin/libraries/media/assets/[assetId]
// Champs acceptés : duration, tags, setTag, incrementUsage, usageCount, resetUsage, lastUsedAt, disabled
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  if (!canManageMediaAssets(auth.ctx.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { assetId: assetIdPatch } = await params;
  const body = await req.json() as {
    duration?: number;
    tags?: string[];
    setTag?: string | null;
    incrementUsage?: boolean;
    usageCount?: number;
    resetUsage?: boolean;
    lastUsedAt?: string | null;
    accessAccountIds?: string[];
    resetUsageForAccount?: string;
    disabled?: boolean;
    metadata?: Record<string, string | number | null>;
  };

  // H.2 — Le prefix `pack_` est réservé aux dossiers auto-générés à l'upload
  // (feature supprimée). L'admin ne doit jamais pouvoir créer un setTag manuel
  // avec ce prefix (sinon il apparaîtra invisible dans l'UI qui filtre les pack_*).
  if ("setTag" in body && typeof body.setTag === "string" && isReservedSetTag(body.setTag)) {
    return NextResponse.json(
      { error: "Le préfixe « pack_ » est réservé. Choisis un autre nom de dossier." },
      { status: 400 },
    );
  }

  const data: Record<string, unknown> = {};
  if (typeof body.duration === "number") data.duration = body.duration;
  if (Array.isArray(body.tags)) data.tags = JSON.stringify(body.tags);
  if ("setTag" in body) data.setTag = body.setTag ?? null;
  if (typeof body.disabled === "boolean") data.disabled = body.disabled;
  if (body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)) {
    data.metadata = JSON.stringify(body.metadata);
  }
  if (body.incrementUsage === true) {
    data.usageCount = { increment: 1 };
    data.lastUsedAt = new Date();
  } else if (typeof body.usageCount === "number" && body.resetUsage !== true) {
    data.usageCount = body.usageCount;
    data.lastUsedAt = body.usageCount === 0 ? null : new Date();
  }
  if (body.resetUsage === true) {
    data.usageCount = 0;
    data.lastUsedAt = null;
  }
  if ("lastUsedAt" in body && body.incrementUsage !== true && body.resetUsage !== true) {
    data.lastUsedAt = body.lastUsedAt ? new Date(body.lastUsedAt) : null;
  }

  const hasAccessUpdate = Array.isArray(body.accessAccountIds);
  const hasDataUpdate = Object.keys(data).length > 0;
  const hasReset = body.resetUsage === true;
  const hasResetForAccount = typeof body.resetUsageForAccount === "string" && body.resetUsageForAccount.length > 0;

  if (!hasDataUpdate && !hasAccessUpdate && !hasResetForAccount) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (hasReset) {
        // Also wipe all per-account usage entries so per-account rotation resets too
        await tx.mediaAssetUsage.deleteMany({ where: { assetId: assetIdPatch } });
      }
      if (hasResetForAccount) {
        // Wipe only the specified account's usage record (global and other accounts stay intact)
        await tx.mediaAssetUsage.deleteMany({
          where: { assetId: assetIdPatch, accountId: body.resetUsageForAccount },
        });
      }
      if (hasDataUpdate) {
        await tx.mediaAsset.update({ where: { id: assetIdPatch }, data });
      }
      if (hasAccessUpdate) {
        // Replace all access entries atomically
        await tx.mediaAssetAccess.deleteMany({ where: { assetId: assetIdPatch } });
        if (body.accessAccountIds!.length > 0) {
          await tx.mediaAssetAccess.createMany({
            data: body.accessAccountIds!.map((accountId) => ({ assetId: assetIdPatch, accountId })),
            skipDuplicates: true,
          });
        }
      }
    });

    const asset = await prisma.mediaAsset.findUnique({
      where: { id: assetIdPatch },
      include: { accesses: { select: { accountId: true } } },
    });
    if (!asset) return NextResponse.json({ error: "Asset introuvable" }, { status: 404 });

    const { accesses, ...rest } = asset;
    return NextResponse.json({ ...rest, accessAccountIds: accesses.map((a) => a.accountId) });
  } catch (err) {
    console.error(`[admin/libraries/media/assets/${assetIdPatch}] PATCH error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors de la mise à jour" }, { status: 500 });
  }
}
