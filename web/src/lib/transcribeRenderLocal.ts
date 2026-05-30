/**
 * transcribeRenderLocal.ts
 *
 * Helper "transcription seule" qui appelle directement le render-engine local
 * (CAPTIONS_API_URL → /api/transcribe) sans dépendre de RunPod ni du pipeline
 * captions complet.
 *
 * Cas d'usage principal : un slot a needsDescription=autoGenerate mais pas
 * de captions (needsCaptions=false). On a besoin d'une transcription pour
 * servir la description, mais on ne veut pas burn-in des captions sur la
 * vidéo. triggerAutoTranscriptionLocal (existant) ne sait faire que les
 * deux ensemble.
 *
 * Fonctionnement :
 *  1. Charge le Render (avec videoUrl R2) + check existing TranscriptionJob
 *     - COMPLETED → no-op + trigger description direct
 *     - QUEUED/PROCESSING → no-op (un autre appel s'en charge)
 *     - FAILED → reset en QUEUED (clear errorMsg)
 *     - null → create
 *  2. Télécharge la vidéo (R2 public URL) → POST /api/transcribe (render-engine)
 *  3. UPDATE le TranscriptionJob en COMPLETED + segments
 *  4. Appelle triggerAutoDescriptionForTranscription (qui crée le DescriptionJob)
 *
 * Non bloquant : tout throw est logué et finalisé en TranscriptionJob FAILED.
 */

import { prisma } from "@/lib/prisma";
import { triggerAutoDescriptionForTranscription } from "@/lib/triggerAutoDescriptionFromTranscription";
import { notifyUser } from "@/lib/sseStore";

type Segment = { start: number; end: number; text: string; speaker?: string };

const CAPTIONS_API = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";

/**
 * Résout une videoUrl stockée en URL absolue téléchargeable côté serveur.
 *
 * En dev, render.videoUrl peut être :
 *  - "http(s)://..." → URL absolue (R2 public, ou render-engine direct)
 *  - "/api/captions/outputs/..." → URL Next qui proxy vers le render-engine
 *    → on shortcut vers CAPTIONS_API/outputs/... pour éviter le détour
 *  - "/outputs/..." → path relatif render-engine, on préfixe avec CAPTIONS_API
 *  - autre "/..." → on préfixe avec NEXTAUTH_URL ou localhost
 */
function resolveVideoUrl(videoUrl: string): string {
  if (/^https?:\/\//i.test(videoUrl)) return videoUrl;
  if (videoUrl.startsWith("/api/captions/")) {
    return `${CAPTIONS_API}${videoUrl.replace("/api/captions", "")}`;
  }
  if (videoUrl.startsWith("/outputs/") || videoUrl.startsWith("/api/")) {
    return `${CAPTIONS_API}${videoUrl}`;
  }
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${base}${videoUrl.startsWith("/") ? videoUrl : `/${videoUrl}`}`;
}

export async function transcribeRenderLocal(renderId: string): Promise<void> {
  console.info(`[transcribeRenderLocal] === START render=${renderId} CAPTIONS_API=${CAPTIONS_API}`);
  const render = await prisma.render.findUnique({
    where: { id: renderId },
    select: {
      id: true,
      videoUrl: true,
      status: true,
      listing: { select: { userId: true } },
      publicationSlotId: true,
    },
  });
  if (!render) {
    console.warn(`[transcribeRenderLocal] render=${renderId} introuvable`);
    return;
  }
  console.info(`[transcribeRenderLocal] render loaded status=${render.status} videoUrl=${render.videoUrl?.slice(0, 80)} userId=${render.listing?.userId} slotId=${render.publicationSlotId}`);
  if (!render.listing?.userId) {
    console.warn(`[transcribeRenderLocal] render=${renderId} orphelin (sans listing.userId)`);
    return;
  }
  if (render.status !== "DONE" || !render.videoUrl) {
    console.warn(`[transcribeRenderLocal] render=${renderId} pas DONE ou sans videoUrl — skip`);
    return;
  }

  const userId = render.listing.userId;

  // Lookup ou reset du TranscriptionJob existant.
  const existing = await prisma.transcriptionJob.findUnique({
    where: { renderId },
    select: { id: true, status: true, segmentsJson: true, segmentCount: true },
  });

  let jobId: string;
  if (existing) {
    // COMPLETED MAIS sans segments utilisables → on retraite comme FAILED.
    // (cas typique : transcription ancienne créée AVANT que segmentsJson
    // existe en DB — relancer pour qu'on persiste les segments cette fois.)
    const hasUsableSegments =
      (existing.segmentCount ?? 0) > 0 && !!existing.segmentsJson && existing.segmentsJson.length > 2;

    if (existing.status === "COMPLETED" && hasUsableSegments) {
      console.info(`[transcribeRenderLocal] transcription ${existing.id} déjà COMPLETED avec segments — trigger description direct`);
      void triggerAutoDescriptionForTranscription(existing.id).catch((err) =>
        console.error(`[transcribeRenderLocal] triggerAutoDescription failed: ${String(err)}`),
      );
      return;
    }
    if (existing.status === "QUEUED" || existing.status === "PROCESSING") {
      console.info(`[transcribeRenderLocal] transcription ${existing.id} déjà ${existing.status} — skip`);
      return;
    }
    // FAILED OU COMPLETED-mais-vide → reset
    console.info(`[transcribeRenderLocal] reset job ${existing.id} (status=${existing.status} segments=${existing.segmentCount ?? 0}) → re-transcribe`);
    await prisma.transcriptionJob.update({
      where: { id: existing.id },
      data: { status: "PROCESSING", errorMsg: null, runpodJobId: null },
    });
    jobId = existing.id;
  } else {
    const jobTimestamp = Date.now();
    const created = await prisma.transcriptionJob.create({
      data: {
        userId,
        status: "PROCESSING",
        inputKey: `renders/${renderId}.mp4`,
        inputFilename: `render-${renderId}.mp4`,
        model: "turbo",
        language: "fr",
        enableDiarization: false,
        outputJsonKey: `transcription/${userId}/${jobTimestamp}/segments.json`,
        renderId,
      },
    }).catch((err) => {
      console.warn(`[transcribeRenderLocal] Création TranscriptionJob race pour render=${renderId}: ${String(err)}`);
      return null;
    });
    if (!created) return;
    jobId = created.id;
  }

  notifyUser(userId, { jobType: "transcription", jobId, status: "PROCESSING" });

  // Téléchargement + transcription locale.
  try {
    const downloadUrl = resolveVideoUrl(render.videoUrl);
    console.info(`[transcribeRenderLocal] download ${downloadUrl} (raw=${render.videoUrl})`);
    const videoRes = await fetch(downloadUrl, { signal: AbortSignal.timeout(60_000) });
    if (!videoRes.ok) {
      throw new Error(`Téléchargement vidéo échoué (${videoRes.status}): ${downloadUrl}`);
    }
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    const videoBlob = new Blob([videoBuffer], { type: "video/mp4" });

    const form = new FormData();
    form.append("audio", videoBlob, `render-${renderId}.mp4`);
    form.append("model_size", "turbo");
    form.append("language", "fr");
    form.append("enable_diarization", "false");

    console.info(`[transcribeRenderLocal] POST ${CAPTIONS_API}/api/transcribe (size=${videoBuffer.byteLength})`);
    const res = await fetch(`${CAPTIONS_API}/api/transcribe`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok) {
      throw new Error(`Transcribe ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as { segments: Segment[]; duration?: number };

    // Persist les segments en DB (champ segmentsJson) pour qu'un caller
    // ultérieur (sweep, retry, trigger-description sur job existant) puisse
    // reconstruire le transcript sans dépendre de R2.
    await prisma.transcriptionJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        segmentCount: data.segments?.length ?? 0,
        duration: data.duration ?? null,
        segmentsJson: JSON.stringify(data.segments ?? []),
      },
    });
    notifyUser(userId, { jobType: "transcription", jobId, status: "COMPLETED" });

    console.info(`[transcribeRenderLocal] transcription ${jobId} COMPLETED (${data.segments?.length ?? 0} segments)`);

    // Reconstitue le texte transcript depuis les segments (équivalent du
    // R2-read côté prod) — on le passe directement au helper description
    // pour éviter la lecture R2 qui n'a pas de fichier en local.
    const transcriptText = (data.segments ?? [])
      .map((s) => (s.text ?? "").trim())
      .filter(Boolean)
      .join("\n");

    void triggerAutoDescriptionForTranscription(jobId, transcriptText).catch((err) =>
      console.error(`[transcribeRenderLocal] triggerAutoDescription failed: ${String(err)}`),
    );
  } catch (err) {
    const errorMsg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    console.error(`[transcribeRenderLocal] échec transcription ${jobId}: ${errorMsg}`);
    await prisma.transcriptionJob.update({
      where: { id: jobId },
      data: { status: "FAILED", errorMsg },
    });
    notifyUser(userId, { jobType: "transcription", jobId, status: "FAILED", errorMsg });
  }
}
