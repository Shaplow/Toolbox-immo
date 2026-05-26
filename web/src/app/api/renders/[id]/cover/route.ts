import { NextRequest, NextResponse } from "next/server";
import { deleteCoverCandidateAssets, queueCoverFramePackPreparation, toCoverSourceVideoUrl } from "@/lib/coverAuto";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getUserContext } from "@/lib/userContext";
import type { CoverAutoConfig } from "@/types/template";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
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
      publicationSlot: {
        select: {
          pattern: { select: { id: true, coverMode: true, coverConfig: true, templateId: true } },
        },
      },
    },
  });
  if (!render || !render.template || (!isAdmin && render.listing.userId !== userContext.effectiveUser.id)) {
    return NextResponse.json({ error: "Render introuvable" }, { status: 404 });
  }
  if (render.status !== "DONE" || !render.videoUrl) {
    return NextResponse.json({ error: "Le render vidéo doit être terminé" }, { status: 400 });
  }

  // Phase 2.0 — résolution via coverPresetName → TemplateCoverPreset
  const slotPattern = render.publicationSlot?.pattern;
  if (slotPattern?.coverMode !== "auto" || !slotPattern.coverConfig) {
    return NextResponse.json({ error: "Cover semi-auto non configurée sur ce pattern" }, { status: 400 });
  }

  const coverConfigJson = slotPattern.coverConfig as { enabled?: boolean; coverPresetName?: string } | null;
  if (!coverConfigJson?.enabled) {
    return NextResponse.json({ error: "Cover semi-auto non activée sur ce pattern" }, { status: 400 });
  }

  const presetName = coverConfigJson.coverPresetName;
  if (!presetName) {
    return NextResponse.json(
      { error: "Cover config invalide : aucun preset sélectionné. Configurez un preset dans le template." },
      { status: 400 }
    );
  }

  const patternTemplateId = slotPattern.templateId ?? render.templateId;
  if (!patternTemplateId) {
    return NextResponse.json({ error: "Template introuvable pour ce pattern" }, { status: 400 });
  }

  const preset = await prisma.templateCoverPreset.findUnique({
    where: { templateId_name: { templateId: patternTemplateId, name: presetName } },
  });
  if (!preset) {
    return NextResponse.json(
      {
        error: `Cover config invalide : le preset "${presetName}" n'existe plus sur ce template. Reconfigurer le pattern.`,
      },
      { status: 400 }
    );
  }

  const config = preset.config as unknown as CoverAutoConfig;
  if (!config?.enabled) {
    return NextResponse.json({ error: "Le preset cover est désactivé" }, { status: 400 });
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
