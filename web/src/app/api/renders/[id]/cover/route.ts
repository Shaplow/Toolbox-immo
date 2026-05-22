import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deleteCoverCandidateAssets, queueCoverFramePackPreparation, toCoverSourceVideoUrl } from "@/lib/coverAuto";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { normalizeTemplateJSON } from "@/lib/templateNormalization";
import { IMPERSONATION_COOKIE_NAME, resolveUserContext } from "@/lib/userContext";
import type { CoverAutoConfig, TemplateJSON } from "@/types/template";

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
  const render = await prisma.render.findUnique({
    where: { id },
    include: {
      listing: { select: { userId: true } },
      template: true,
      coverFramePack: true,
    },
  });
  if (!render || !render.template || (!isAdmin && render.listing.userId !== userContext.effectiveUser.id)) {
    return NextResponse.json({ error: "Render introuvable" }, { status: 404 });
  }
  if (render.status !== "DONE" || !render.videoUrl) {
    return NextResponse.json({ error: "Le render vidéo doit être terminé" }, { status: 400 });
  }

  let config: CoverAutoConfig | undefined;
  try {
    config = normalizeTemplateJSON(JSON.parse(render.template.jsonData) as TemplateJSON).coverAutoConfig;
  } catch {
    return NextResponse.json({ error: "Template cover invalide" }, { status: 400 });
  }
  if (!config?.enabled) {
    return NextResponse.json({ error: "Cover semi-auto désactivée sur cette template" }, { status: 400 });
  }

  const sourceVideoUrl = toCoverSourceVideoUrl(render.videoUrl);
  let packId = render.coverFramePack?.id;
  if (packId) {
    await deleteCoverCandidateAssets(packId);
    await prisma.coverFrameCandidate.deleteMany({ where: { packId } });
    await prisma.coverFramePack.update({
      where: { id: packId },
      data: {
        status: "QUEUED",
        sourceVideoUrl,
        config: JSON.stringify(config),
        overlayGroupIds: JSON.stringify(config.overlayGroupIds ?? []),
        frameCount: config.frameCount ?? 36,
        selectedCandidateId: null,
        finalCoverUrl: null,
        finalCoverKey: null,
        errorMsg: null,
      },
    });
  } else {
    const pack = await prisma.coverFramePack.create({
      data: {
        userId: render.listing.userId,
        renderId: render.id,
        templateId: render.templateId,
        status: "QUEUED",
        sourceVideoUrl,
        frameCount: config.frameCount ?? 36,
        config: JSON.stringify(config),
        overlayGroupIds: JSON.stringify(config.overlayGroupIds ?? []),
      },
    });
    packId = pack.id;
  }

  queueCoverFramePackPreparation(packId);
  return NextResponse.json({ ok: true, packId, status: "QUEUED" }, { status: 202 });
}
