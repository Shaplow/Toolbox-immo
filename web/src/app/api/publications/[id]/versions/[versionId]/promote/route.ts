/**
 * POST /api/publications/[id]/versions/[versionId]/promote
 *
 * Promeut une version en version courante du slot.
 * Auth : ADMIN seul (canPromoteVersion).
 *
 * Effets :
 * 1. Update PublicationSlot.currentVersionId = versionId.
 * 2. applyAutoTransition(VERSION_PROMOTED) → passage en EDIT_APPROVED si applicable.
 * 3. Log VERSION_PROMOTED + CURRENT_VERSION_CHANGED.
 *
 * Erreurs :
 * - 403 si pas ADMIN.
 * - 400 si version supprimée ou déjà courante.
 * - 404 si slot ou version introuvables / non accessibles.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { canPromoteVersion } from "@/lib/permissions/publications";
import { toUserRole } from "@/lib/permissions/role";
import { logActivity } from "@/lib/services/slot/activity";
import { applyAutoTransition } from "@/lib/services/slot/transitions";

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
  if (!canPromoteVersion({ role })) {
    return NextResponse.json({ error: "Seul un ADMIN peut promouvoir une version" }, { status: 403 });
  }

  const { id: slotId, versionId } = await params;

  // 3. Charger le slot
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      status: true,
      currentVersionId: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
    },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

  // 4. Charger la version
  const version = await prisma.publicationVersion.findFirst({
    where: { id: versionId, slotId },
    select: { id: true, versionNumber: true, deletedAt: true },
  });

  if (!version) {
    return NextResponse.json({ error: "Version introuvable" }, { status: 404 });
  }

  if (version.deletedAt !== null) {
    return NextResponse.json(
      { error: "Impossible de promouvoir une version supprimée" },
      { status: 400 }
    );
  }

  if (slot.currentVersionId === versionId) {
    return NextResponse.json(
      { error: "Cette version est déjà la version courante" },
      { status: 400 }
    );
  }

  // 5. Transaction : update slot + log activités + auto-transition (atomique)
  const previousVersionId = slot.currentVersionId;

  await prisma.$transaction(async (tx) => {
    // Update la version courante
    await tx.publicationSlot.update({
      where: { id: slotId },
      data: { currentVersionId: versionId },
    });

    // Log VERSION_PROMOTED
    await logActivity(tx as typeof prisma, {
      slotId,
      actorId: userId,
      type: "VERSION_PROMOTED",
      payload: {
        versionId,
        versionNumber: version.versionNumber,
        previousVersionId: previousVersionId ?? null,
      },
    });

    // Log CURRENT_VERSION_CHANGED
    await logActivity(tx as typeof prisma, {
      slotId,
      actorId: userId,
      type: "CURRENT_VERSION_CHANGED",
      payload: { from: previousVersionId ?? null, to: versionId },
    });

    // Auto-transition dans la même tx — évite un statut figé sur EDIT_REVIEW
    // si le process crash entre le commit de la tx et l'appel hors-tx.
    await applyAutoTransition(tx as typeof prisma, slotId, slot.status, "VERSION_PROMOTED", userId);
  });

  return NextResponse.json({ ok: true, currentVersionId: versionId });
}
