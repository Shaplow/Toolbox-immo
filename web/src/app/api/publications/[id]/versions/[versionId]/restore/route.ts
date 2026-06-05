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
import { prisma } from "@/lib/prisma";
import { canRestoreVersion } from "@/lib/permissions/publications";
import { logActivity } from "@/lib/services/slot/activity";
import { resolveSlotContext } from "@/lib/services/slot/resolveSlotContext";

type Params = { params: Promise<{ id: string; versionId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { id: slotId, versionId } = await params;
  const r = await resolveSlotContext(slotId);
  if (r.status === 401) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (r.status === 404) return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  const { userContext, role } = r.ctx;

  if (!canRestoreVersion({ role })) {
    return NextResponse.json({ error: "Seul un ADMIN peut restaurer une version" }, { status: 403 });
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
