/**
 * GET /api/entities/[id]/rushes — liste des rushs (non supprimés) d'une fiche.
 * Auth : getUserContext(). Scope : canUserAccessEntity (404 anti-énum).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api/requireAuth";
import { canUserAccessEntity } from "@/lib/permissions/entityScope";
import { toUserRole } from "@/lib/permissions/role";
import { loadEntityForAccess } from "@/lib/services/entity/entityAccess";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;
  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: entityId } = await params;

  const entity = await loadEntityForAccess(entityId);
  if (!entity || !canUserAccessEntity(entity, role, userId)) {
    return NextResponse.json({ error: "Fiche introuvable" }, { status: 404 });
  }

  const rushes = await prisma.publicationRush.findMany({
    where: { entityId, deletedAt: null },
    orderBy: { uploadedAt: "desc" },
    include: { uploadedBy: { select: { id: true, name: true, email: true } } },
  });

  return NextResponse.json({ rushes });
}
