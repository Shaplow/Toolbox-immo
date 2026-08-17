import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { requireUser } from "@/lib/api/requireAuth";
import { UPLOAD_LIMITS } from "@/lib/upload/limits";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/x-m4v", "video/webm"];
const ALLOWED_AUDIO_TYPES = ["audio/mpeg", "audio/wav", "audio/aac", "audio/mp4", "audio/ogg", "audio/x-m4a", "audio/flac"];
// Chemin traversant le serveur : plafonds bornés par nginx / la RAM du process.
const MAX_IMAGE_SIZE = UPLOAD_LIMITS.IMAGE_MAX_BYTES;
const MAX_VIDEO_SIZE = UPLOAD_LIMITS.VIDEO_ASSET_MAX_BYTES;
const MAX_AUDIO_SIZE = UPLOAD_LIMITS.AUDIO_ASSET_MAX_BYTES;
const SAFE_KEY = /^[\w\-.]+$/; // alphanumeric, dash, dot, underscore only

/**
 * PUT /api/upload-local?key=<filename>
 *
 * Fallback d'upload local utilisé uniquement quand R2 n'est pas configuré (dev).
 * Le client envoie le fichier brut comme corps de la requête (même interface
 * qu'un PUT vers une URL pré-signée S3/R2).
 */
export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!SAFE_KEY.test(key)) {
    return new NextResponse("Clé invalide", { status: 400 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  const baseType = contentType.split(";")[0].trim();
  const isImage = ALLOWED_IMAGE_TYPES.includes(baseType);
  const isAudio = ALLOWED_AUDIO_TYPES.includes(baseType);
  const isVideo = ALLOWED_VIDEO_TYPES.includes(baseType);
  if (!isImage && !isVideo && !isAudio) {
    return new NextResponse("Type non supporté", { status: 400 });
  }

  const maxSize = isAudio ? MAX_AUDIO_SIZE : isImage ? MAX_IMAGE_SIZE : MAX_VIDEO_SIZE;
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > maxSize) {
    return new NextResponse(`Fichier trop volumineux (max ${isAudio ? "200" : isImage ? "50" : "2000"} Mo)`, { status: 413 });
  }

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.byteLength > maxSize) {
    return new NextResponse(`Fichier trop volumineux (max ${isAudio ? "200" : isImage ? "50" : "2000"} Mo)`, { status: 413 });
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  const finalPath = path.join(UPLOAD_DIR, key);
  await writeFile(finalPath, buf);

  return new NextResponse(null, { status: 200 });
}
