/**
 * POST /api/shoot-events/[id]/rushes/upload-presign
 *
 * Génère des URL(s) pré-signées pour uploader un rush directement vers R2, au
 * niveau ÉVÉNEMENT (lot partagé). Miroir de publications/[id]/upload-presign,
 * restreint au kind `rush`.
 *
 * Auth : getUserContext(). Permission : canUploadEventRushes (ADMIN ou vidéaste
 * assigné). Clé R2 : eventRushKey → préfixe `shoot-events/{eventId}/`.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { canUploadEventRushes } from "@/lib/permissions/eventScope";
import { toUserRole } from "@/lib/permissions/role";
import { r2Configured, createPresignedUploadUrl } from "@/lib/r2";
import { createMultipartUpload, createPresignedUploadPartUrl } from "@/lib/r2Multipart";
import { eventRushKey } from "@/lib/r2Keys";
import { loadEventForAccess } from "@/lib/services/event/eventRushAccess";

const ALLOWED_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
  "image/jpeg",
  "image/png",
  "image/webp",
];
const MAX_SIZE = 20 * 1024 * 1024 * 1024; // 20 GB
const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100 MB
const PART_SIZE = 50 * 1024 * 1024; // 50 MB
const PART_URL_EXPIRY_SECONDS = 6 * 60 * 60; // 6h

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: eventId } = await params;

  const event = await loadEventForAccess(eventId);
  // 404 anti-énumération : introuvable OU non autorisé à uploader.
  if (!event || !canUploadEventRushes(event, role, userId)) {
    return NextResponse.json({ error: "Événement introuvable" }, { status: 404 });
  }

  const body = (await req.json()) as {
    filename?: string;
    contentType?: string;
    size?: number;
  };
  const { filename, contentType, size } = body;

  if (!filename || typeof filename !== "string" || !filename.trim()) {
    return NextResponse.json({ error: "Le champ 'filename' est requis" }, { status: 400 });
  }
  if (!contentType || typeof contentType !== "string") {
    return NextResponse.json({ error: "Le champ 'contentType' est requis" }, { status: 400 });
  }
  if (typeof size !== "number" || size <= 0) {
    return NextResponse.json({ error: "Le champ 'size' (octets) est requis" }, { status: 400 });
  }
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    return NextResponse.json({ error: "Type de fichier non supporté" }, { status: 400 });
  }
  if (size > MAX_SIZE) {
    return NextResponse.json({ error: "Fichier trop volumineux (max 20 GB)" }, { status: 400 });
  }

  if (!r2Configured()) {
    return NextResponse.json({ error: "Service de stockage non configuré" }, { status: 503 });
  }

  const r2Key = eventRushKey(eventId, filename);

  if (size > MULTIPART_THRESHOLD) {
    const { uploadId } = await createMultipartUpload(r2Key, contentType);
    const partCount = Math.ceil(size / PART_SIZE);
    const partUrls: { partNumber: number; url: string }[] = [];
    for (let i = 1; i <= partCount; i++) {
      const url = await createPresignedUploadPartUrl(r2Key, uploadId, i, PART_URL_EXPIRY_SECONDS);
      partUrls.push({ partNumber: i, url });
    }
    return NextResponse.json({ multipart: { uploadId, partSize: PART_SIZE, partUrls }, r2Key });
  }

  const singleUrl = await createPresignedUploadUrl(r2Key, contentType, 3600, size);
  return NextResponse.json({ singleUrl, r2Key });
}
