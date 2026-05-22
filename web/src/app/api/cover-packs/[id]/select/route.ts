import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deleteCoverCandidateAssets, renderFinalCover } from "@/lib/coverAuto";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { IMPERSONATION_COOKIE_NAME, resolveUserContext } from "@/lib/userContext";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const userContext = await resolveUserContext(session, req.cookies.get(IMPERSONATION_COOKIE_NAME)?.value ?? null);
  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.COVERS))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as {
    candidateId?: string;
    overlayOffsetX?: number;
    overlayOffsetY?: number;
  };
  if (!body.candidateId) {
    return NextResponse.json({ error: "candidateId requis" }, { status: 400 });
  }

  const pack = await prisma.coverFramePack.findUnique({ where: { id } });
  if (!pack) return NextResponse.json({ error: "Pack introuvable" }, { status: 404 });
  if (!isAdmin && pack.userId !== userContext.effectiveUser.id) {
    return NextResponse.json({ error: "Pack introuvable" }, { status: 404 });
  }

  if (pack.finalCoverUrl && pack.selectedCandidateId === body.candidateId) {
    await prisma.coverFramePack.update({
      where: { id },
      data: { status: "SELECTED", errorMsg: null },
    });
    return NextResponse.json({ ok: true, finalCoverUrl: pack.finalCoverUrl });
  }

  const offsetX = typeof body.overlayOffsetX === "number" ? body.overlayOffsetX : 0;
  const offsetY = typeof body.overlayOffsetY === "number" ? body.overlayOffsetY : 0;

  try {
    const final = await renderFinalCover(id, body.candidateId, offsetX, offsetY);
    await prisma.coverFramePack.update({
      where: { id },
      data: {
        status: "SELECTED",
        selectedCandidateId: body.candidateId,
        overlayOffsetX: offsetX,
        overlayOffsetY: offsetY,
        finalCoverUrl: final.url,
        finalCoverKey: final.key,
        errorMsg: null,
      },
    });

    await deleteCoverCandidateAssets(id);
    await prisma.coverFrameCandidate.deleteMany({ where: { packId: id } });

    return NextResponse.json({ ok: true, finalCoverUrl: final.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const latest = await prisma.coverFramePack.findUnique({
      where: { id },
      select: { finalCoverUrl: true, selectedCandidateId: true },
    });
    if (latest?.finalCoverUrl && latest.selectedCandidateId === body.candidateId) {
      await prisma.coverFramePack.update({
        where: { id },
        data: { status: "SELECTED", errorMsg: null },
      });
      return NextResponse.json({ ok: true, finalCoverUrl: latest.finalCoverUrl });
    }
    await prisma.coverFramePack.update({
      where: { id },
      data: { status: "FAILED", errorMsg: message },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
