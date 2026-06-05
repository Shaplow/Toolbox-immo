/**
 * GET /api/publications/[id]/rushes
 *
 * Retourne la liste des rushes non supprimés d'un slot.
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

  // Charger les rushes (soft-delete exclu)
  const rushes = await prisma.publicationRush.findMany({
    where: { slotId, deletedAt: null },
    orderBy: { uploadedAt: "desc" },
    include: {
      uploadedBy: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ rushes });
}
