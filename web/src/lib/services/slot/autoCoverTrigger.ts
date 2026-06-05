/**
 * autoCoverTrigger.ts
 *
 * Logique partagée pour déclencher la génération auto de la cover sur la
 * PublicationVersion courante d'un slot. Appelée :
 *  - depuis POST /api/publications/[id]/trigger-cover  (action ADMIN manuelle)
 *  - depuis POST /api/publications/[id]/versions/[v]/promote  (auto post-promote)
 *
 * Retourne un statut explicite (jamais throw) pour pouvoir l'utiliser en
 * fire-and-forget dans le flow promote sans casser le PATCH si la cover ne
 * peut pas être déclenchée (preset manquant, version absente, etc.).
 */

import { prisma as defaultPrisma } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import { resolveSlotConfig } from "@/lib/services/slot/config";
import { logActivity } from "@/lib/services/slot/activity";
import { queueCoverFramePackPreparation } from "@/lib/coverAuto";
import { getCoverPresetIdFromConfig } from "@/lib/publications/coverMode";

export type AutoCoverResult =
  | { status: "queued"; packId: string; presetName: string }
  | { status: "idempotent"; packId: string; reason: "pack_exists" }
  | { status: "skipped"; reason: string }
  | { status: "error"; reason: string };

interface AutoCoverInput {
  slotId: string;
  actorId: string;
  /** "MANUAL_FROM_VERSION" (ADMIN button) | "AUTO_POST_PROMOTE" (auto post-promote) */
  trigger: "MANUAL_FROM_VERSION" | "AUTO_POST_PROMOTE";
}

/**
 * Tente de déclencher la génération auto de la cover pour le slot.
 * Idempotent : pas d'erreur si un pack existe déjà.
 */
export async function tryAutoTriggerCover(
  { slotId, actorId, trigger }: AutoCoverInput,
  prisma: PrismaClient = defaultPrisma,
): Promise<AutoCoverResult> {
  try {
    const slot = await prisma.publicationSlot.findUnique({
      where: { id: slotId },
      select: {
        id: true,
        currentVersionId: true,
        currentVersion: {
          select: { id: true, fileUrl: true, r2Key: true, fileName: true },
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
            coverConfig: true,
            captionPresetId: true,
            descriptionPromptId: true,
            templateId: true,
          },
        },
      },
    });

    if (!slot) return { status: "error", reason: "slot_not_found" };
    if (!slot.currentVersion?.fileUrl) return { status: "skipped", reason: "no_current_version" };

    // coverConfig.coverPresetId (Phase 3) — extrait pour le résolveur
    const patternCoverPresetId = getCoverPresetIdFromConfig(slot.pattern?.coverConfig);

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

    if (resolved.coverMode !== "autoPack") {
      return { status: "skipped", reason: `cover_mode_${resolved.coverMode}` };
    }
    if (!resolved.coverPresetId) {
      return { status: "skipped", reason: "no_cover_preset" };
    }

    const preset = await prisma.templateCoverPreset.findUnique({
      where: { id: resolved.coverPresetId },
      select: { id: true, name: true, config: true, templateId: true },
    });
    if (!preset) return { status: "skipped", reason: "preset_not_found" };

    // V7.6 — Garde unifiée slot-level (Pattern C audit V6). Avant : on
    // vérifiait juste `publicationVersionId`, mais un pack pouvait être
    // créé en parallèle via `renderId` (coverAuto.ts). 2 packs non-stale
    // pour le même slot — divergence. Désormais : findFirst sur les 2 FK
    // + filtre non-stale.
    const existing = await prisma.coverFramePack.findFirst({
      where: {
        OR: [
          { publicationVersionId: slot.currentVersionId! },
          { render: { publicationSlotId: slotId } },
        ],
        staleSince: null,
      },
      select: { id: true },
    });
    if (existing) {
      return { status: "idempotent", packId: existing.id, reason: "pack_exists" };
    }

    const config = preset.config as Record<string, unknown>;
    const frameCount =
      typeof config.frameCount === "number"
        ? Math.min(72, Math.max(6, Math.round(config.frameCount)))
        : 36;

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
        trigger,
        publicationVersionId: slot.currentVersionId,
      },
    });

    queueCoverFramePackPreparation(pack.id);

    return { status: "queued", packId: pack.id, presetName: preset.name };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[tryAutoTriggerCover] slot=${slotId} trigger=${trigger} error:`, err);
    return { status: "error", reason: message };
  }
}
