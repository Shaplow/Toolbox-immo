/**
 * GET /api/shoot-events/[id]/rushes — liste des rushs (non supprimés) d'un
 * événement. Auth : getUserContext(). Scope : canUserAccessEvent (404 anti-énum).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserContext } from "@/lib/userContext";
import { canUserAccessEvent } from "@/lib/permissions/eventScope";
import { toUserRole } from "@/lib/permissions/role";
import { loadEventForAccess } from "@/lib/services/event/eventRushAccess";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: eventId } = await params;

  const event = await loadEventForAccess(eventId);
  if (!event || !canUserAccessEvent(event, role, userId)) {
    return NextResponse.json({ error: "Événement introuvable" }, { status: 404 });
  }

  const rushes = await prisma.publicationRush.findMany({
    where: { eventId, deletedAt: null },
    orderBy: { uploadedAt: "desc" },
    include: { uploadedBy: { select: { id: true, name: true, email: true } } },
  });

  return NextResponse.json({ rushes });
}
