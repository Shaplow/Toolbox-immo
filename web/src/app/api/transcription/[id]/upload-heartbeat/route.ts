/**
 * POST /api/transcription/[id]/upload-heartbeat
 *
 * Signe de vie pendant un upload multipart long : touche `updatedAt` pour que le
 * sweep admin ne prenne pas le job pour un upload abandonné.
 *
 * Toute la logique (auth, ownership, idempotence) vit dans
 * `lib/upload/heartbeat.ts`, partagée avec le flux captions.
 */

import { NextResponse } from "next/server";
import { handleUploadHeartbeat } from "@/lib/upload/heartbeat";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handleUploadHeartbeat("transcription", id);
}
