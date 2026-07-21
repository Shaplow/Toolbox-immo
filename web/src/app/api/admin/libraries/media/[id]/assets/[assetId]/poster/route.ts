import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { canAccessMediaLibrary } from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";
import { createPresignedUploadUrl, getR2PublicUrl, r2Configured } from "@/lib/r2";

type Params = { params: Promise<{ id: string; assetId: string }> };

const MAX_POSTER_SIZE = 2 * 1024 * 1024; // 2 MB — un JPEG ~320px est très léger.

/**
 * POST /api/admin/libraries/media/[id]/assets/[assetId]/poster
 *
 * Corps JSON : { size }
 * Retourne : { uploadUrl, posterUrl }
 *
 * Presigne l'upload d'une image poster (vignette) et pose `posterUrl` de façon
 * optimiste (URL publique déterministe, comme `url` à l'upload vidéo). Le client
 * fait ensuite le PUT du blob JPEG. Best-effort : si le PUT échoue, la grille
 * retombe sur <video> via le fallback de LazyVideoThumb.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !canAccessMediaLibrary(userContext.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id, assetId } = await params;

  const asset = await prisma.mediaAsset.findFirst({
    where: { id: assetId, libraryId: id },
    select: { id: true },
  });
  if (!asset) {
    return NextResponse.json({ error: "Asset introuvable" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { size?: number };
  const size = typeof body.size === "number" ? body.size : undefined;
  if (size !== undefined && size > MAX_POSTER_SIZE) {
    return NextResponse.json({ error: "Poster trop volumineux" }, { status: 400 });
  }

  const posterKey = `content-library/posters/${assetId}.jpg`;
  const posterUrl = r2Configured()
    ? getR2PublicUrl(posterKey)
    : `/uploads/${assetId}_poster.jpg`;

  try {
    await prisma.mediaAsset.update({
      where: { id: assetId },
      data: { posterUrl },
    });
  } catch (err) {
    console.error(
      `[admin/libraries/media/${id}/assets/${assetId}/poster] update error:`,
      err,
    );
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }

  if (!r2Configured()) {
    return NextResponse.json({
      uploadUrl: `/api/upload-local?key=${assetId}_poster.jpg`,
      posterUrl,
    });
  }

  try {
    const uploadUrl = await createPresignedUploadUrl(
      posterKey,
      "image/jpeg",
      3600,
      size,
    );
    return NextResponse.json({ uploadUrl, posterUrl });
  } catch (err) {
    console.error(
      `[admin/libraries/media/${id}/assets/${assetId}/poster] presign error:`,
      err,
    );
    return NextResponse.json({ error: "Impossible de générer l'URL d'upload" }, { status: 500 });
  }
}
