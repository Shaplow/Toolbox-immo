/**
 * GET    /api/publications/[id]/brief/attachments/[attId]
 *   → { downloadUrl: string } (presigned, 1h)
 *
 * DELETE /api/publications/[id]/brief/attachments/[attId]
 *   → hard delete + R2 cleanup + logActivity BRIEF_UPDATED
 *
 * Auth : getUserContext(). Scope : canUserAccessSlot (404 anti-énumération).
 * DELETE : permission canEditBrief (ADMIN ou CM assigné).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canEditBrief } from "@/lib/permissions/publications";
import { getDownloadUrl, deleteObject } from "@/lib/storage";
import { logActivity } from "@/lib/services/slot/activity";
import { resolveSlotContext } from "@/lib/services/slot/resolveSlotContext";

type Params = { params: Promise<{ id: string; attId: string }> };

// ─── GET (presigned download URL) ─────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const { id: slotId, attId } = await params;
  const r = await resolveSlotContext(slotId);
  if (r.status === 401) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (r.status === 404) return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });

  // Vérifier que l'attachment appartient bien à ce slot (via brief → slot)
  const attachment = await prisma.publicationBriefAttachment.findFirst({
    where: { id: attId, brief: { slotId } },
  });

  if (!attachment) {
    return NextResponse.json({ error: "Pièce jointe introuvable" }, { status: 404 });
  }

  try {
    const downloadUrl = await getDownloadUrl(attachment.r2Key, attachment.fileName);
    return NextResponse.json({ downloadUrl });
  } catch {
    return NextResponse.json({ error: "Erreur de génération de l'URL de téléchargement" }, { status: 500 });
  }
}

// ─── DELETE (hard delete + R2 cleanup) ────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id: slotId, attId } = await params;
  const r = await resolveSlotContext(slotId);
  if (r.status === 401) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (r.status === 404) return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  const { userContext, slot, role, userId } = r.ctx;

  if (!canEditBrief({ id: userId, role }, slot)) {
    return NextResponse.json({ error: "Permission refusée" }, { status: 403 });
  }

  const attachment = await prisma.publicationBriefAttachment.findFirst({
    where: { id: attId, brief: { slotId } },
  });

  if (!attachment) {
    return NextResponse.json({ error: "Pièce jointe introuvable" }, { status: 404 });
  }

  // Hard delete (FK cascade géré par Prisma)
  await prisma.publicationBriefAttachment.delete({ where: { id: attId } });

  // Cleanup storage (R2 ou disque local) — best-effort, on n'échoue pas si fail.
  try {
    await deleteObject(attachment.r2Key);
  } catch (err) {
    console.error(`[brief-attachment DELETE] storage cleanup failed for key=${attachment.r2Key}:`, err);
  }

  await logActivity(prisma, {
    slotId,
    actorId: userContext.actualUser.id,
    type: "BRIEF_UPDATED",
    payload: { action: "attachment_deleted", attachmentId: attId, fileName: attachment.fileName },
  });

  return NextResponse.json({ ok: true });
}
