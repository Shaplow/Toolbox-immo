/**
 * GET /api/publications/[id]/activity — historique d'activité d'un slot
 *
 * Ordre : du plus récent au plus ancien (newest first).
 * Auth : canUserAccessSlot → 404 si refusé (anti-énumération).
 *
 * Pagination par cursor sur createdAt :
 *   ?limit=50          — défaut 50, max 200
 *   ?before=<ISO>      — retourne les items antérieurs à cette date (cursor exclusif)
 *
 * Retour : { items: PublicationActivity[], hasMore: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: slotId } = await params;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: { id: true, assigneeMonteurId: true, assigneeCmId: true },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);

  const rawLimit = parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT);

  const beforeRaw = searchParams.get("before");
  const beforeDate = beforeRaw ? new Date(beforeRaw) : null;
  const beforeValid = beforeDate && !isNaN(beforeDate.getTime());

  const items = await prisma.publicationActivity.findMany({
    where: {
      slotId,
      ...(beforeValid ? { createdAt: { lt: beforeDate! } } : {}),
    },
    orderBy: { createdAt: "desc" },
    // Fetch limit+1 pour détecter s'il y a une page suivante sans double requête.
    take: limit + 1,
    include: {
      actor: { select: { id: true, name: true } },
    },
  });

  const hasMore = items.length > limit;
  const pageItems = hasMore ? items.slice(0, limit) : items;

  return NextResponse.json({ items: pageItems, hasMore });
}
