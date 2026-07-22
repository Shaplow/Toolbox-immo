/**
 * GET    /api/shoot-events/[id]/rushes/[rushId] → URL de téléchargement presigned.
 * DELETE /api/shoot-events/[id]/rushes/[rushId] → soft-delete + logEventActivity.
 *
 * Auth : getUserContext(). Scope : canUserAccessEvent (404 anti-énumération).
 * DELETE : ADMIN ou auteur du rush.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserContext } from "@/lib/userContext";
import { canUserAccessEvent } from "@/lib/permissions/eventScope";
import { toUserRole } from "@/lib/permissions/role";
import { getDownloadUrl } from "@/lib/storage";
import { logEventActivity } from "@/lib/services/event/eventActivity";
import { loadEventForAccess } from "@/lib/services/event/eventRushAccess";

type Params = { params: Promise<{ id: string; rushId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: eventId, rushId } = await params;

  const event = await loadEventForAccess(eventId);
  if (!event || !canUserAccessEvent(event, role, userId)) {
    return NextResponse.json({ error: "Événement introuvable" }, { status: 404 });
  }

  const rush = await prisma.publicationRush.findFirst({
    where: { id: rushId, eventId, deletedAt: null },
  });
  if (!rush) {
    return NextResponse.json({ error: "Rush introuvable" }, { status: 404 });
  }

  try {
    const downloadUrl = await getDownloadUrl(rush.r2Key, rush.fileName);
    return NextResponse.json({ downloadUrl });
  } catch {
    return NextResponse.json({ error: "Erreur de génération de l'URL" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: eventId, rushId } = await params;

  const event = await loadEventForAccess(eventId);
  if (!event || !canUserAccessEvent(event, role, userId)) {
    return NextResponse.json({ error: "Événement introuvable" }, { status: 404 });
  }

  const rush = await prisma.publicationRush.findFirst({
    where: { id: rushId, eventId, deletedAt: null },
    select: { id: true, fileName: true, uploadedByUserId: true },
  });
  if (!rush) {
    return NextResponse.json({ error: "Rush introuvable" }, { status: 404 });
  }

  // ADMIN ou auteur du rush.
  if (role !== "ADMIN" && rush.uploadedByUserId !== userId) {
    return NextResponse.json({ error: "Permission refusée" }, { status: 403 });
  }

  await prisma.publicationRush.update({
    where: { id: rushId },
    data: { deletedAt: new Date() },
  });
  await logEventActivity(prisma, {
    eventId,
    actorId: userContext.actualUser.id,
    type: "EVENT_RUSHES_DELETED",
    payload: { rushId, fileName: rush.fileName },
  });

  return NextResponse.json({ ok: true });
}
