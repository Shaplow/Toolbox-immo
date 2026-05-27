/**
 * POST /api/publications/[id]/trigger-cover
 *
 * Lance manuellement la génération du CoverFramePack pour un slot qui n'a
 * pas de Render automatique (cas slot one-off : manual_rushes ou external_upload).
 * La cover est extraite de la PublicationVersion courante (vidéo uploadée).
 *
 * ADMIN uniquement. Idempotent : skip si un pack existe déjà pour cette version.
 *
 * Flux :
 *   1. Charge slot + currentVersion + pattern + overrides
 *   2. Résout la config cover via resolveSlotConfig
 *   3. Si coverMode != "auto" → 400
 *   4. Charge le preset par ID (override slot prioritaire sur pattern.coverConfig)
 *   5. Crée CoverFramePack { publicationVersionId, renderId=null, sourceVideoUrl=version.fileUrl }
 *   6. Lance prepareCoverFramePack (extraction frames async)
 *   7. Log activity COVER_QUEUED
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { resolveSlotConfig } from "@/lib/publications/clientValidation";
import { logActivity } from "@/lib/publications/activity";
import { queueCoverFramePackPreparation } from "@/lib/coverAuto";

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
        select: { id: true, fileUrl: true, r2Key: true, fileName: true },
      },
      // Pour resolveSlotConfig
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
          coverConfig: true,
          captionPresetId: true,
          descriptionPromptId: true,
          templateId: true,
        },
      },
    },
  });

  if (!slot) {
    return NextResponse.json({ error: "Slot introuvable" }, { status: 404 });
  }
  if (!slot.currentVersion || !slot.currentVersion.fileUrl) {
    return NextResponse.json(
      { error: "Aucune version courante uploadée — uploadez d'abord la vidéo" },
      { status: 400 },
    );
  }

  // coverConfig.coverPresetId (Phase 3) — extrait pour le résolveur
  const patternCoverPresetId =
    slot.pattern?.coverConfig &&
    typeof slot.pattern.coverConfig === "object" &&
    "coverPresetId" in (slot.pattern.coverConfig as Record<string, unknown>)
      ? ((slot.pattern.coverConfig as { coverPresetId?: string }).coverPresetId ?? null)
      : null;

  const resolved = resolveSlotConfig(
    slot,
    slot.pattern
      ? {
          ...slot.pattern,
          coverMode: slot.pattern.coverMode,
          coverPresetId: patternCoverPresetId,
        }
      : null,
  );

  if (resolved.coverMode !== "auto") {
    return NextResponse.json(
      { error: `Cover mode est "${resolved.coverMode}" — auto requis pour ce trigger` },
      { status: 400 },
    );
  }
  if (!resolved.coverPresetId) {
    return NextResponse.json(
      { error: "Aucun preset cover défini (override slot ou pattern)" },
      { status: 400 },
    );
  }

  const preset = await prisma.templateCoverPreset.findUnique({
    where: { id: resolved.coverPresetId },
    select: { id: true, name: true, config: true, templateId: true },
  });
  if (!preset) {
    return NextResponse.json(
      { error: `Preset cover introuvable (id="${resolved.coverPresetId}")` },
      { status: 400 },
    );
  }

  // Idempotence : skip si un pack existe déjà pour cette version
  const existing = await prisma.coverFramePack.findUnique({
    where: { publicationVersionId: slot.currentVersionId! },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { ok: true, packId: existing.id, message: "Pack déjà existant pour cette version" },
      { status: 200 },
    );
  }

  const config = preset.config as Record<string, unknown>;
  const frameCount =
    typeof config.frameCount === "number"
      ? Math.min(72, Math.max(6, Math.round(config.frameCount)))
      : 36;

  const actorId = userContext.actualUser.id;

  const pack = await prisma.coverFramePack.create({
    data: {
      userId: actorId,
      renderId: null,
      publicationVersionId: slot.currentVersionId!,
      templateId: preset.templateId,
      status: "QUEUED",
      sourceVideoUrl: slot.currentVersion.fileUrl,
      frameCount,
      config: JSON.stringify(config),
      overlayGroupIds: JSON.stringify(
        Array.isArray((config as { overlayGroupIds?: unknown[] }).overlayGroupIds)
          ? (config as { overlayGroupIds: unknown[] }).overlayGroupIds
          : [],
      ),
    },
    select: { id: true },
  });

  await logActivity(prisma, {
    slotId,
    actorId,
    type: "COVER_QUEUED",
    payload: {
      coverFramePackId: pack.id,
      presetId: preset.id,
      presetName: preset.name,
      frameCount,
      trigger: "MANUAL_FROM_VERSION",
      publicationVersionId: slot.currentVersionId,
    },
  });

  queueCoverFramePackPreparation(pack.id);

  return NextResponse.json({ ok: true, packId: pack.id, presetName: preset.name });
}
