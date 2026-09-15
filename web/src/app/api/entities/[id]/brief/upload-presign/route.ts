/**
 * POST /api/entities/[id]/brief/upload-presign
 *
 * Pièce jointe du brief d'une FICHE — vocal, doc, photo de repérage. Miroir de
 * `publications/[id]/upload-presign` (kind `brief-attachment`), à ceci près que
 * le parent est une fiche : c'est là que travaille le vidéaste, et c'est donc là
 * qu'il doit pouvoir déposer un mot pour le monteur.
 *
 * Auth : requireUser(). Permission : canEditEntityBrief (ADMIN ou VIDEASTE),
 * alignée sur la whitelist de PATCH du champ `brief` — texte et pièces jointes
 * sont le même bloc à l'écran, ils obéissent à la même règle.
 *
 * Pas de multipart : 50 Mo de plafond, un seul PUT suffit toujours.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { canEditEntityBrief } from "@/lib/permissions/entityScope";
import { toUserRole } from "@/lib/permissions/role";
import { r2Configured, createPresignedUploadUrl } from "@/lib/r2";
import { entityBriefAttachmentKey } from "@/lib/r2Keys";
import { loadEntityForAccess } from "@/lib/services/entity/entityAccess";
import { canUserAccessEntity } from "@/lib/permissions/entityScope";
import { BRIEF_ATTACHMENT_MIME_TYPES } from "@/lib/briefAttachmentTypes";
import { UPLOAD_LIMITS, tooLargeMessage } from "@/lib/upload/limits";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: entityId } = await params;

  const entity = await loadEntityForAccess(entityId);
  // 404 anti-énumération : introuvable OU sans accès OU sans droit d'écriture.
  if (
    !entity ||
    !canUserAccessEntity(entity, role, userId) ||
    !canEditEntityBrief(role)
  ) {
    return NextResponse.json({ error: "Fiche introuvable" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
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
  if (!BRIEF_ATTACHMENT_MIME_TYPES.includes(contentType)) {
    return NextResponse.json({ error: "Type de fichier non supporté" }, { status: 400 });
  }
  if (size > UPLOAD_LIMITS.BRIEF_ATTACHMENT_MAX_BYTES) {
    return NextResponse.json(
      { error: tooLargeMessage(UPLOAD_LIMITS.BRIEF_ATTACHMENT_MAX_BYTES) },
      { status: 400 },
    );
  }

  // Sans R2 en dev, on bascule sur le PUT local — même interface côté client.
  // En prod, R2 reste obligatoire : pas de fallback disque.
  const useLocalFallback = !r2Configured() && process.env.NODE_ENV !== "production";
  if (!r2Configured() && !useLocalFallback) {
    return NextResponse.json({ error: "Service de stockage non configuré" }, { status: 503 });
  }

  const r2Key = entityBriefAttachmentKey(entityId, filename);

  if (useLocalFallback) {
    const localUrl = `/api/entities/${entityId}/brief/upload-local?r2Key=${encodeURIComponent(r2Key)}`;
    return NextResponse.json({ singleUrl: localUrl, r2Key });
  }

  const singleUrl = await createPresignedUploadUrl(r2Key, contentType, 3600, size);
  return NextResponse.json({ singleUrl, r2Key });
}
