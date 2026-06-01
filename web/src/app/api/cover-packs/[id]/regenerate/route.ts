import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { deleteCoverCandidateAssets, queueCoverFramePackPreparation } from "@/lib/coverAuto";
import { hasTool, TOOLS } from "@/lib/permissions";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const isAdmin = userContext.canAdminBypass;
  const effectiveUserId = userContext.effectiveUser.id;
  if (!isAdmin && !(await hasTool(effectiveUserId, TOOLS.COVERS))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { id } = await params;
  // Charge la chaîne pack → render → publicationSlot pour que CM/MONTEUR
  // assignés au slot puissent régénérer un pack créé par le system/admin
  // (auto-template). Sans ça, le pack auto reste verrouillé sur son owner.
  const pack = await prisma.coverFramePack.findUnique({
    where: { id },
    include: {
      render: {
        select: {
          publicationSlot: {
            select: {
              assigneeMonteurId: true,
              assigneeCmId: true,
              assigneeVideasteId: true,
            },
          },
        },
      },
    },
  });
  if (!pack) return NextResponse.json({ error: "Pack introuvable" }, { status: 404 });

  if (!isAdmin) {
    const isOwner = pack.userId === effectiveUserId;
    const slot = pack.render?.publicationSlot ?? null;
    const role = toUserRole(userContext.effectiveUser.role);
    const isAssignedToSlot = !!slot && canUserAccessSlot(slot, role, effectiveUserId);
    if (!isOwner && !isAssignedToSlot) {
      return NextResponse.json({ error: "Pack introuvable" }, { status: 404 });
    }
  }

  await deleteCoverCandidateAssets(id);
  await prisma.coverFrameCandidate.deleteMany({ where: { packId: id } });
  await prisma.coverFramePack.update({
    where: { id },
    data: {
      status: "QUEUED",
      selectedCandidateId: null,
      finalCoverUrl: null,
      finalCoverKey: null,
      errorMsg: null,
    },
  });

  queueCoverFramePackPreparation(id);
  return NextResponse.json({ ok: true, status: "QUEUED", candidates: [] }, { status: 202 });
}
