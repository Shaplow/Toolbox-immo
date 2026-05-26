import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { createPresignedUploadUrl, getR2PublicUrl, r2Configured } from "@/lib/r2";
import path from "path";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

type Params = { params: Promise<{ id: string }> };

const ALLOWED_VIDEO_TYPES = new Set([
  "video/mp4", "video/quicktime", "video/x-m4v", "video/webm", "video/mpeg",
]);
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/mpeg", "audio/wav", "audio/aac", "audio/mp4", "audio/ogg",
  "audio/x-m4a", "audio/flac", "audio/x-wav",
]);

const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB
const MAX_AUDIO_SIZE = 200 * 1024 * 1024; // 200 MB

/**
 * POST /api/admin/libraries/media/[id]/upload
 *
 * Corps JSON : { filename, contentType, size }
 * Retourne : { uploadUrl, r2Key, assetId }
 * Le client fait le PUT vers uploadUrl, puis confirme via PATCH /assets/[assetId]/confirm
 *
 * En dev (R2 non configuré) : retourne une URL locale fictive.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;
  let library;
  try {
    library = await prisma.mediaLibrary.findUnique({ where: { id } });
  } catch (err) {
    console.error(`[admin/libraries/media/${id}/upload] findUnique error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
  if (!library) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }

  const body = await req.json() as { filename?: string; contentType?: string; size?: number };
  const { filename, contentType, size } = body;

  if (!contentType || !filename) {
    return NextResponse.json({ error: "filename et contentType requis" }, { status: 400 });
  }
  if (typeof size !== "number" || size <= 0) {
    return NextResponse.json({ error: "La taille du fichier (size) est requise" }, { status: 400 });
  }

  const isVideo = library.type === "video";
  const isAudio = library.type === "audio";

  if (isVideo && !ALLOWED_VIDEO_TYPES.has(contentType)) {
    return NextResponse.json({ error: "Type de fichier non supporté pour une bibliothèque vidéo" }, { status: 400 });
  }
  if (isAudio && !ALLOWED_AUDIO_TYPES.has(contentType)) {
    return NextResponse.json({ error: "Type de fichier non supporté pour une bibliothèque audio" }, { status: 400 });
  }

  const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_AUDIO_SIZE;
  if (size > maxSize) {
    const maxMB = isVideo ? "2000" : "200";
    return NextResponse.json({ error: `Fichier trop volumineux (max ${maxMB} MB)` }, { status: 400 });
  }

  const ext = path.extname(filename).replace(/^\./, "") || "bin";
  const assetId = crypto.randomUUID().replace(/-/g, "");
  const prefix = isVideo ? "content-library/videos" : "content-library/audio";
  const r2Key = `${prefix}/${assetId}.${ext}`;

  // Créer l'asset en DB en "pending" (url sera mise à jour après upload confirmé)
  let asset;
  try {
    asset = await prisma.mediaAsset.create({
      data: {
        id: assetId,
        libraryId: id,
        filename: path.basename(filename),
        r2Key,
        url: r2Configured() ? getR2PublicUrl(r2Key) : `/uploads/${assetId}.${ext}`,
        mimeType: contentType,
      },
    });
  } catch (err) {
    console.error(`[admin/libraries/media/${id}/upload] create asset error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors de la création de l'asset" }, { status: 500 });
  }

  if (!r2Configured()) {
    // En dev, utiliser une clé plate sans sous-dossier pour que :
    //  1. le SAFE_KEY regex de /api/upload-local accepte la clé (pas de /)
    //  2. le fichier atterrit dans public/uploads/{assetId}.{ext}
    //  3. l'url stockée /uploads/{assetId}.{ext} soit correcte
    const devKey = `${assetId}.${ext}`;
    return NextResponse.json({
      uploadUrl: `/api/upload-local?key=${devKey}`,
      r2Key,
      assetId: asset.id,
    });
  }

  let uploadUrl: string;
  try {
    uploadUrl = await createPresignedUploadUrl(r2Key, contentType, 3600, size);
  } catch (err) {
    // Clean up the DB row we just created so it doesn't become a phantom asset.
    await prisma.mediaAsset.delete({ where: { id: asset.id } }).catch((e) => {
      console.error(`[admin/libraries/media/${id}/upload] cleanup after presign failure:`, e);
    });
    console.error(`[admin/libraries/media/${id}/upload] createPresignedUploadUrl error:`, err);
    return NextResponse.json({ error: "Impossible de générer l'URL d'upload R2" }, { status: 500 });
  }
  return NextResponse.json({ uploadUrl, r2Key, assetId: asset.id });
}
