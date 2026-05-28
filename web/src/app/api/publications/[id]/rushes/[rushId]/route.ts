/**
 * GET  /api/publications/[id]/rushes/[rushId] → URL de téléchargement presigned (1h)
 * DELETE /api/publications/[id]/rushes/[rushId] → soft-delete + logActivity
 *
 * Auth : getUserContext(). Scope : canUserAccessSlot (404 anti-énumération).
 * DELETE : ADMIN ou auteur du rush (canDeleteRushes).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { canDeleteRushes } from "@/lib/permissions/publications";
import { toUserRole } from "@/lib/permissions/role";
import { createPresignedDownloadUrl } from "@/lib/r2";
import { logActivity } from "@/lib/services/slot/activity";

type Params = { params: Promise<{ id: string; rushId: string }> };

// ─── GET (presigned download URL) ─────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: slotId, rushId } = await params;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: { id: true, status: true, assigneeMonteurId: true, assigneeCmId: true },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

  const rush = await prisma.publicationRush.findFirst({
    where: { id: rushId, slotId, deletedAt: null },
  });

  if (!rush) {
    return NextResponse.json({ error: "Rush introuvable" }, { status: 404 });
  }

  try {
    const downloadUrl = await createPresignedDownloadUrl(rush.r2Key, rush.fileName, 3600);
    return NextResponse.json({ downloadUrl });
  } catch {
    return NextResponse.json({ error: "Erreur de génération de l'URL de téléchargement" }, { status: 500 });
  }
}

// ─── DELETE (soft-delete) ──────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: slotId, rushId } = await params;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: { id: true, status: true, assigneeMonteurId: true, assigneeCmId: true },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

  const rush = await prisma.publicationRush.findFirst({
    where: { id: rushId, slotId, deletedAt: null },
  });

  if (!rush) {
    return NextResponse.json({ error: "Rush introuvable" }, { status: 404 });
  }

  if (!canDeleteRushes({ id: userId, role }, rush)) {
    return NextResponse.json({ error: "Permission refusée" }, { status: 403 });
  }

  await prisma.publicationRush.update({
    where: { id: rushId },
    data: { deletedAt: new Date() },
  });

  await logActivity(prisma, {
    slotId,
    actorId: userId,
    type: "RUSHES_DELETED",
    payload: { rushId, fileName: rush.fileName },
  });

  return NextResponse.json({ ok: true });
}
