/**
 * triggerAutoTranscriptionForVersion.ts
 *
 * Phase 2.4 — Déclenche automatiquement un TranscriptionJob après promote
 * d'une PublicationVersion (équivalent de triggerAutoTranscriptionForRender
 * pour les patterns manual_rushes / external_upload où il n'y a pas de
 * Render auto).
 *
 * Pré-conditions :
 *  - La version doit avoir fileUrl public (R2 ou fallback local)
 *  - Le pattern du slot doit avoir needsCaptions=true OU needsDescription
 *    !== "none" (sinon transcription inutile, rien ne la consomme)
 *  - R2 + RunPod configurés
 *  - Pas de TranscriptionJob déjà rattaché à cette version
 *
 * Non bloquant : toutes les erreurs sont catch + log.
 *
 * Appelé depuis :
 *  - /api/publications/[id]/upload-complete (auto-promote, needsAdminValidation=false)
 *  - /api/publications/[id]/versions/[v]/promote (manual promote)
 */

import { prisma } from "@/lib/prisma";
import { runpodConfigured, submitRunpodJob } from "@/lib/runpod";
import { getRunpodWebhookUrl } from "@/lib/webhooks/runpod";
import { r2Configured } from "@/lib/r2";

const RUNPOD_API_KEY     = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;

type SkipReason =
  | "version_not_found"
  | "no_file_url"
  | "captions_and_description_disabled"
  | "r2_not_configured"
  | "runpod_not_configured"
  | "already_has_transcription";

function logSkip(versionId: string, reason: SkipReason, extra?: Record<string, unknown>) {
  console.info(`[autoTranscriptionV] skip version=${versionId} reason=${reason}`, extra ?? {});
}

export async function triggerAutoTranscriptionForVersion(
  publicationVersionId: string,
): Promise<void> {
  if (!r2Configured()) {
    logSkip(publicationVersionId, "r2_not_configured");
    return;
  }
  if (!runpodConfigured() || !RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
    logSkip(publicationVersionId, "runpod_not_configured");
    return;
  }

  const version = await prisma.publicationVersion.findUnique({
    where: { id: publicationVersionId },
    select: {
      id: true,
      slotId: true,
      fileUrl: true,
      r2Key: true,
      fileName: true,
      uploadedByUserId: true,
      slot: {
        select: {
          needsCaptionsOverride: true,
          needsDescriptionOverride: true,
          pattern: {
            select: { needsCaptions: true, needsDescription: true },
          },
        },
      },
    },
  });

  if (!version) {
    logSkip(publicationVersionId, "version_not_found");
    return;
  }
  if (!version.fileUrl || !version.r2Key) {
    logSkip(publicationVersionId, "no_file_url", { slotId: version.slotId });
    return;
  }

  // On déclenche la transcription uniquement si quelque chose la consommera :
  // soit captions (sous-titres vidéo), soit description (légende IG auto).
  const effectiveNeedsCaptions =
    version.slot.needsCaptionsOverride ?? version.slot.pattern?.needsCaptions ?? false;
  const effectiveNeedsDescription =
    version.slot.needsDescriptionOverride ?? version.slot.pattern?.needsDescription ?? "none";
  if (!effectiveNeedsCaptions && effectiveNeedsDescription !== "autoGenerate") {
    logSkip(publicationVersionId, "captions_and_description_disabled", {
      slotId: version.slotId,
      effectiveNeedsCaptions,
      effectiveNeedsDescription,
    });
    return;
  }

  // Idempotence : déjà une transcription liée à cette version.
  // V6.3.2 — distinguer COMPLETED (skip légitime) de FAILED (retry).
  // Avant : skip inconditionnel → chain morte si la première transcription
  // avait échoué, l'admin devait passer par /transcriptions manuel.
  // Désormais : si FAILED, on reset le job existant pour re-tenter
  // (pattern aligné sur triggerAutoTranscriptionForRender — commit bdf750a).
  const existing = await prisma.transcriptionJob.findUnique({
    where: { publicationVersionId },
  });
  if (existing && existing.status !== "FAILED") {
    logSkip(publicationVersionId, "already_has_transcription", {
      slotId: version.slotId,
      transcriptionJobId: existing.id,
      status: existing.status,
    });
    return;
  }
  const jobTimestamp = Date.now();
  const outputJsonKey = `transcription/${version.uploadedByUserId}/${jobTimestamp}/segments.json`;
  const webhookUrl = getRunpodWebhookUrl("/api/webhooks/runpod/transcription");

  // V6.3.2 — Si existing FAILED, reset + réutiliser l'ID (préserve FK aval
  // DescriptionJob.transcriptionId). Sinon create un nouveau job.
  let job: { id: string };
  if (existing && existing.status === "FAILED") {
    await prisma.transcriptionJob.update({
      where: { id: existing.id },
      data: {
        status: "QUEUED",
        errorMsg: null,
        runpodJobId: null,
        outputJsonKey,
        segmentsJson: null,
        segmentCount: null,
        duration: null,
        staleSince: null,
        staleReason: null,
        inputKey: version.r2Key,
        inputFilename: version.fileName,
      },
    });
    job = { id: existing.id };
    console.info(
      `[autoTranscriptionV] reset FAILED job=${existing.id} pour retry (version=${publicationVersionId})`,
    );
  } else {
    try {
      job = await prisma.transcriptionJob.create({
        data: {
          userId: version.uploadedByUserId,
          status: "QUEUED",
          inputKey: version.r2Key,
          inputFilename: version.fileName,
          model: "turbo",
          language: "fr",
          enableDiarization: false,
          outputJsonKey,
          publicationVersionId: version.id,
        },
      });
    } catch (err) {
      console.warn(
        `[autoTranscriptionV] Création job ignorée pour version=${publicationVersionId} : ${String(err)}`,
      );
      return;
    }
  }

  const payload = {
    input: {
      job_type: "transcribe",
      audio_url: version.fileUrl,
      output_key: outputJsonKey,
      job_id: job.id,
      model_size: "large-v3-turbo",
      language: "fr",
      enable_diarization: false,
      hf_token: null,
    },
    ...(webhookUrl ? { webhook: webhookUrl } : {}),
  };

  try {
    const data = await submitRunpodJob<{ id: string }>(
      RUNPOD_ENDPOINT_ID,
      RUNPOD_API_KEY,
      payload,
    );
    await prisma.transcriptionJob.update({
      where: { id: job.id },
      data: { status: "PROCESSING", runpodJobId: data.id },
    });
    console.info(
      `[autoTranscriptionV] Job ${job.id} soumis (RunPod: ${data.id}) pour version=${publicationVersionId} slot=${version.slotId}`,
    );
  } catch (err) {
    await prisma.transcriptionJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMsg: String(err) },
    });
    console.error(
      `[autoTranscriptionV] Échec soumission RunPod pour version=${publicationVersionId} : ${String(err)}`,
    );
  }
}
