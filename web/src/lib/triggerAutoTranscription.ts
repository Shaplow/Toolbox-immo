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

  // Fix 2026-05-30 : la transcription doit aussi tourner si le slot lié au
  // render attend une description IA (qui consomme la transcription comme
  // input), même si captions désactivées sur le template. Avant ce fix,
  // pattern.needsCaptions=false + needsDescription=autoGenerate → pas de
  // transcription → description bloquée éternellement après validation client.
  let needsDescriptionAuto = false;
  try {
    const render = await prisma.render.findUnique({
      where: { id: renderId },
      select: {
        publicationSlot: {
          select: {
            needsDescriptionOverride: true,
            pattern: { select: { needsDescription: true } },
          },
        },
      },
    });
    const effectiveNeedsDescription =
      render?.publicationSlot?.needsDescriptionOverride ??
      render?.publicationSlot?.pattern?.needsDescription ??
      "none";
    needsDescriptionAuto = effectiveNeedsDescription === "autoGenerate";
  } catch (err) {
    console.warn(`[autoTranscription] Lecture slot pattern échouée pour render=${renderId} : ${String(err)}`);
  }

  if (!captionAutoConfig?.enabled && !needsDescriptionAuto) return;

  // Fix 2026-05-30 : avant le create, on regarde s'il existe déjà une
  // transcription pour ce render (contrainte unique sur renderId). Cas :
  //  - COMPLETED → no-op (la chaîne aval doit se déclencher depuis le
  //    webhook précédent ou être réveillée par un autre trigger).
  //  - QUEUED/PROCESSING → no-op (un appel concurrent est déjà en route).
  //  - FAILED → on RESET le job en QUEUED + clear errorMsg, puis on
  //    resubmit RunPod en gardant son ID. Sans ce reset, l'ancien check
  //    "P2002 silencieux" empêchait toute relance et la chaîne restait
  //    cassée sans message d'erreur.
  const existing = await prisma.transcriptionJob.findUnique({
    where: { renderId },
    select: { id: true, status: true, outputJsonKey: true },
  });

  const jobTimestamp = Date.now();
  const audioUrl   = getR2PublicUrl(renderOutputKey);
  const webhookUrl = getRunpodWebhookUrl("/api/webhooks/runpod/transcription");

  let job: { id: string };
  let outputJsonKey: string;

  if (existing) {
    if (existing.status === "COMPLETED" || existing.status === "QUEUED" || existing.status === "PROCESSING") {
      console.info(`[autoTranscription] Job déjà ${existing.status} pour render=${renderId} (id=${existing.id}) — skip`);
      return;
    }
    // FAILED → reset
    outputJsonKey = existing.outputJsonKey ?? `transcription/${userId}/${jobTimestamp}/segments.json`;
    try {
      job = await prisma.transcriptionJob.update({
        where: { id: existing.id },
        data: {
          status: "QUEUED",
          errorMsg: null,
          inputKey: renderOutputKey,
          inputFilename: `render-${renderId}.mp4`,
          outputJsonKey,
          runpodJobId: null,
        },
        select: { id: true },
      });
      console.info(`[autoTranscription] Job FAILED ${existing.id} reset → QUEUED pour render=${renderId}`);
    } catch (err) {
      console.error(`[autoTranscription] Reset FAILED job ${existing.id} échoué : ${String(err)}`);
      return;
    }
  } else {
    outputJsonKey = `transcription/${userId}/${jobTimestamp}/segments.json`;
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
      // P2002 = course concurrente entre deux appels — l'autre a gagné, on s'écrase.
      console.warn(`[autoTranscription] Création job ignorée pour render=${renderId} (race) : ${String(err)}`);
      return;
    }
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
