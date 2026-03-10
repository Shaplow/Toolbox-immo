import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadToR2, r2Configured } from "@/lib/r2";
import { writeFile, mkdir } from "fs/promises";
import path from "path";


const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;   // 20 MB
const MAX_VIDEO_SIZE = 500 * 1024 * 1024;  // 500 MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/x-m4v", "video/webm"];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Type de fichier non supporté" }, { status: 400 });
  }
  const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);
  const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
  if (file.size > maxSize) {
    return NextResponse.json({
      error: `Fichier trop volumineux (max ${isVideo ? "500" : "20"} MB)`,
    }, { status: 400 });
  }

  const ext = file.name.split(".").pop() ?? "jpg";
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  // ─── R2 si configuré, sinon fallback local ──────────────────────────────
  if (r2Configured()) {
    try {
      const key = `uploads/${filename}`;
      const result = await uploadToR2(key, buffer, file.type);
      return NextResponse.json({ url: result.url }, { status: 201 });
    } catch (err) {
      console.error("[upload] R2 upload failed:", err);
      return NextResponse.json({ error: "Échec upload R2" }, { status: 500 });
    }
  }

  // Fallback : stockage local
  const filepath = path.join(UPLOAD_DIR, filename);
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(filepath, buffer);
  return NextResponse.json({ url: `/uploads/${filename}` }, { status: 201 });
}
