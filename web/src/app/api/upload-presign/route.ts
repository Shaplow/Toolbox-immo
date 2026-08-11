import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { getUserContext } from "@/lib/userContext";
import { createPresignedUploadUrl, getR2PublicUrl, r2Configured } from "@/lib/r2";
import { UPLOAD_LIMITS } from "@/lib/upload/limits";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/x-m4v", "video/webm"];
const ALLOWED_AUDIO_TYPES = ["audio/mpeg", "audio/wav", "audio/aac", "audio/mp4", "audio/ogg", "audio/x-m4a", "audio/flac"];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES, ...ALLOWED_AUDIO_TYPES];
// Ce chemin ne fait PAS de multipart : un PUT unique R2 est refusé au-delà de
// 5 Go, donc ces plafonds restent volontairement bas (pas de 100 Go ici).
const MAX_IMAGE_SIZE = UPLOAD_LIMITS.IMAGE_MAX_BYTES;
const MAX_VIDEO_SIZE = UPLOAD_LIMITS.VIDEO_ASSET_MAX_BYTES;
const MAX_AUDIO_SIZE = UPLOAD_LIMITS.AUDIO_ASSET_MAX_BYTES;

/**
 * Extensions de fichier autorisées par MIME type — utilisées pour bloquer les
 * combinaisons aberrantes (ex: contentType=video/mp4 + filename=malware.php).
 * Sans ce check, l'extension du R2 key peut polluer downstream (CDN qui infère
 * le Content-Type depuis l'extension, scripts qui matchent par extension).
 */
const ALLOWED_EXTENSIONS_BY_TYPE: Record<string, readonly string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "video/mp4": ["mp4", "m4v"],
  "video/quicktime": ["mov", "qt"],
  "video/x-m4v": ["m4v", "mp4"],
  "video/webm": ["webm"],
  "audio/mpeg": ["mp3"],
  "audio/wav": ["wav"],
  "audio/aac": ["aac"],
  "audio/mp4": ["m4a", "mp4"],
  "audio/ogg": ["ogg", "oga"],
  "audio/x-m4a": ["m4a"],
  "audio/flac": ["flac"],
};

export async function POST(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const body = await req.json() as { filename?: string; contentType?: string; size?: number };
  const { filename, contentType, size } = body;

  if (!contentType || !ALLOWED_TYPES.includes(contentType)) {
    return NextResponse.json({ error: "Type de fichier non supporté" }, { status: 400 });
  }

  // Require size so we can reject oversized requests before generating the URL.
  // The app-level check is the primary size gate; presigned PUT URLs do not carry
  // a built-in size policy in standard S3/R2, so we rely on client honesty for the
  // actual upload size. Future hardening: switch to presigned POST with conditions.
  if (typeof size !== "number" || size <= 0) {
    return NextResponse.json(
      { error: "La taille du fichier (size) est requise" },
      { status: 400 }
    );
  }

  const isVideo = ALLOWED_VIDEO_TYPES.includes(contentType);
  const isAudio = ALLOWED_AUDIO_TYPES.includes(contentType);
  const maxSize = isVideo ? MAX_VIDEO_SIZE : isAudio ? MAX_AUDIO_SIZE : MAX_IMAGE_SIZE;

  if (size > maxSize) {
    return NextResponse.json(
      { error: `Fichier trop volumineux (max ${isVideo ? "2000" : isAudio ? "200" : "50"} MB)` },
      { status: 400 }
    );
  }

  const rawExt = path.extname(filename ?? "").replace(/^\./, "").toLowerCase();
  const allowedExtensions = ALLOWED_EXTENSIONS_BY_TYPE[contentType] ?? [];
  if (rawExt && !allowedExtensions.includes(rawExt)) {
    return NextResponse.json(
      { error: `Extension "${rawExt}" non autorisée pour le type "${contentType}"` },
      { status: 400 },
    );
  }
  // Si filename absent ou extension manquante, on retombe sur la 1ère extension
  // canonique de la MIME (jamais "bin" qui pouvait piéger downstream).
  const ext = rawExt || allowedExtensions[0] || "bin";
  const key = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  // ── Local dev fallback (R2 non configuré) ──────────────────────────────────
  if (!r2Configured()) {
    return NextResponse.json({
      uploadUrl: `/api/upload-local?key=${key}`,
      publicUrl: `/uploads/${key}`,
      key,
    });
  }

  // ── Production : upload direct browser → R2 via URL pré-signée ────────────
  // On passe `size` au presign pour que ContentLength soit incorporé à la
  // signature : le PUT R2 rejettera tout corps qui ne fait pas exactement
  // cette taille. Sans cette contrainte, un client malveillant pouvait
  // déclarer size=1 (passe le check), récupérer l'URL, puis PUT 2 Go.
  const r2Key = `uploads/${key}`;
  const uploadUrl = await createPresignedUploadUrl(r2Key, contentType, undefined, size);
  const publicUrl = getR2PublicUrl(r2Key);

  return NextResponse.json({ uploadUrl, publicUrl, key: r2Key });
}
