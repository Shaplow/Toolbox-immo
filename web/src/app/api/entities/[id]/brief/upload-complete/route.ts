/**
 * POST /api/entities/[id]/brief/upload-complete
 *
 * Enregistre la pièce jointe du brief de fiche une fois le fichier déposé.
 * Miroir de `handleBriefAttachmentComplete` côté publication, sans multipart
 * (le plafond de 50 Mo tient dans un seul PUT).
 *
 * En cas d'échec de l'insert, l'objet est retiré du stockage : un fichier
 * orphelin dans R2 ne se voit nulle part et ne se nettoie jamais.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { canEditEntityBrief, canUserAccessEntity } from "@/lib/permissions/entityScope";
import { toUserRole } from "@/lib/permissions/role";
import { deleteObject } from "@/lib/storage";
import { loadEntityForAccess } from "@/lib/services/entity/entityAccess";
import { logEntityActivity } from "@/lib/services/entity/entityActivity";
import { BRIEF_ATTACHMENT_MIME_TYPES } from "@/lib/briefAttachmentTypes";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: entityId } = await params;

  const entity = await loadEntityForAccess(entityId);
  if (
    !entity ||
    !canUserAccessEntity(entity, role, userId) ||
    !canEditEntityBrief(role)
  ) {
    return NextResponse.json({ error: "Fiche introuvable" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    r2Key?: string;
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
  };
  const { r2Key, fileName, mimeType, sizeBytes } = body;

  if (!r2Key || typeof r2Key !== "string" || !fileName || !mimeType) {
    return NextResponse.json({ error: "r2Key, fileName et mimeType sont requis" }, { status: 400 });
  }
  // La clé doit appartenir à CETTE fiche : sans ce contrôle, un client pourrait
  // rattacher à sa fiche un objet déposé sous une autre.
  if (!r2Key.startsWith(`entities/${entityId}/brief/`)) {
    return NextResponse.json({ error: "Clé de stockage invalide" }, { status: 400 });
  }
  if (!BRIEF_ATTACHMENT_MIME_TYPES.includes(mimeType)) {
    return NextResponse.json({ error: "Type de fichier non supporté" }, { status: 400 });
  }

  try {
    const attachment = await prisma.entityBriefAttachment.create({
      data: {
        entityId,
        r2Key,
        fileName,
        mimeType,
        sizeBytes: typeof sizeBytes === "number" ? sizeBytes : null,
      },
      select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
    });

    await logEntityActivity(prisma, {
      entityId,
      actorId: userContext.actualUser.id,
      type: "BRIEF_UPDATED",
      payload: { action: "attachment_added", attachmentId: attachment.id, fileName },
    });

    return NextResponse.json(attachment, { status: 201 });
  } catch (err) {
    console.error(`[entity brief upload-complete] insert échoué, nettoyage key=${r2Key}:`, err);
    try {
      await deleteObject(r2Key);
    } catch (cleanupErr) {
      console.error(`[entity brief upload-complete] nettoyage échoué key=${r2Key}:`, cleanupErr);
    }
    return NextResponse.json({ error: "Enregistrement de la pièce jointe impossible" }, { status: 500 });
  }
}
