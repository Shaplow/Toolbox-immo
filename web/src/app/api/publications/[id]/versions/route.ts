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
import { prisma } from "@/lib/prisma";
import { resolveSlotContext } from "@/lib/services/slot/resolveSlotContext";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id: slotId } = await params;
  const r = await resolveSlotContext(slotId);
  if (r.status === 401) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (r.status === 404) return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  const { role } = r.ctx;

  // Charger les versions (ADMIN voit tout, autres voient only non-deleted)
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
