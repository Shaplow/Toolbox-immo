/**
 * GET    /api/entities/[id]/rushes/[rushId] → URL de téléchargement presigned.
 * DELETE /api/entities/[id]/rushes/[rushId] → soft-delete + logEntityActivity.
 *
 * Auth : getUserContext(). Scope : canUserAccessEntity (404 anti-énumération).
 * DELETE : ADMIN ou auteur du rush.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api/requireAuth";
import { canUserAccessEntity } from "@/lib/permissions/entityScope";
import { toUserRole } from "@/lib/permissions/role";
import { getDownloadUrl } from "@/lib/storage";
import { logEntityActivity } from "@/lib/services/entity/entityActivity";
import { loadEntityForAccess } from "@/lib/services/entity/entityAccess";

type Params = { params: Promise<{ id: string; rushId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;
  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: entityId, rushId } = await params;

  const entity = await loadEntityForAccess(entityId);
  if (!entity || !canUserAccessEntity(entity, role, userId)) {
    return NextResponse.json({ error: "Fiche introuvable" }, { status: 404 });
  }

  const rush = await prisma.publicationRush.findFirst({
    where: { id: rushId, entityId, deletedAt: null },
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
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;
  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: entityId, rushId } = await params;

  const entity = await loadEntityForAccess(entityId);
  if (!entity || !canUserAccessEntity(entity, role, userId)) {
    return NextResponse.json({ error: "Fiche introuvable" }, { status: 404 });
  }

  const rush = await prisma.publicationRush.findFirst({
    where: { id: rushId, entityId, deletedAt: null },
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
  await logEntityActivity(prisma, {
    entityId,
    actorId: userContext.actualUser.id,
    type: "RUSHES_DELETED",
    payload: { rushId, fileName: rush.fileName },
  });

  return NextResponse.json({ ok: true });
}
