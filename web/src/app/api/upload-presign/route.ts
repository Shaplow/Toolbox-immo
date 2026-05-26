import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { getUserContext } from "@/lib/userContext";
import { createPresignedUploadUrl, getR2PublicUrl, r2Configured } from "@/lib/r2";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/x-m4v", "video/webm"];
const ALLOWED_AUDIO_TYPES = ["audio/mpeg", "audio/wav", "audio/aac", "audio/mp4", "audio/ogg", "audio/x-m4a", "audio/flac"];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES, ...ALLOWED_AUDIO_TYPES];
const MAX_IMAGE_SIZE = 50 * 1024 * 1024;
const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024;
const MAX_AUDIO_SIZE = 200 * 1024 * 1024;

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
