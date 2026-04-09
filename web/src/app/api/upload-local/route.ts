import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { auth } from "@/lib/auth";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/x-m4v", "video/webm"];
const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024;
const SAFE_KEY = /^[\w\-.]+$/; // alphanumeric, dash, dot, underscore only

/**
 * PUT /api/upload-local?key=<filename>
 *
 * Fallback d'upload local utilisé uniquement quand R2 n'est pas configuré (dev).
 * Le client envoie le fichier brut comme corps de la requête (même interface
 * qu'un PUT vers une URL pré-signée S3/R2).
 */
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Non autorisé", { status: 401 });
  }

  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!SAFE_KEY.test(key)) {
    return new NextResponse("Clé invalide", { status: 400 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  const baseType = contentType.split(";")[0].trim();
  if (!ALLOWED_VIDEO_TYPES.includes(baseType)) {
    return new NextResponse("Type non supporté", { status: 400 });
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_VIDEO_SIZE) {
    return new NextResponse("Fichier trop volumineux (max 2 Go)", { status: 413 });
  }

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.byteLength > MAX_VIDEO_SIZE) {
    return new NextResponse("Fichier trop volumineux (max 2 Go)", { status: 413 });
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  const finalPath = path.join(UPLOAD_DIR, key);
  await writeFile(finalPath, buf);

  return new NextResponse(null, { status: 200 });
}
