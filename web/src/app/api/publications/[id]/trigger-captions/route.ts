/**
 * POST /api/publications/[id]/trigger-captions
 *
 * Lance manuellement la génération de captions pour un slot one-off
 * (pas de render auto, donc pas de triggerAutoTranscriptionForRender qui se déclenche).
 * Crée un CaptionJob marker (status QUEUED) avec inputUrl pointant sur la
 * PublicationVersion courante + presetId résolu via override slot ou pattern.
 *
 * NOTE : ce endpoint crée le job mais ne lance PAS le pipeline RunPod aval
 * (transcription → caption burn). C'est un marker pour signaler l'intention
 * et permettre à l'admin de suivre l'état dans la fiche. Le câblage complet
 * du pipeline (transcription auto sur version uploadée + lancement caption
 * burn) est une itération à venir.
 *
 * ADMIN uniquement. Idempotent : skip si un CaptionJob QUEUED/PROCESSING
 * existe déjà pour ce slot.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { resolveSlotConfig } from "@/lib/publications/clientValidation";
import { logActivity } from "@/lib/publications/activity";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteContext) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: slotId } = await params;
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      currentVersionId: true,
      currentVersion: {
        select: { id: true, fileUrl: true, r2Key: true },
      },
      needsClientValidationOverride: true,
      allowsClientRevisionOverride: true,
      needsCaptionsOverride: true,
      needsDescriptionOverride: true,
      needsRushesOverride: true,
      needsBriefOverride: true,
      coverModeOverride: true,
      coverPresetIdOverride: true,
      captionPresetIdOverride: true,
      descriptionPromptIdOverride: true,
      pattern: {
        select: {
          needsClientValidation: true,
          allowsClientRevision: true,
          needsCaptions: true,
          needsDescription: true,
          needsRushes: true,
          needsBrief: true,
          coverMode: true,
          captionPresetId: true,
          descriptionPromptId: true,
        },
      },
    },
  });

  if (!slot) {
    return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  }
  if (!slot.currentVersion?.fileUrl) {
    return NextResponse.json(
      { error: "Aucune version courante uploadée — uploadez d'abord la vidéo" },
      { status: 400 },
    );
  }

  const resolved = resolveSlotConfig(slot, slot.pattern ?? null);

  if (!resolved.needsCaptions) {
    return NextResponse.json(
      { error: "Captions désactivées pour ce slot (override ou pattern)" },
      { status: 400 },
    );
  }
  if (!resolved.captionPresetId) {
    return NextResponse.json(
      { error: "Aucun preset captions défini (override slot ou pattern)" },
      { status: 400 },
    );
  }

  const preset = await prisma.captionPreset.findUnique({
    where: { id: resolved.captionPresetId },
    select: { id: true, name: true, config: true },
  });
  if (!preset) {
    return NextResponse.json(
      { error: `Preset captions introuvable (id="${resolved.captionPresetId}")` },
      { status: 400 },
    );
  }

  // Idempotence : skip si un job actif existe déjà pour ce slot
  const existingActive = await prisma.captionJob.findFirst({
    where: {
      slotId,
      status: { in: ["QUEUED", "PROCESSING"] },
    },
    select: { id: true },
  });
  if (existingActive) {
    return NextResponse.json(
      {
        ok: true,
        captionJobId: existingActive.id,
        message: "Un job captions actif existe déjà pour ce slot",
      },
      { status: 200 },
    );
  }

  const actorId = userContext.actualUser.id;

  const job = await prisma.captionJob.create({
    data: {
      userId: actorId,
      slotId,
      status: "QUEUED",
      inputUrl: slot.currentVersion.fileUrl,
      inputKey: slot.currentVersion.r2Key,
      presetId: preset.id,
      config: typeof preset.config === "string" ? preset.config : JSON.stringify(preset.config),
    },
    select: { id: true },
  });

  await logActivity(prisma, {
    slotId,
    actorId,
    type: "CAPTIONS_COMPLETED",
    payload: {
      captionJobId: job.id,
      presetId: preset.id,
      presetName: preset.name,
      trigger: "MANUAL_FROM_VERSION",
      note: "Job créé en QUEUED — le pipeline RunPod aval n'est pas encore branché pour les slots one-off (itération à venir).",
    },
  });

  return NextResponse.json({
    ok: true,
    captionJobId: job.id,
    presetName: preset.name,
    note: "Job créé. Si le pipeline RunPod n'avance pas automatiquement, utiliser /tools/captions pour finaliser.",
  });
}
