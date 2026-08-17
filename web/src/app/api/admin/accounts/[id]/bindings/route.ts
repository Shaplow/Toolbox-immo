/**
 * GET /api/admin/accounts/[id]/bindings — liste les PatternBinding du compte
 * (consommé par AddSlotModal). Le CRUD des bindings passe par
 * /api/admin/accounts/[id]/recipes (V2.7 — POST/PATCH/DELETE sans
 * consommateur supprimés) ; reste aussi POST bindings/bulk-replace-assignee.
 *
 * Admin-only.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";



interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const { id } = await params;
  // Inclure les assignees résolus (Prisma renvoie undefined sans select
  // explicite — bug réel : AddSlotModal lit `defaultAssigneeMonteur.name`
  // et obtient null/undefined sans cet include).
  const bindings = await prisma.patternBinding.findMany({
    where: { accountId: id },
    include: {
      patternTemplate: true,
      defaultAssigneeMonteur: { select: { id: true, name: true } },
      defaultAssigneeCm: { select: { id: true, name: true } },
      defaultAssigneeVideaste: { select: { id: true, name: true } },
    },
    orderBy: [{ publishTime: "asc" }],
  });
  return NextResponse.json(bindings);
}
