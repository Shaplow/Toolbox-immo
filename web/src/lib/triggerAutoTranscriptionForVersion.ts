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
import { r2Configured, uploadToR2 } from "@/lib/r2";
import { slotEffectivePatternSelect, resolveSlotEffectivePattern } from "@/lib/services/slot/effectivePattern";
import { resolveCaptionsMode } from "@/lib/publications/captionsMode";

const RUNPOD_API_KEY     = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;
const USE_RUNPOD         = process.env.USE_RUNPOD !== "false";
const CAPTIONS_API_URL   = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";

type SkipReason =
  | "version_not_found"
  | "no_file_url"
  | "captions_and_description_disabled"
  | "r2_not_configured"
  | "runpod_not_configured"
  | "already_has_transcription"
  | "local_fetch_failed";

function logSkip(versionId: string, reason: SkipReason, extra?: Record<string, unknown>) {
  console.info(`[autoTranscriptionV] skip version=${versionId} reason=${reason}`, extra ?? {});
}

/**
 * Mode local (USE_RUNPOD=false) : fetch le fichier depuis fileUrl + POST direct
 * sur le render-engine local pour transcription synchrone. Évite RunPod/R2.
 * Persiste les segments en R2 si dispo, sinon dans `public/transcriptions/`.
 */
async function runLocalTranscription(
  publicationVersionId: string,
  version: {
    id: string;
    fileUrl: string;
    fileName: string;
    uploadedByUserId: string;
    slotId: string;
  },
  force: boolean,
): Promise<void> {
  // Cherche un job existant pour éviter les doublons.
  const existing = await prisma.transcriptionJob.findUnique({
    where: { publicationVersionId },
  });
  if (existing && existing.status !== "FAILED" && !force) {
    // Self-heal : un job créé avant le fix (branche RunPod sans slotId) est
    // orphelin du slot → invisible dans slot.transcriptionJobs → la page reste
    // bloquée sur "en cours". On repose le slotId pour le rendre visible.
    if (existing.slotId !== version.slotId) {
      await prisma.transcriptionJob.update({
        where: { id: existing.id },
        data: { slotId: version.slotId },
      });
    }
    logSkip(publicationVersionId, "already_has_transcription", {
      slotId: version.slotId,
      transcriptionJobId: existing.id,
      status: existing.status,
    });
    return;
  }

  const job =
    existing && (existing.status === "FAILED" || force)
      ? (await prisma.transcriptionJob.update({
          where: { id: existing.id },
          data: {
            status: "PROCESSING",
            errorMsg: null,
            outputJsonKey: null,
            segmentsJson: null,
            segmentCount: null,
            duration: null,
            staleSince: null,
            staleReason: null,
            inputFilename: version.fileName,
          },
          select: { id: true },
        }))
      : await prisma.transcriptionJob.create({
          data: {
            userId: version.uploadedByUserId,
            status: "PROCESSING",
            inputFilename: version.fileName,
            model: "turbo",
            language: "fr",
            enableDiarization: false,
            publicationVersionId: version.id,
            slotId: version.slotId,
          },
          select: { id: true },
        });

  try {
    // 1. Fetch le fichier depuis fileUrl (R2 public URL ou local Next.js).
    const videoRes = await fetch(version.fileUrl);
    if (!videoRes.ok) {
      throw new Error(`fetch fileUrl failed: ${videoRes.status} ${videoRes.statusText}`);
    }
    const videoBlob = await videoRes.blob();

    // 2. POST en form-data sur le render-engine local.
    const form = new FormData();
    form.append("audio", videoBlob, version.fileName);
    form.append("model_size", "large-v3-turbo");
    form.append("language", "fr");
    form.append("enable_diarization", "false");

    const apiRes = await fetch(`${CAPTIONS_API_URL}/api/transcribe`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30 * 60 * 1000), // 30min max
    });
    if (!apiRes.ok) {
      throw new Error(
        `render-engine /api/transcribe ${apiRes.status}: ${await apiRes.text()}`,
      );
    }
    const data = (await apiRes.json()) as {
      segments: Array<{ start: number; end: number; text: string; speaker?: string }>;
      segment_count: number;
      duration: number;
      language: string;
      has_diarization: boolean;
    };

    // 3. Persiste les segments. R2 si configuré, sinon en JSON inline dans le job.
    let outputJsonKey: string | null = null;
    if (r2Configured()) {
      const key = `transcription/${version.uploadedByUserId}/${Date.now()}/segments.json`;
      await uploadToR2(
        key,
        Buffer.from(JSON.stringify(data.segments, null, 2), "utf-8"),
        "application/json",
      );
      outputJsonKey = key;
    }

    await prisma.transcriptionJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        outputJsonKey,
        // Si pas de R2, stocke les segments directement en DB pour ne pas perdre
        // le résultat (lu par /api/transcription/[id]/download fallback).
        segmentsJson: outputJsonKey ? null : JSON.stringify(data.segments),
        segmentCount: data.segment_count,
        duration: data.duration,
        hasDiarization: data.has_diarization,
      },
    });

    // 4. Promote comme transcription active du slot.
    await prisma.publicationSlot.update({
      where: { id: version.slotId },
      data: { activeTranscriptionJobId: job.id },
    });

    console.info(
      `[autoTranscriptionV] LOCAL job=${job.id} COMPLETED version=${version.id} slot=${version.slotId} segments=${data.segment_count}`,
    );
  } catch (err) {
    await prisma.transcriptionJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMsg: String(err) },
    });
    console.error(
      `[autoTranscriptionV] LOCAL transcription failed version=${publicationVersionId}: ${String(err)}`,
    );
  }
}

export async function triggerAutoTranscriptionForVersion(
  publicationVersionId: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  // force = re-transcrire même si un job COMPLETED/stale existe (déblocage
  // manuel : segments illisibles/périmés). Reset le job existant + resubmit.
  const force = opts.force === true;
  // ── Mode local (USE_RUNPOD=false) : pipeline synchrone via render-engine
  // local sur CAPTIONS_API_URL. Pas besoin de RunPod ni R2 — le SRT est
  // stocké inline dans TranscriptionJob.segmentsJson si R2 indispo.
  if (!USE_RUNPOD) {
    const version = await prisma.publicationVersion.findUnique({
      where: { id: publicationVersionId },
      select: {
        id: true,
        slotId: true,
        fileUrl: true,
        fileName: true,
        uploadedByUserId: true,
        slot: {
          select: {
            needsCaptionsOverride: true,
            needsCaptionsModeOverride: true,
            needsDescriptionOverride: true,
            ...slotEffectivePatternSelect,
          },
        },
      },
    });
    if (!version) {
      logSkip(publicationVersionId, "version_not_found");
      return;
    }
    if (!version.fileUrl) {
      logSkip(publicationVersionId, "no_file_url", { slotId: version.slotId });
      return;
    }
    // Même garde que le pipeline RunPod : on ne lance que si quelqu'un consomme.
    const eff = resolveSlotEffectivePattern(version.slot);
    // Mode-aware : la transcription est consommée dès que les captions sont
    // "auto" OU "manual" (le mode manuel réutilise le même flux d'édition +
    // burn-in, seedé par la transcription). resolveCaptionsMode gère les
    // overrides slot + fallback booléen legacy.
    const effectiveNeedsCaptions =
      resolveCaptionsMode({
        slot: {
          needsCaptionsModeOverride: version.slot.needsCaptionsModeOverride,
          needsCaptionsOverride: version.slot.needsCaptionsOverride,
        },
        pattern: eff,
      }) !== "none";
    const effectiveNeedsDescription =
      version.slot.needsDescriptionOverride ?? eff?.needsDescription ?? "none";
    if (!effectiveNeedsCaptions && effectiveNeedsDescription !== "autoGenerate") {
      logSkip(publicationVersionId, "captions_and_description_disabled", {
        slotId: version.slotId,
        effectiveNeedsCaptions,
        effectiveNeedsDescription,
      });
      return;
    }
    await runLocalTranscription(publicationVersionId, {
      id: version.id,
      fileUrl: version.fileUrl,
      fileName: version.fileName,
      uploadedByUserId: version.uploadedByUserId,
      slotId: version.slotId,
    }, force);
    return;
  }

  // ── Mode RunPod (par défaut en prod) ────────────────────────────────────
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
          needsCaptionsModeOverride: true,
          needsDescriptionOverride: true,
          ...slotEffectivePatternSelect,
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
  const eff = resolveSlotEffectivePattern(version.slot);
  // Mode-aware : la transcription est consommée dès que les captions sont
  // "auto" OU "manual" (le mode manuel réutilise le même flux d'édition +
  // burn-in, seedé par la transcription). resolveCaptionsMode gère les
  // overrides slot + fallback booléen legacy.
  const effectiveNeedsCaptions =
    resolveCaptionsMode({
      slot: {
        needsCaptionsModeOverride: version.slot.needsCaptionsModeOverride,
        needsCaptionsOverride: version.slot.needsCaptionsOverride,
      },
      pattern: eff,
    }) !== "none";
  const effectiveNeedsDescription =
    version.slot.needsDescriptionOverride ?? eff?.needsDescription ?? "none";
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
  if (existing && existing.status !== "FAILED" && !force) {
    // Self-heal : un job créé avant le fix (branche RunPod sans slotId) est
    // orphelin du slot → invisible dans slot.transcriptionJobs → la page reste
    // bloquée sur "en cours". On repose le slotId pour le rendre visible.
    if (existing.slotId !== version.slotId) {
      await prisma.transcriptionJob.update({
        where: { id: existing.id },
        data: { slotId: version.slotId },
      });
    }
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
  if (existing && (existing.status === "FAILED" || force)) {
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
        slotId: version.slotId,
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
          // Sans slotId, le job est orphelin du slot → invisible dans
          // slot.transcriptionJobs → resolveActiveTranscription renvoie null →
          // la page generate boucle sur "en cours". Aligné sur la branche locale.
          slotId: version.slotId,
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
