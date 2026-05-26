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
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { canEditBrief } from "@/lib/permissions/publications";
import { toUserRole } from "@/lib/permissions/role";
import { createPresignedDownloadUrl, deleteFromR2 } from "@/lib/r2";
import { logActivity } from "@/lib/publications/activity";

type Params = { params: Promise<{ id: string; attId: string }> };

// ─── GET (presigned download URL) ─────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: slotId, attId } = await params;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: { id: true, status: true, assigneeMonteurId: true, assigneeCmId: true },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

  // Vérifier que l'attachment appartient bien à ce slot (via brief → slot)
  const attachment = await prisma.publicationBriefAttachment.findFirst({
    where: { id: attId, brief: { slotId } },
  });

  if (!attachment) {
    return NextResponse.json({ error: "Pièce jointe introuvable" }, { status: 404 });
  }

  try {
    const downloadUrl = await createPresignedDownloadUrl(attachment.r2Key, attachment.fileName, 3600);
    return NextResponse.json({ downloadUrl });
  } catch {
    return NextResponse.json({ error: "Erreur de génération de l'URL de téléchargement" }, { status: 500 });
  }
}

// ─── DELETE (hard delete + R2 cleanup) ────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: slotId, attId } = await params;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: { id: true, status: true, assigneeMonteurId: true, assigneeCmId: true },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

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

  // Cleanup R2 (best-effort — ne pas faire échouer la réponse si R2 échoue)
  try {
    await deleteFromR2(attachment.r2Key);
  } catch (err) {
    console.error(`[brief-attachment DELETE] R2 cleanup failed for key=${attachment.r2Key}:`, err);
  }

  await logActivity(prisma, {
    slotId,
    actorId: userId,
    type: "BRIEF_UPDATED",
    payload: { action: "attachment_deleted", attachmentId: attId, fileName: attachment.fileName },
  });

  return NextResponse.json({ ok: true });
}
