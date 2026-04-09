import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { auth } from "@/lib/auth";
import { createPresignedUploadUrl, getR2PublicUrl, r2Configured } from "@/lib/r2";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/x-m4v", "video/webm"];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];
const MAX_IMAGE_SIZE = 50 * 1024 * 1024;
const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const body = await req.json() as { filename?: string; contentType?: string; size?: number };
  const { filename, contentType, size } = body;

  if (!contentType || !ALLOWED_TYPES.includes(contentType)) {
    return NextResponse.json({ error: "Type de fichier non supporté" }, { status: 400 });
  }

  const isVideo = ALLOWED_VIDEO_TYPES.includes(contentType);
  const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;

  if (typeof size === "number" && size > maxSize) {
    return NextResponse.json(
      { error: `Fichier trop volumineux (max ${isVideo ? "2000" : "50"} MB)` },
      { status: 400 }
    );
  }

  const ext = path.extname(filename ?? "").replace(/^\./, "") || "bin";
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
  const r2Key = `uploads/${key}`;
  const uploadUrl = await createPresignedUploadUrl(r2Key, contentType);
  const publicUrl = getR2PublicUrl(r2Key);

  return NextResponse.json({ uploadUrl, publicUrl, key: r2Key });
}
