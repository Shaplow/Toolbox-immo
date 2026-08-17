/**
 * POST /api/entities/[id]/rushes/upload-presign
 *
 * Génère des URL(s) pré-signées pour uploader un rush directement vers R2, au
 * niveau FICHE (lot partagé). Miroir de shoot-events/[id]/rushes/upload-presign,
 * restreint au kind `rush`.
 *
 * Auth : getUserContext(). Permission : canUploadEntityRushes (ADMIN ou vidéaste
 * assigné). Clé R2 : entityRushKey → préfixe `entities/{entityId}/`.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { canUploadEntityRushes } from "@/lib/permissions/entityScope";
import { toUserRole } from "@/lib/permissions/role";
import { r2Configured, createPresignedUploadUrl } from "@/lib/r2";
import { createMultipartUpload, createPresignedUploadPartUrl } from "@/lib/r2Multipart";
import { entityRushKey } from "@/lib/r2Keys";
import { loadEntityForAccess } from "@/lib/services/entity/entityAccess";
import { UPLOAD_LIMITS, MULTIPART, tooLargeMessage } from "@/lib/upload/limits";

const ALLOWED_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
  "image/jpeg",
  "image/png",
  "image/webp",
];
// Plafonds et paramètres multipart : source unique dans `lib/upload/limits.ts`.
const MAX_SIZE = UPLOAD_LIMITS.RUSH_MAX_BYTES;
const MULTIPART_THRESHOLD = MULTIPART.THRESHOLD_BYTES;
const PART_SIZE = MULTIPART.PART_SIZE_BYTES;
const PART_URL_EXPIRY_SECONDS = MULTIPART.PART_URL_EXPIRY_SECONDS;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: entityId } = await params;

  const entity = await loadEntityForAccess(entityId);
  // 404 anti-énumération : introuvable OU non autorisé à uploader.
  if (!entity || !canUploadEntityRushes(entity, role, userId)) {
    return NextResponse.json({ error: "Fiche introuvable" }, { status: 404 });
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
    return NextResponse.json({ error: tooLargeMessage(MAX_SIZE) }, { status: 400 });
  }

  if (!r2Configured()) {
    return NextResponse.json({ error: "Service de stockage non configuré" }, { status: 503 });
  }

  const r2Key = entityRushKey(entityId, filename);

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
