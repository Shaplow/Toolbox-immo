/**
 * GET /api/publications/[id]/versions
 *
 * Retourne les versions de montage d'un slot, triées par versionNumber DESC.
 * - ADMIN : inclut les versions soft-deleted (deletedAt non null).
 * - Autres rôles : exclut les soft-deleted.
 *
 * Auth : getUserContext(). Scope : canUserAccessSlot (404 anti-énumération).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  // 1. Auth
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: slotId } = await params;

  // 2. Vérifier accès au slot
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: { id: true, status: true, assigneeMonteurId: true, assigneeCmId: true },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

  // 3. Charger les versions (ADMIN voit tout, autres voient only non-deleted)
  const isAdmin = role === "ADMIN";

  const versions = await prisma.publicationVersion.findMany({
    where: {
      slotId,
      ...(isAdmin ? {} : { deletedAt: null }),
    },
    orderBy: { versionNumber: "desc" },
    include: {
      uploadedBy: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ versions });
}
