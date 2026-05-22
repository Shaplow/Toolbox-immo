/**
 * triggerAutoCaptionFromTranscription.ts
 *
 * Déclenche automatiquement un CaptionJob après la fin d'un TranscriptionJob
 * issu du pipeline automatique (job.renderId non null).
 *
 * Appelé depuis le webhook RunPod transcription après COMPLETED.
 * Non bloquant : les erreurs sont loguées mais ne propagent pas.
 */

import { prisma } from "@/lib/prisma";
import { getFromR2, getR2PublicUrl, r2Configured } from "@/lib/r2";
import { submitRunpodJob, runpodConfigured } from "@/lib/runpod";
import { getRunpodWebhookUrl } from "@/lib/webhooks/runpod";
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
  buildTimedSegmentsFromSegments,
  buildWordTimestampsForSubmission,
  realignTimedCaptions,
} from "@/lib/captionWordTiming";
import type { TemplateJSON, CaptionExcludeZone, AnyBlock, VideoSequenceSlot } from "@/types/template";

const RUNPOD_API_KEY     = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;
const FONT_BASE_URL      = process.env.FONT_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";

// ─── Types ────────────────────────────────────────────────────────────────────

type Segment = { start: number; end: number; text: string; speaker?: string };

// ─── Zone resolution ─────────────────────────────────────────────────────────

/**
 * Resolve one exclude zone to { startSec, endSec } using the template blocks.
 * Returns null if the zone cannot be resolved (e.g., group not found).
 */
export function resolveZone(
  zone: CaptionExcludeZone,
  blocks: AnyBlock[],
): { startSec: number; endSec: number | null } | null {
  let startSec: number | undefined;
  let endSec: number | undefined;

  if (zone.startGroupId) {
    const groupBlocks = blocks.filter((b) => b.groupId === zone.startGroupId);
    if (groupBlocks.length > 0) {
      const withAppearAt = groupBlocks.filter((b) => b.appearAt !== undefined);
      if (withAppearAt.length === 0) {
        console.warn(
          `[autoCaption] Zone "${zone.label}" (${zone.id}): aucun bloc du groupe startGroupId="${zone.startGroupId}" n'a de appearAt — zone ignorée`,
        );
        return null;
      }
      startSec = Math.min(...withAppearAt.map((b) => b.appearAt!));
    }
  }
  if (startSec === undefined) {
    startSec = zone.startTime;
  }
  if (startSec === undefined) {
    console.warn(`[autoCaption] Zone "${zone.label}" (${zone.id}): impossible de résoudre startTime — zone ignorée`);
    return null;
  }

  if (zone.endGroupId) {
    const groupBlocks = blocks.filter((b) => b.groupId === zone.endGroupId);
    if (groupBlocks.length > 0) {
      const withAppearAt = groupBlocks.filter((b) => b.appearAt !== undefined);
      if (withAppearAt.length === 0) {
        console.warn(
          `[autoCaption] Zone "${zone.label}" (${zone.id}): aucun bloc du groupe endGroupId="${zone.endGroupId}" n'a de appearAt — fin de zone indéterminée, traitée comme fin de vidéo`,
        );
        // endSec remains undefined → falls through to zone.endTime → null (end of video)
      } else {
        endSec = Math.min(...withAppearAt.map((b) => b.appearAt!));
      }
    }
  }
  if (endSec === undefined) {
    endSec = zone.endTime;
  }

  return { startSec, endSec: endSec ?? null }; // null = end of video
}

/**
 * Compute time zones for excluded sequence slots.
 *
 * Uses effectiveDuration (actualSlotDurations[slot.id] ?? slot.maxDuration) to
 * estimate each slot's position in the concatenated video via a forward pass
 * (cumulative from start) and a reverse pass (cumulative from end).
 * This handles the common case where an interior slot (contenu) has no maxDuration:
 *   - intro  (maxDuration=8):  startSec=0,  endSec=8
 *   - outro  (maxDuration=4):  startSec=duration-4, endSec=null  ← "point barre"
 *   - middle slot: computed from whichever end has enough data
 *
 * actualSlotDurations — probed durations returned by /api/render_sequence — are
 * preferred over the template's maxDuration because maxDuration is often absent.
 *
 * Slots whose position cannot be determined are skipped with a warning.
 */
export function resolveSlotExcludeZones(
  excludeSlotIds: string[],
  slots: VideoSequenceSlot[],
  videoDuration?: number | null,
  actualSlotDurations?: Record<string, number>,
): Array<{ startSec: number; endSec: number | null }> {
  if (!excludeSlotIds.length || !slots.length) return [];

  // effectiveDur: use the probed actual duration when available, fall back to maxDuration
  const effectiveDur = (slot: VideoSequenceSlot): number | undefined =>
    actualSlotDurations?.[slot.id] ?? slot.maxDuration;

  // Forward pass: cumulative start times from the beginning
  const startFwd: (number | null)[] = [];
  let cumFwd: number | null = 0;
  for (const slot of slots) {
    startFwd.push(cumFwd);
    const dur = effectiveDur(slot);
    if (cumFwd !== null && dur !== undefined) {
      cumFwd += dur;
    } else {
      cumFwd = null;
    }
  }

  // Reverse pass: cumulative offset from the end (how many seconds from end each slot's END is)
  const endOffsetFromEnd: (number | null)[] = new Array(slots.length).fill(null);
  let cumRev: number | null = 0;
  for (let i = slots.length - 1; i >= 0; i--) {
    endOffsetFromEnd[i] = cumRev;
    const dur = effectiveDur(slots[i]);
    if (cumRev !== null && dur !== undefined) {
      cumRev += dur;
    } else {
      cumRev = null;
    }
  }

  const zones: Array<{ startSec: number; endSec: number | null }> = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!excludeSlotIds.includes(slot.id)) continue;

    const slotDur = effectiveDur(slot);

    // Resolve startSec: try forward first, then reverse fallback
    let startSec: number | null = startFwd[i];
    if (startSec === null && videoDuration != null) {
      const endOffset = endOffsetFromEnd[i];
      if (endOffset !== null && slotDur !== undefined) {
        startSec = videoDuration - endOffset - slotDur;
      }
    }

    // Resolve endSec: start of next slot (forward or reverse), or video end for last slot
    let endSec: number | null = null;
    if (i + 1 < slots.length) {
      // Not the last slot: end = start of next
      let nextStart = startFwd[i + 1];
      if (nextStart === null && videoDuration != null) {
        const nextEndOffset = endOffsetFromEnd[i + 1];
        const nextSlotDur = effectiveDur(slots[i + 1]);
        if (nextEndOffset !== null && nextSlotDur !== undefined) {
          nextStart = videoDuration - nextEndOffset - nextSlotDur;
        }
      }
      endSec = nextStart;
    } else {
      // Last slot: end = total duration (or null = end of video)
      endSec = videoDuration ?? null;
    }

    if (startSec === null) {
      console.warn(
        `[autoCaption] Slot "${slot.label ?? slot.id}" exclu du sous-titrage mais sa position temporelle est indéterminable (maxDuration et durée réelle manquants) — ignoré`,
      );
      continue;
    }

    zones.push({ startSec: Math.max(0, startSec), endSec });
  }

  return zones;
}

/**
 * Filter segments to remove those that overlap with any excluded zone.
 * A segment is excluded if it overlaps with the zone (any overlap triggers exclusion).
 */
export function applyExcludeZones(
  segments: Segment[],
  zones: Array<{ startSec: number; endSec: number | null }>,
  videoDuration?: number | null,
): Segment[] {
  if (zones.length === 0) return segments;
  return segments.filter((seg) => {
    for (const zone of zones) {
      const zoneEnd = zone.endSec ?? videoDuration ?? Infinity;
      // Overlap: seg.start < zoneEnd && seg.end > zone.startSec
      if (seg.start < zoneEnd && seg.end > zone.startSec) {
        return false;
      }
    }
    return true;
  });
}

// ─── Font asset attachment ────────────────────────────────────────────────────

function extractFontFamilies(configData: Record<string, unknown>): string[] {
  const baseFont = (configData.base as { font?: string } | undefined)?.font;
  const highlightFont = (configData.highlight as { font?: string } | undefined)?.font;
  const highlight2 = configData.highlight2 as { enabled?: boolean; font?: string } | undefined;
  const highlight2Font = highlight2?.enabled ? highlight2.font : undefined;
  return [
    ...new Set([baseFont, highlightFont, highlight2Font].map((f) => f?.trim()).filter(Boolean) as string[]),
  ];
}

async function attachFontAssets(configData: Record<string, unknown>): Promise<Record<string, unknown>> {
  const families = extractFontFamilies(configData);
  if (families.length === 0) return configData;

  const requestedFamilyMap = new Map(families.map((f) => [f.trim().toLowerCase(), f]));
  let assets: { family: string; url: string; originalName: string | null }[] = [];
  try {
    const raw = await listFontAssetsByFamilies(families);
    assets = raw
      .filter(isCaptionCompatibleFontAsset)
      .map((asset) => {
        const url = /^https?:\/\//i.test(asset.url)
          ? asset.url
          : `${FONT_BASE_URL.replace(/\/$/, "")}${asset.url.startsWith("/") ? asset.url : `/${asset.url}`}`;
        return {
          family: requestedFamilyMap.get(asset.family.trim().toLowerCase()) ?? asset.family,
          url,
          originalName: asset.originalName,
        };
      });
  } catch (err) {
    console.warn(`[autoCaption] Font asset lookup failed — proceeding without custom fonts:`, err);
    return configData;
  }
  if (assets.length === 0) return configData;
  return { ...configData, font_assets: assets };
}

// ─── Main trigger ─────────────────────────────────────────────────────────────

export async function triggerAutoCaptionForTranscription(transcriptionJobId: string): Promise<void> {
  if (!r2Configured()) {
    console.info(`[autoCaption] R2 non configuré — skip pour transcriptionJob=${transcriptionJobId}`);
    return;
  }
  if (!runpodConfigured() || !RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
    console.info(`[autoCaption] RunPod non configuré — skip pour transcriptionJob=${transcriptionJobId}`);
    return;
  }

  // Reload the job to get current state (including inputKey retained by the webhook)
  const job = await prisma.transcriptionJob.findUnique({ where: { id: transcriptionJobId } });
  if (!job?.renderId) return;
  if (!job.outputJsonKey) {
    console.warn(`[autoCaption] outputJsonKey manquant sur transcriptionJob=${transcriptionJobId}`);
    return;
  }
  if (!job.inputKey) {
    console.warn(`[autoCaption] inputKey (render video key) manquant sur transcriptionJob=${transcriptionJobId}`);
    return;
  }

  // Load the linked render and template
  const render = await prisma.render.findUnique({ where: { id: job.renderId } });
  if (!render?.templateId) return;

  const template = await prisma.template.findUnique({ where: { id: render.templateId } });
  if (!template) return;

  let templateJson: TemplateJSON;
  try {
    templateJson = JSON.parse(template.jsonData) as TemplateJSON;
  } catch (err) {
    console.error(`[autoCaption] Lecture template JSON échouée : ${String(err)}`);
    return;
  }

  const captionAutoConfig = templateJson.captionAutoConfig;
  if (!captionAutoConfig?.enabled || !captionAutoConfig.presetId) return;

  // Load the preset config
  const preset = await prisma.captionPreset.findUnique({ where: { id: captionAutoConfig.presetId } });
  if (!preset) {
    console.warn(`[autoCaption] Preset ${captionAutoConfig.presetId} introuvable — skip`);
    return;
  }

  let configData: Record<string, unknown>;
  try {
    configData = JSON.parse(preset.config) as Record<string, unknown>;
  } catch {
    configData = {};
  }

  // Download the transcription segments from R2
  let segments: Segment[];
  try {
    const buf = await getFromR2(job.outputJsonKey);
    segments = JSON.parse(buf.toString("utf-8")) as Segment[];
  } catch (err) {
    console.error(`[autoCaption] Lecture segments R2 échouée : ${String(err)}`);
    return;
  }

  // Resolve and apply exclude zones
  // All blocks are flat in templateJson.blocks; groupId references the LayerGroup
  const blocks: AnyBlock[] = templateJson.blocks ?? [];

  const resolvedZones = (captionAutoConfig.excludeZones ?? [])
    .map((zone) => resolveZone(zone, blocks))
    .filter((z): z is NonNullable<typeof z> => z !== null);

  // Slot-based exclusions (sequence templates): convert slot IDs to time zones.
  // slotDurations sont persistées sur Render à la fin du rendu (api/render_sequence ou
  // worker RunPod) — indispensables pour résoudre les bornes quand maxDuration est absent.
  let slotDurations: Record<string, number> | undefined;
  if (render.slotDurations) {
    try {
      slotDurations = JSON.parse(render.slotDurations) as Record<string, number>;
    } catch {
      console.warn(`[autoCaption] slotDurations JSON invalide pour render=${render.id} — ignoré`);
    }
  }

  const slotZones =
    captionAutoConfig.excludeSlotIds?.length && templateJson.videoSequence?.length
      ? resolveSlotExcludeZones(captionAutoConfig.excludeSlotIds, templateJson.videoSequence, job.duration, slotDurations)
      : [];

  const filteredSegments = applyExcludeZones(segments, [...resolvedZones, ...slotZones], job.duration);

  if (filteredSegments.length === 0) {
    console.warn(`[autoCaption] Aucun segment après filtrage des zones — skip pour render=${render.id}`);
    return;
  }

  // ─── AI correction step ──────────────────────────────────────────────────
  // If correctionPromptId is set, run an AI correction pass on the filtered
  // segments before creating the CaptionJob. On failure, create the job as
  // FAILED so the user can see what happened.
  let finalSegments = buildTimedSegmentsFromSegments(filteredSegments);
  let finalHighlighted = new Map<string, number>();
  if (captionAutoConfig.correctionPromptId) {
    const correctionModel = captionAutoConfig.correctionModel ?? "claude";
    if (correctionModel !== "claude" && correctionModel !== "gpt") {
      console.warn(
        `[autoCaption] correctionModel="${correctionModel}" non reconnu — utilisation de GPT par défaut`,
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

      // Convert Segment[] → Caption[] (SRT string timestamps)
      const sourceCaptions = filteredSegments.map((seg, i) => ({
        index: i + 1,
        start: secondsToSrtTimestamp(seg.start),
        end: secondsToSrtTimestamp(seg.end),
        text: seg.text,
      }));

      const existingHighlights = new Set<number>(
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

      const initialHighlighted = new Map<string, number>(highlightedEntries);
      const { segments: realignedSegments } = realignTimedCaptions(finalSegments, cleanCaptions, undefined);
      finalSegments = realignedSegments;
      finalHighlighted = initialHighlighted;

      console.info(
        `[autoCaption] Correction IA (${correctionModel}) appliquée — ${finalSegments.length} segments, ${finalHighlighted.size} highlights pour transcription=${transcriptionJobId}`,
      );
    } catch (err) {
      const errMsg = `Correction IA échouée : ${String(err instanceof Error ? err.message : err)}`;
      console.error(`[autoCaption] ${errMsg} — transcription=${transcriptionJobId}`);
      try {
        const failedJob = await prisma.captionJob.create({
          data: {
            userId:      job.userId,
            status:      "FAILED",
            errorMsg:    errMsg,
            inputKey:    null,
            inputUrl:    getR2PublicUrl(job.inputKey),
            outputKey:   `outputs/captions/${job.userId}/${Date.now()}/auto.mp4`,
            config:      preset.config,
            srtContent:  buildWordTimestampsForSubmission(buildTimedSegmentsFromSegments(filteredSegments), new Map()),
            srtFilename: `auto-transcription-${job.id}.json`,
            previewMode: false,
            presetId:    captionAutoConfig.presetId,
          },
        });
        notifyUser(job.userId, { jobType: "captions", jobId: failedJob.id, status: "FAILED", errorMsg: errMsg });
      } catch (dbErr) {
        console.error(`[autoCaption] Impossible de créer le CaptionJob FAILED (DB error) : ${String(dbErr)}`);
      }
      return;
    }
  }
  // ─── End AI correction ───────────────────────────────────────────────────

  // Attach font assets
  configData = await attachFontAssets(configData);
  configData = normalizeCaptionConfig(configData);

  const jobTimestamp = Date.now();
  const outputKey    = `outputs/captions/${job.userId}/${jobTimestamp}/auto.mp4`;
  const srtContent   = buildWordTimestampsForSubmission(finalSegments, finalHighlighted);
  const srtFilename  = `auto-transcription-${job.id}.json`;

  // Ne pas mettre inputKey : le webhook captions supprimerait la vidéo du render.
  // On passe la public URL dans inputUrl (affichage) et dans le payload RunPod directement.
  const videoUrl   = getR2PublicUrl(job.inputKey);

  const captionJob = await prisma.captionJob.create({
    data: {
      userId:      job.userId,
      status:      "QUEUED",
      inputKey:    null,
      inputUrl:    videoUrl,
      outputKey,
      config:      JSON.stringify(configData),
      srtContent,
      srtFilename,
      previewMode: false,
      presetId:    captionAutoConfig.presetId,
    },
  });

  // Submit to RunPod
  const webhookUrl = getRunpodWebhookUrl("/api/webhooks/runpod/captions");

  const payload = {
    input: {
      video_url:      videoUrl,
      srt_content:    srtContent,
      config:         configData,
      preview_mode:   false,
      output_key:     outputKey,
      caption_job_id: captionJob.id,
    },
    ...(webhookUrl ? { webhook: webhookUrl } : {}),
  };

  try {
    await prisma.captionJob.update({
      where: { id: captionJob.id },
      data: { status: "PROCESSING" },
    });

    const data = await submitRunpodJob<{ id: string }>(
      RUNPOD_ENDPOINT_ID,
      RUNPOD_API_KEY,
      payload,
    );

    await prisma.captionJob.update({
      where: { id: captionJob.id },
      data: { runpodJobId: data.id },
    });

    console.info(
      `[autoCaption] CaptionJob ${captionJob.id} soumis (RunPod: ${data.id}) depuis transcription=${transcriptionJobId}`,
    );
  } catch (err) {
    await prisma.captionJob.update({
      where: { id: captionJob.id },
      data: { status: "FAILED", errorMsg: String(err) },
    });
    console.error(
      `[autoCaption] Échec soumission RunPod pour transcription=${transcriptionJobId} : ${String(err)}`,
    );
    // Non bloquant
  }
}
