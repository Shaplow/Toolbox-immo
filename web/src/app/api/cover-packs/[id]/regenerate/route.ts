import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { deleteCoverCandidateAssets, queueCoverFramePackPreparation } from "@/lib/coverAuto";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.COVERS))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { id } = await params;
  const pack = await prisma.coverFramePack.findUnique({ where: { id } });
  if (!pack) return NextResponse.json({ error: "Pack introuvable" }, { status: 404 });
  if (!isAdmin && pack.userId !== userContext.effectiveUser.id) {
    return NextResponse.json({ error: "Pack introuvable" }, { status: 404 });
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
