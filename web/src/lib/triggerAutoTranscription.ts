/**
 * triggerAutoTranscription.ts
 *
 * Déclenche automatiquement un TranscriptionJob après la fin d'un render
 * si le template a captionAutoConfig.enabled = true.
 *
 * Appelé depuis le webhook RunPod renders après DONE.
 * Non bloquant : les erreurs sont loguées mais ne propagent pas.
 */

import { prisma } from "@/lib/prisma";
import { getR2PublicUrl, r2Configured } from "@/lib/r2";
import { submitRunpodJob, runpodConfigured } from "@/lib/runpod";
import { getRunpodWebhookUrl } from "@/lib/webhooks/runpod";
import type { TemplateJSON } from "@/types/template";

const RUNPOD_API_KEY     = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;

export async function triggerAutoTranscriptionForRender(
  renderId: string,
  templateId: string | null | undefined,
  renderOutputKey: string,
  userId: string,
): Promise<void> {
  if (!templateId) return;
  if (!r2Configured()) {
    console.info(`[autoTranscription] R2 non configuré — skip pour render=${renderId}`);
    return;
  }
  if (!runpodConfigured() || !RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
    console.info(`[autoTranscription] RunPod non configuré — skip pour render=${renderId}`);
    return;
  }

  // Vérifier que le template a captionAutoConfig.enabled
  let captionAutoConfig: TemplateJSON["captionAutoConfig"] | undefined;
  try {
    const template = await prisma.template.findUnique({ where: { id: templateId } });
    if (!template) return;
    const json = JSON.parse(template.jsonData) as TemplateJSON;
    captionAutoConfig = json.captionAutoConfig;
  } catch (err) {
    console.error(`[autoTranscription] Lecture template=${templateId} échouée : ${String(err)}`);
    return;
  }

  if (!captionAutoConfig?.enabled) return;

  // Idempotence : la contrainte unique sur renderId (schema Prisma) + le
  // try/catch P2002 ci-dessous suffisent pour bloquer les doublons quand
  // deux webhooks arrivent simultanément. Pas besoin d'un findUnique
  // préalable (qui créait une fenêtre TOCTOU sans valeur ajoutée).

  const jobTimestamp = Date.now();
  const outputJsonKey = `transcription/${userId}/${jobTimestamp}/segments.json`;

  const audioUrl   = getR2PublicUrl(renderOutputKey);
  const webhookUrl = getRunpodWebhookUrl("/api/webhooks/runpod/transcription");

  let job: { id: string };
  try {
    job = await prisma.transcriptionJob.create({
      data: {
        userId,
        status: "QUEUED",
        inputKey: renderOutputKey,
        inputFilename: `render-${renderId}.mp4`,
        model: "turbo",
        language: "fr",
        enableDiarization: false,
        outputJsonKey,
        renderId,
      },
    });
  } catch (err) {
    // P2002 = contrainte unique violée (webhook rejoué en simultané) — non bloquant
    console.warn(`[autoTranscription] Création job ignorée pour render=${renderId} : ${String(err)}`);
    return;
  }

  const payload = {
    input: {
      job_type: "transcribe",
      audio_url: audioUrl,
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

    // Un seul update : PROCESSING + runpodJobId atomiquement
    await prisma.transcriptionJob.update({
      where: { id: job.id },
      data: { status: "PROCESSING", runpodJobId: data.id },
    });

    console.info(
      `[autoTranscription] Job ${job.id} soumis (RunPod: ${data.id}) pour render=${renderId}`,
    );
  } catch (err) {
    await prisma.transcriptionJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMsg: String(err) },
    });
    console.error(
      `[autoTranscription] Échec soumission RunPod pour render=${renderId} : ${String(err)}`,
    );
    // Non bloquant — le render lui-même est DONE
  }
}
