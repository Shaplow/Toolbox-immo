import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteFromR2, createPresignedDownloadUrl, r2Configured } from "@/lib/r2";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

type Params = { params: Promise<{ assetId: string }> };

// GET /api/admin/libraries/media/assets/[assetId]/download — URL de téléchargement
// Retourne une URL pré-signée R2 (valide 1h) avec Content-Disposition: attachment.
// En dev (R2 non configuré), redirige directement vers l'URL publique.
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
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
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
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

  // R2 en premier — ne pas supprimer la row si R2 échoue
  try {
    await deleteFromR2(asset.r2Key);
  } catch (err) {
    console.error(`[admin/libraries/media/assets] R2 delete failed for ${asset.r2Key}:`, err);
    return NextResponse.json(
      { error: "Échec suppression du fichier sur R2. Réessayez." },
      { status: 500 }
    );
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
// Champs acceptés : duration, tags, incrementUsage
// incrementUsage: true → incrémente usageCount + met à jour lastUsedAt
//   (utile quand le média a été utilisé en dehors de l'app, ex: montage externe)
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { assetId: assetIdPatch } = await params;
  const body = await req.json() as { duration?: number; tags?: string[]; incrementUsage?: boolean };

  const data: Record<string, unknown> = {};
  if (typeof body.duration === "number") data.duration = body.duration;
  if (Array.isArray(body.tags)) data.tags = JSON.stringify(body.tags);
  if (body.incrementUsage === true) {
    data.usageCount = { increment: 1 };
    data.lastUsedAt = new Date();
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
  }

  try {
    const asset = await prisma.mediaAsset.update({
      where: { id: assetIdPatch },
      data,
    });
    return NextResponse.json(asset);
  } catch (err) {
    console.error(`[admin/libraries/media/assets/${assetIdPatch}] PATCH error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors de la mise à jour" }, { status: 500 });
  }
}
