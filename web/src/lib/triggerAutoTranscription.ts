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
import { getR2PublicUrl, r2Configured, uploadToR2 } from "@/lib/r2";
import { submitRunpodJob, runpodConfigured } from "@/lib/runpod";
import { getRunpodWebhookUrl } from "@/lib/webhooks/runpod";
import type { TemplateJSON } from "@/types/template";

const RUNPOD_API_KEY     = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;
const USE_RUNPOD         = process.env.USE_RUNPOD !== "false";
const CAPTIONS_API_URL   = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";

/**
 * Mode local (USE_RUNPOD=false) : fetch la vidéo render + POST direct sur
 * `${CAPTIONS_API_URL}/api/transcribe`. Pendant local, `renderOutputKey`
 * peut être une vraie clé R2 OU une URL relative type `/outputs/...`.
 */
async function runLocalRenderTranscription(
  renderId: string,
  renderOutputKey: string,
  userId: string,
  fetchableUrl: string,
): Promise<void> {
  const existing = await prisma.transcriptionJob.findUnique({
    where: { renderId },
    select: { id: true, status: true },
  });
  if (existing && existing.status !== "FAILED") {
    console.info(
      `[autoTranscription] LOCAL job déjà ${existing.status} pour render=${renderId} — skip`,
    );
    return;
  }

  const job = existing
    ? await prisma.transcriptionJob.update({
        where: { id: existing.id },
        data: {
          status: "PROCESSING",
          errorMsg: null,
          inputKey: renderOutputKey,
          inputFilename: `render-${renderId}.mp4`,
        },
        select: { id: true },
      })
    : await prisma.transcriptionJob.create({
        data: {
          userId,
          status: "PROCESSING",
          inputKey: renderOutputKey,
          inputFilename: `render-${renderId}.mp4`,
          model: "turbo",
          language: "fr",
          enableDiarization: false,
          renderId,
        },
        select: { id: true },
      });

  try {
    const videoRes = await fetch(fetchableUrl);
    if (!videoRes.ok) {
      throw new Error(`fetch video failed: ${videoRes.status} ${videoRes.statusText}`);
    }
    const blob = await videoRes.blob();

    const form = new FormData();
    form.append("audio", blob, `render-${renderId}.mp4`);
    form.append("model_size", "large-v3-turbo");
    form.append("language", "fr");
    form.append("enable_diarization", "false");

    const apiRes = await fetch(`${CAPTIONS_API_URL}/api/transcribe`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30 * 60 * 1000),
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
      has_diarization: boolean;
    };

    let outputJsonKey: string | null = null;
    if (r2Configured()) {
      const key = `transcription/${userId}/${Date.now()}/segments.json`;
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
        segmentsJson: outputJsonKey ? null : JSON.stringify(data.segments),
        segmentCount: data.segment_count,
        duration: data.duration,
        hasDiarization: data.has_diarization,
      },
    });

    // Promote transcription comme active sur le slot du render.
    const render = await prisma.render.findUnique({
      where: { id: renderId },
      select: { publicationSlot: { select: { id: true } } },
    });
    if (render?.publicationSlot?.id) {
      await prisma.publicationSlot.update({
        where: { id: render.publicationSlot.id },
        data: { activeTranscriptionJobId: job.id },
      });
    }

    console.info(
      `[autoTranscription] LOCAL job=${job.id} COMPLETED render=${renderId} segments=${data.segment_count}`,
    );
  } catch (err) {
    await prisma.transcriptionJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMsg: String(err) },
    });
    console.error(
      `[autoTranscription] LOCAL transcription failed render=${renderId}: ${String(err)}`,
    );
  }
}

export async function triggerAutoTranscriptionForRender(
  renderId: string,
  templateId: string | null | undefined,
  renderOutputKey: string,
  userId: string,
): Promise<void> {
  if (!templateId) return;

  // ── Mode local (USE_RUNPOD=false) : pipeline synchrone via render-engine
  // local. Vérifie pareil que le mode RunPod : template doit avoir
  // captionAutoConfig.enabled OU le slot doit demander description auto.
  if (!USE_RUNPOD) {
    // Re-check captionAutoConfig + needsDescriptionAuto comme en RunPod plus bas.
    let captionAutoEnabled = false;
    try {
      const template = await prisma.template.findUnique({ where: { id: templateId } });
      if (template) {
        const json = JSON.parse(template.jsonData) as TemplateJSON;
        captionAutoEnabled = json.captionAutoConfig?.enabled === true;
      }
    } catch {}

    let needsDescriptionAuto = false;
    try {
      const render = await prisma.render.findUnique({
        where: { id: renderId },
        select: {
          videoUrl: true,
          publicationSlot: {
            select: {
              needsDescriptionOverride: true,
              pattern: { select: { needsDescription: true } },
            },
          },
        },
      });
      needsDescriptionAuto =
        (render?.publicationSlot?.needsDescriptionOverride ??
          render?.publicationSlot?.pattern?.needsDescription ??
          "none") === "autoGenerate";

      if (!captionAutoEnabled && !needsDescriptionAuto) return;

      // Pour le fetch local : si r2Configured, on a une URL publique R2,
      // sinon on doit utiliser render.videoUrl directement (ex. URL Next.js
      // sur /uploads/...).
      const fetchableUrl = r2Configured()
        ? getR2PublicUrl(renderOutputKey)
        : render?.videoUrl ?? null;
      if (!fetchableUrl) {
        console.info(
          `[autoTranscription] LOCAL render=${renderId} sans videoUrl — skip`,
        );
        return;
      }
      await runLocalRenderTranscription(renderId, renderOutputKey, userId, fetchableUrl);
    } catch (err) {
      console.error(
        `[autoTranscription] LOCAL erreur lookup render=${renderId} : ${String(err)}`,
      );
    }
    return;
  }

  // ── Mode RunPod (prod) ─────────────────────────────────────────────────
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
