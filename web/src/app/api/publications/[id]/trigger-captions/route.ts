/**
 * POST /api/publications/[id]/trigger-captions
 *
 * Lance manuellement la génération de captions pour un slot one-off
 * (pas de render auto, donc pas de triggerAutoTranscriptionForRender qui se déclenche).
 *
 * Fix bug audit 2026-05-30 (C5) : auparavant cet endpoint créait juste un
 * CaptionJob marker en QUEUED sans soumettre à RunPod → job bloqué indéfini.
 * Désormais on chaîne le vrai pipeline auto :
 *  - Si la PublicationVersion a déjà une transcription COMPLETED →
 *    on appelle directement triggerAutoCaptionForTranscription (skip transcription).
 *  - Sinon → on appelle triggerAutoTranscriptionForVersion (qui chaînera vers
 *    captions via le webhook RunPod transcription COMPLETED → triggerAutoCaption).
 *
 * ADMIN uniquement. Idempotent : skip si un CaptionJob QUEUED/PROCESSING
 * existe déjà pour ce slot.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { resolveSlotConfig } from "@/lib/services/slot/config";
import { triggerAutoTranscriptionForVersion } from "@/lib/triggerAutoTranscriptionForVersion";
import { triggerAutoCaptionForTranscription } from "@/lib/triggerAutoCaptionFromTranscription";

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
        select: {
          id: true,
          fileUrl: true,
          r2Key: true,
          // Pour décider si on chaîne sur la transcription existante ou si
          // on en lance une nouvelle (cf. fix C5).
          transcriptionJob: { select: { id: true, status: true } },
        },
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

  // Idempotence : skip si un job actif (et non stale) existe déjà pour ce slot.
  // staleSince:null est crucial — après un promote, les anciens jobs QUEUED
  // sont stale-marqués mais leur status reste QUEUED. Sans ce filtre, le retry
  // post-promote était bloqué par le vieux job stale.
  const existingActive = await prisma.captionJob.findFirst({
    where: {
      slotId,
      status: { in: ["QUEUED", "PROCESSING"] },
      staleSince: null,
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

  // Fix C5 : on chaîne le vrai pipeline auto au lieu de créer un job orphelin.
  const transcription = slot.currentVersion.transcriptionJob;
  const versionId = slot.currentVersion.id;

  if (transcription && transcription.status === "COMPLETED") {
    // Cas 1 : la version a déjà une transcription COMPLETED → on skip la
    // transcription et on déclenche directement le caption (correction + RunPod).
    void triggerAutoCaptionForTranscription(transcription.id).catch((err) => {
      console.error(`[trigger-captions] triggerAutoCaptionForTranscription échoué pour slot=${slotId}:`, err);
    });
    return NextResponse.json({
      ok: true,
      kind: "caption_from_existing_transcription",
      transcriptionJobId: transcription.id,
      presetName: preset.name,
      message: "Pipeline captions lancé (transcription existante réutilisée).",
    });
  }

  // Cas 2 : pas de transcription COMPLETED → on lance la transcription pour
  // cette PublicationVersion. Le webhook RunPod COMPLETED chaînera ensuite
  // automatiquement vers triggerAutoCaptionForTranscription.
  void triggerAutoTranscriptionForVersion(versionId).catch((err) => {
    console.error(`[trigger-captions] triggerAutoTranscriptionForVersion échoué pour slot=${slotId}:`, err);
  });

  return NextResponse.json({
    ok: true,
    kind: "transcription_then_caption",
    versionId,
    presetName: preset.name,
    message:
      "Pipeline lancé : transcription RunPod en cours, captions seront générées automatiquement à sa complétion.",
  });
}
