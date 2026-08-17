import { NextRequest, NextResponse } from "next/server";
import { deleteCoverCandidateAssets, queueCoverFramePackPreparation, toCoverSourceVideoUrl } from "@/lib/coverAuto";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api/requireAuth";
import { slotEffectivePatternSelect, resolveSlotEffectivePattern } from "@/lib/services/slot/effectivePattern";
import type { CoverAutoConfig } from "@/types/template";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;
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
          ...slotEffectivePatternSelect,
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

  // Résolution alignée sur triggerAutoCoverPackForRender (coverAuto.ts) :
  // coverConfig null/incomplet n'est PAS bloquant → on retombe sur le preset par
  // défaut du template. Configurer la cover sur la template suffit (le coverConfig
  // de la recette ne sert qu'à choisir un preset spécifique).
  const effPattern = render.publicationSlot ? resolveSlotEffectivePattern(render.publicationSlot) : null;
  if (effPattern?.coverMode !== "autoPack") {
    return NextResponse.json(
      { error: "Le mode cover de cette recette n'est pas « Pack auto »." },
      { status: 400 }
    );
  }

  const coverConfigJson = (effPattern.coverConfig ?? {}) as {
    enabled?: boolean;
    coverPresetId?: string;
    coverPresetName?: string;
  };
  if (coverConfigJson.enabled === false) {
    return NextResponse.json({ error: "Cover auto désactivée sur cette recette." }, { status: 400 });
  }

  const patternTemplateId = effPattern.templateId ?? render.templateId;
  if (!patternTemplateId) {
    return NextResponse.json({ error: "Template introuvable pour cette recette" }, { status: 400 });
  }

  // preset : id → nom → défaut du template (sortOrder min).
  let preset = coverConfigJson.coverPresetId
    ? await prisma.templateCoverPreset.findUnique({ where: { id: coverConfigJson.coverPresetId } })
    : null;
  if (!preset && coverConfigJson.coverPresetName) {
    preset = await prisma.templateCoverPreset.findUnique({
      where: { templateId_name: { templateId: patternTemplateId, name: coverConfigJson.coverPresetName } },
    });
  }
  if (!preset) {
    preset = await prisma.templateCoverPreset.findFirst({
      where: { templateId: patternTemplateId },
      orderBy: { sortOrder: "asc" },
    });
  }
  if (!preset) {
    return NextResponse.json(
      { error: "Aucun preset cover sur le template — configure-le dans le builder (onglet « Cover auto »)." },
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
