/**
 * GET    /api/entities/[id]/brief/attachments/[attId] → { downloadUrl } (1 h)
 * DELETE /api/entities/[id]/brief/attachments/[attId] → suppression + nettoyage
 *
 * Lecture ouverte à qui accède à la fiche — c'est tout l'intérêt : le monteur
 * doit pouvoir écouter le vocal du vidéaste depuis sa publication, sans droit
 * d'écriture. Suppression réservée à qui peut écrire le brief.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { canEditEntityBrief, canUserAccessEntity } from "@/lib/permissions/entityScope";
import { toUserRole } from "@/lib/permissions/role";
import { getDownloadUrl, deleteObject } from "@/lib/storage";
import { loadEntityForAccess } from "@/lib/services/entity/entityAccess";
import { logEntityActivity } from "@/lib/services/entity/entityActivity";

type Params = { params: Promise<{ id: string; attId: string }> };

/** Charge la fiche + la pièce jointe, en refusant tout par un 404 uniforme. */
async function resolve(entityId: string, attId: string, role: string, userId: string) {
  const entity = await loadEntityForAccess(entityId);
  if (!entity || !canUserAccessEntity(entity, toUserRole(role), userId)) return null;
  // `entityId` dans le WHERE : une pièce jointe d'une AUTRE fiche ne peut pas
  // être atteinte en devinant son id.
  return prisma.entityBriefAttachment.findFirst({ where: { id: attId, entityId } });
}

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id: entityId, attId } = await params;
  const { effectiveUser } = auth.ctx;

  const attachment = await resolve(entityId, attId, effectiveUser.role, effectiveUser.id);
  if (!attachment) {
    return NextResponse.json({ error: "Pièce jointe introuvable" }, { status: 404 });
  }

  try {
    const downloadUrl = await getDownloadUrl(attachment.r2Key, attachment.fileName);
    return NextResponse.json({ downloadUrl });
  } catch {
    return NextResponse.json({ error: "Téléchargement indisponible" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id: entityId, attId } = await params;
  const { effectiveUser, actualUser } = auth.ctx;

  const attachment = await resolve(entityId, attId, effectiveUser.role, effectiveUser.id);
  if (!attachment) {
    return NextResponse.json({ error: "Pièce jointe introuvable" }, { status: 404 });
  }
  if (!canEditEntityBrief(toUserRole(effectiveUser.role))) {
    return NextResponse.json({ error: "Permission refusée" }, { status: 403 });
  }

  await prisma.entityBriefAttachment.delete({ where: { id: attId } });

  // Nettoyage best-effort : un objet orphelin coûte moins cher qu'une ligne
  // fantôme qui promet un fichier introuvable.
  try {
    await deleteObject(attachment.r2Key);
  } catch (err) {
    console.error(`[entity brief attachment] nettoyage échoué key=${attachment.r2Key}:`, err);
  }

  await logEntityActivity(prisma, {
    entityId,
    actorId: actualUser.id,
    type: "BRIEF_UPDATED",
    payload: { action: "attachment_deleted", attachmentId: attId, fileName: attachment.fileName },
  });

  return NextResponse.json({ ok: true });
}
