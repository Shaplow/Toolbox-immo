/**
 * POST /api/publications/[id]/versions/[versionId]/restore
 *
 * Restaure une version soft-deleted (remet deletedAt à null).
 * Auth : ADMIN seul (canRestoreVersion).
 *
 * Décision : un type dédié VERSION_RESTORED est ajouté à ActivityType
 * pour distinguer clairement la restauration d'un upload initial.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { canRestoreVersion } from "@/lib/permissions/publications";
import { toUserRole } from "@/lib/permissions/role";
import { logActivity } from "@/lib/services/slot/activity";

type Params = { params: Promise<{ id: string; versionId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  // 1. Auth
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;

  // 2. Permission : ADMIN seul
  if (!canRestoreVersion({ role })) {
    return NextResponse.json({ error: "Seul un ADMIN peut restaurer une version" }, { status: 403 });
  }

  const { id: slotId, versionId } = await params;

  // 3. Charger le slot
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: { id: true, status: true, assigneeMonteurId: true, assigneeCmId: true, assigneeVideasteId: true },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

  // 4. Charger la version (doit être soft-deleted)
  const version = await prisma.publicationVersion.findFirst({
    where: { id: versionId, slotId },
    select: { id: true, versionNumber: true, fileName: true, deletedAt: true },
  });

  if (!version) {
    return NextResponse.json({ error: "Version introuvable" }, { status: 404 });
  }

  if (version.deletedAt === null) {
    return NextResponse.json(
      { error: "Cette version n'est pas supprimée" },
      { status: 400 }
    );
  }

  // 5. Restaurer
  await prisma.publicationVersion.update({
    where: { id: versionId },
    data: { deletedAt: null },
  });

  await logActivity(prisma, {
    slotId,
    actorId: userContext.actualUser.id,
    type: "VERSION_RESTORED",
    payload: { versionId, versionNumber: version.versionNumber, fileName: version.fileName },
  });

  return NextResponse.json({ ok: true });
}
