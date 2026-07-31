/**
 * triggerAutoTranscriptionLocal.ts
 *
 * Pipeline auto-sous-titrage synchrone pour le mode local (USE_RUNPOD=false).
 * Effectue transcription + correction IA + burn-in en un seul appel bloquant
 * contre l'API render-engine locale (CAPTIONS_API_URL).
 *
 * Appelé depuis generateSequenceRenderLocal / generateVideoRenderLocal après DONE.
 * Non bloquant pour l'appelant : les erreurs sont loguées mais ne propagent pas.
 */

import { prisma } from "@/lib/prisma";
import { normalizeCaptionConfig } from "@/lib/captionsEngine";
import { isCaptionCompatibleFontAsset, listFontAssetsByFamilies } from "@/lib/fontAssets";
import { findCaptionPromptForCorrection } from "@/lib/captionPromptStore";
import { normalizeCaptionAutoHighlight } from "@/lib/captionPrompt";
import { notifyUser } from "@/lib/sseStore";
import {
  AUTO_HIGHLIGHT_GROUPS,
  correctWithClaude,
  correctWithGPT,
  secondsToSrtTimestamp,
  validateCorrectedCaptions,
} from "@/lib/captionCorrector";
import { parseHighlightedCaptions } from "@/lib/srt";
import {
  resolveZone,
  resolveSlotExcludeZones,
  applyExcludeZones,
} from "@/lib/triggerAutoCaptionFromTranscription";
import {
  buildTimedSegmentsFromSegments,
  buildWordTimestampsForSubmission,
  realignTimedCaptions,
} from "@/lib/captionWordTiming";
import type { Segment } from "@/lib/transcriptionProcess";
import type { TemplateJSON, AnyBlock } from "@/types/template";

const FONT_BASE_URL = process.env.FONT_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";

async function attachFontAssets(configData: Record<string, unknown>): Promise<Record<string, unknown>> {
  const baseFont = (configData.base as { font?: string } | undefined)?.font;
  const highlightFont = (configData.highlight as { font?: string } | undefined)?.font;
  const highlight2 = configData.highlight2 as { enabled?: boolean; font?: string } | undefined;
  const highlight2Font = highlight2?.enabled ? highlight2.font : undefined;
  const families = [
    ...new Set([baseFont, highlightFont, highlight2Font].map((f) => f?.trim()).filter(Boolean) as string[]),
  ];
  if (families.length === 0) return configData;

  const requestedFamilyMap = new Map(families.map((f) => [f.trim().toLowerCase(), f]));
  try {
    const raw = await listFontAssetsByFamilies(families);
    const assets = raw
      .filter(isCaptionCompatibleFontAsset)
      .map((asset) => ({
        family: requestedFamilyMap.get(asset.family.trim().toLowerCase()) ?? asset.family,
        url: /^https?:\/\//i.test(asset.url)
          ? asset.url
          : `${FONT_BASE_URL.replace(/\/$/, "")}${asset.url.startsWith("/") ? asset.url : `/${asset.url}`}`,
        originalName: asset.originalName,
      }));
    if (assets.length === 0) return configData;
    return { ...configData, font_assets: assets };
  } catch (err) {
    console.warn(`[autoTranscriptionLocal] Font asset lookup failed — proceeding without custom fonts:`, err);
    return configData;
  }
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

/**
 * Déclenche le pipeline auto-sous-titrage local (transcription → correction IA → burn-in).
 *
 * @param renderId             ID du render (déjà DONE)
 * @param captionsApiUrl       CAPTIONS_API_URL, ex. "http://localhost:8000"
 * @param renderEngineVideoPath Chemin retourné par le render engine, ex. "/outputs/temp/api/composite_xxx.mp4"
 */
export async function triggerAutoTranscriptionLocal(
  renderId: string,
  captionsApiUrl: string,
  renderEngineVideoPath: string,
): Promise<void> {
  // 1. Load render + template ──────────────────────────────────────────────────
  const render = await prisma.render.findUnique({
    where: { id: renderId },
    include: { listing: { select: { userId: true } } },
  });
  if (!render?.templateId || !render.listing?.userId) return;

  let slotDurations: Record<string, number> = {};
  if (render.slotDurations) {
    try {
      slotDurations = JSON.parse(render.slotDurations) as Record<string, number>;
    } catch {
      console.warn(`[autoTranscriptionLocal] slotDurations JSON invalide pour render=${renderId} — ignoré`);
    }
  }

  const template = await prisma.template.findUnique({ where: { id: render.templateId } });
  if (!template) return;

  let templateJson: TemplateJSON;
  try {
    templateJson = JSON.parse(template.jsonData) as TemplateJSON;
  } catch {
    return;
  }

  const captionAutoConfig = templateJson.captionAutoConfig;
  if (!captionAutoConfig?.enabled || !captionAutoConfig.presetId) return;

  const userId = render.listing.userId;

  // Idempotence : éviter les doublons si ce render a déjà un job
  const existing = await prisma.transcriptionJob.findUnique({ where: { renderId } });
  if (existing) {
    console.info(`[autoTranscriptionLocal] Job déjà existant pour render=${renderId} — skip`);
    return;
  }

  // 2. Créer le TranscriptionJob ───────────────────────────────────────────────
  const jobTimestamp = Date.now();
  let transcriptionJob: { id: string };
  try {
    transcriptionJob = await prisma.transcriptionJob.create({
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
    });
  } catch (err) {
    // P2002 = contrainte unique violée (race condition) — non bloquant
    console.warn(`[autoTranscriptionLocal] Création TranscriptionJob ignorée pour render=${renderId}: ${String(err)}`);
    return;
  }

  const videoDownloadUrl = `${captionsApiUrl}${renderEngineVideoPath}`;

  // Déclarés hors du try pour être accessibles dans le catch.
  let captionJob: { id: string } | undefined;
  // Vrai uniquement si la transcription elle-même s'est terminée avec succès.
  // Empêche d'écraser un statut COMPLETED par FAILED pour des erreurs survenant
  // dans les étapes suivantes (preset, burn-in, DB finale).
  let transcriptionCompleted = false;

  try {
    // 3. Télécharger la vidéo depuis le render engine ──────────────────────────
    const videoRes = await fetch(videoDownloadUrl, { signal: AbortSignal.timeout(60_000) });
    if (!videoRes.ok) {
      throw new Error(`Téléchargement vidéo échoué (${videoRes.status}): ${videoDownloadUrl}`);
    }
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    const videoBlob = new Blob([videoBuffer], { type: "video/mp4" });
    console.info(
      `[autoTranscriptionLocal] Vidéo téléchargée (${videoBuffer.byteLength} octets) pour render=${renderId}`,
    );

    // 4. Transcription ─────────────────────────────────────────────────────────
    const transcribeForm = new FormData();
    transcribeForm.append("audio", videoBlob, `render-${renderId}.mp4`);
    transcribeForm.append("model_size", "turbo");
    transcribeForm.append("language", "fr");
    transcribeForm.append("enable_diarization", "false");

    const transcribeRes = await fetch(`${captionsApiUrl}/api/transcribe`, {
      method: "POST",
      body: transcribeForm,
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!transcribeRes.ok) {
      throw new Error(`Transcription échouée (${transcribeRes.status}): ${await transcribeRes.text()}`);
    }

    const transcribeData = await transcribeRes.json() as { segments: Segment[]; duration?: number };
    const videoDuration = transcribeData.duration ?? null;
    let segments: Segment[] = transcribeData.segments ?? [];

    console.info(
      `[autoTranscriptionLocal] Transcription OK: ${segments.length} segments, durée=${videoDuration}s pour render=${renderId}`,
    );

    await prisma.transcriptionJob.update({
      where: { id: transcriptionJob.id },
      data: { status: "COMPLETED", segmentCount: segments.length, duration: videoDuration },
    });
    transcriptionCompleted = true;

    // 5. Appliquer les zones d'exclusion ───────────────────────────────────────
    const blocks: AnyBlock[] = templateJson.blocks ?? [];
    const resolvedZones = (captionAutoConfig.excludeZones ?? [])
      .map((zone) => resolveZone(zone, blocks, templateJson.groups ?? []))
      .filter((z): z is NonNullable<typeof z> => z !== null);

    const slotZones =
      captionAutoConfig.excludeSlotIds?.length && templateJson.videoSequence?.length
        ? resolveSlotExcludeZones(captionAutoConfig.excludeSlotIds, templateJson.videoSequence, videoDuration, slotDurations)
        : [];

    segments = applyExcludeZones(segments, [...resolvedZones, ...slotZones], videoDuration);

    if (segments.length === 0) {
      const warnMsg = "Aucun segment à sous-titrer après application des zones d'exclusion";
      console.warn(`[autoTranscriptionLocal] ${warnMsg} — render=${renderId}`);
      // Créer un CaptionJob FAILED pour que l'utilisateur soit notifié
      try {
        const emptyJob = await prisma.captionJob.create({
          data: {
            userId,
            status: "FAILED",
            errorMsg: warnMsg,
            inputKey: null,
            inputUrl: videoDownloadUrl,
            outputKey: `outputs/captions/${userId}/${Date.now()}/auto.mp4`,
            config: "{}",
            srtContent: "[]",
            srtFilename: `auto-${transcriptionJob.id}.json`,
            previewMode: false,
            presetId: captionAutoConfig.presetId,
            // Fix 2026-05-30 : lier au slot du render parent (pipeline local).
            slotId: render.publicationSlotId ?? null,
          },
        });
        notifyUser(userId, { jobType: "captions", jobId: emptyJob.id, status: "FAILED", errorMsg: warnMsg });
      } catch { /* ignore */ }
      return;
    }

    // Préparer les segments avec timing mot par mot de WhisperX.
    // buildTimedSegmentsFromSegments capitalise sur seg.words[] quand disponibles
    // et génère des timings synthétiques distribués uniformément sinon.
    const timedSegments = buildTimedSegmentsFromSegments(segments);

    // 6. Correction IA (optionnelle) ───────────────────────────────────────────
    // finalSegments et finalHighlighted sont mis à jour par la correction IA.
    // Sans correction : timedSegments avec timing WhisperX, aucun highlight.
    let finalSegments = timedSegments;
    let finalHighlighted = new Map<string, number>();

    if (captionAutoConfig.correctionPromptId) {
      const correctionModel = captionAutoConfig.correctionModel ?? "claude";
      if (correctionModel !== "claude" && correctionModel !== "gpt") {
        console.warn(
          `[autoTranscriptionLocal] correctionModel="${correctionModel}" non reconnu — utilisation de GPT par défaut`,
        );
      }
      try {
        const storedPrompt = await findCaptionPromptForCorrection(captionAutoConfig.correctionPromptId);
        if (!storedPrompt) {
          throw new Error(`Prompt de correction ${captionAutoConfig.correctionPromptId} introuvable`);
        }

        const autoHighlight = normalizeCaptionAutoHighlight({
          enabled: storedPrompt.autoHighlightEnabled,
          mode: storedPrompt.autoHighlightMode,
          placement: storedPrompt.autoHighlightPlacement,
          prompt: storedPrompt.autoHighlightPrompt ?? "",
        });

        // sourceCaptions au niveau segment original (phrases complètes) pour
        // une meilleure qualité de correction IA.
        const sourceCaptions = segments.map((seg, i) => ({
          index: i + 1,
          start: secondsToSrtTimestamp(seg.start),
          end: secondsToSrtTimestamp(seg.end),
          text: seg.text,
        }));

        const existingHighlights = new Set(
          Array.from(parseHighlightedCaptions(sourceCaptions).highlighted.values()),
        );
        const allowedHighlightGroups = new Set(existingHighlights);
        if (autoHighlight.enabled) {
          for (const group of AUTO_HIGHLIGHT_GROUPS[autoHighlight.mode]) {
            allowedHighlightGroups.add(group);
          }
        }

        const signal = AbortSignal.timeout(60_000);
        const rawCorrected =
          correctionModel === "claude"
            ? await correctWithClaude(sourceCaptions, storedPrompt.prompt, autoHighlight, signal)
            : await correctWithGPT(sourceCaptions, storedPrompt.prompt, autoHighlight, signal);

        const { captions: cleanCaptions, highlighted: highlightedEntries } = validateCorrectedCaptions(
          sourceCaptions,
          rawCorrected,
          allowedHighlightGroups,
        );

        // validateCorrectedCaptions internally strips <N>…</N> markers and returns
        // the clean captions + highlight entries keyed by "${c.index}-${wordIdx}".
        // We use those entries directly — calling parseHighlightedCaptions again on the
        // already-stripped captions would always return an empty map.
        const initialHighlighted = new Map<string, number>(highlightedEntries);
        const { segments: realignedSegments } = realignTimedCaptions(timedSegments, cleanCaptions, undefined);
        finalSegments = realignedSegments;
        finalHighlighted = initialHighlighted;

        console.info(
          `[autoTranscriptionLocal] Correction IA (${correctionModel}) appliquée: ${finalSegments.length} segments, ${finalHighlighted.size} highlights pour render=${renderId}`,
        );
      } catch (err) {
        const errMsg = `Correction IA échouée: ${String(err instanceof Error ? err.message : err)}`;
        console.error(`[autoTranscriptionLocal] ${errMsg} — render=${renderId}`);
        try {
          const failedJob = await prisma.captionJob.create({
            data: {
              userId,
              status: "FAILED",
              errorMsg: errMsg,
              inputKey: null,
              inputUrl: videoDownloadUrl,
              outputKey: `outputs/captions/${userId}/${Date.now()}/auto.mp4`,
              config: "{}",
              srtContent: buildWordTimestampsForSubmission(timedSegments, new Map()),
              srtFilename: `auto-${transcriptionJob.id}.json`,
              previewMode: false,
              presetId: captionAutoConfig.presetId,
              // Fix 2026-05-30 : lier au slot du render parent (pipeline local).
              slotId: render.publicationSlotId ?? null,
            },
          });
          notifyUser(userId, { jobType: "captions", jobId: failedJob.id, status: "FAILED", errorMsg: errMsg });
        } catch { /* ignore */ }
        return;
      }
    }

    // 7. Charger le preset + normaliser la config ───────────────────────────────
    const preset = await prisma.captionPreset.findUnique({ where: { id: captionAutoConfig.presetId } });
    if (!preset) throw new Error(`Preset ${captionAutoConfig.presetId} introuvable`);

    let configData: Record<string, unknown>;
    try {
      configData = JSON.parse(preset.config) as Record<string, unknown>;
    } catch {
      configData = {};
    }
    configData = await attachFontAssets(configData);
    configData = normalizeCaptionConfig(configData);

    // 8. Sérialiser en JSON mot par mot (timing précis + highlights) ────────────
    const srtContent = buildWordTimestampsForSubmission(finalSegments, finalHighlighted);
    const srtFilename = `auto-${transcriptionJob.id}.json`;

    // 9. Créer le CaptionJob ───────────────────────────────────────────────────
    captionJob = await prisma.captionJob.create({
      data: {
        userId,
        status: "PROCESSING",
        inputKey: null,
        inputUrl: videoDownloadUrl,
        outputKey: `outputs/captions/${userId}/${Date.now()}/auto.mp4`,
        config: JSON.stringify(configData),
        srtContent,
        srtFilename,
        previewMode: false,
        presetId: captionAutoConfig.presetId,
        // Fix 2026-05-30 : lier au slot pour que la fiche publication voie le
        // job dans slot.captionJobs[] et que la version sous-titrée puisse
        // remplacer la brute via getSlotFinalVideoUrl.
        slotId: render.publicationSlotId ?? null,
      },
    });

    // 10. Burn-in des captions ─────────────────────────────────────────────────
    const captionForm = new FormData();
    captionForm.append("video", videoBlob, `render-${renderId}.mp4`);
    captionForm.append(
      "subtitles",
      new Blob([srtContent], { type: "text/plain" }),
      srtFilename,
    );
    captionForm.append("config", JSON.stringify(configData));
    captionForm.append("preview_mode", "false");

    const captionRes = await fetch(`${captionsApiUrl}/api/render`, {
      method: "POST",
      body: captionForm,
      signal: AbortSignal.timeout(20 * 60_000),
    });
    if (!captionRes.ok) {
      throw new Error(`Captions render échoué (${captionRes.status}): ${await captionRes.text()}`);
    }

    const captionData = await captionRes.json() as { videoUrl: string };
    const outputUrl = captionData.videoUrl.startsWith("http")
      ? captionData.videoUrl
      : `/api/captions${captionData.videoUrl.startsWith("/") ? captionData.videoUrl : `/${captionData.videoUrl}`}`;

    // 11. Marquer le CaptionJob comme terminé ──────────────────────────────────
    await prisma.captionJob.update({
      where: { id: captionJob.id },
      data: { status: "COMPLETED", outputUrl },
    });

    notifyUser(userId, { jobType: "captions", jobId: captionJob.id, status: "COMPLETED" });
    console.info(
      `[autoTranscriptionLocal] CaptionJob ${captionJob.id} terminé: ${outputUrl} — render=${renderId}`,
    );
  } catch (err) {
    console.error(`[autoTranscriptionLocal] Erreur pipeline pour render=${renderId}: ${String(err)}`);
    // Si le CaptionJob a déjà été créé, le marquer FAILED et notifier l'utilisateur.
    if (captionJob) {
      await prisma.captionJob
        .update({
          where: { id: captionJob.id },
          data: { status: "FAILED", errorMsg: String(err) },
        })
        .catch(() => {
          /* ignore secondary DB error */
        });
      notifyUser(userId, { jobType: "captions", jobId: captionJob.id, status: "FAILED", errorMsg: String(err) });
    }
    // Ne mettre le TranscriptionJob en FAILED que s'il n'a pas été marqué COMPLETED.
    // Évite d'écraser un COMPLETED avec un message d'erreur d'une étape ultérieure.
    if (!transcriptionCompleted) {
      await prisma.transcriptionJob
        .update({
          where: { id: transcriptionJob.id },
          data: { status: "FAILED", errorMsg: String(err) },
        })
        .catch(() => {
          /* ignore secondary DB error */
        });
    }
  }
}
