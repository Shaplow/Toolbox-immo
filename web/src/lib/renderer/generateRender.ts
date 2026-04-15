import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { buildHTML } from "./buildHTML";
import { renderPNG } from "./renderPNG";
import { renderPDF } from "./renderPDF";
import { validateConformite } from "@/lib/validation/conformite";
import type { TemplateJSON, CanvasFormat, ImageBlock, VideoBlock, MusicBlock, AnyBlock } from "@/types/template";
import type { ListingData } from "@/types/listing";
import { writeFile, mkdir, stat, readFile } from "fs/promises";
import path from "path";
import { uploadToR2, r2Configured } from "@/lib/r2";
import { submitRunpodJob } from "@/lib/runpod";
import { normalizeTemplateJSON } from "@/lib/templateNormalization";
import { isBlockVisibleForListing, resolveBlockForListing } from "@/lib/templateConditions";
import { getVisibleFieldKeys } from "@/lib/formSections";
import { RENDER_PIPELINE, RENDER_STAGE } from "./renderWorkflow";

const OUTPUT_DIR = path.join(process.cwd(), "public", "renders");
const LOCAL_VIDEO_RENDER_TIMEOUT_MS = 10 * 60 * 1000;
const RUNPOD_SUBMIT_TIMEOUT_MS = 30 * 1000;

/** Minimum file size in bytes to be considered adequate resolution (~100KB for photos) */
const MIN_IMAGE_BYTES = 100_000;
/** Minimum pixels for a print-ready image at 300dpi A3 */
const MIN_PRINT_PX = 800;

async function collectImageWarnings(
  templateJson: TemplateJSON,
  listingData: ListingData
): Promise<string[]> {
  const warnings: string[] = [];
  const imageBlocks = templateJson.blocks.filter((b) => b.type === "image") as ImageBlock[];

  for (const block of imageBlocks) {
    const binding = block.binding;
    if (!binding) continue;
    const value = (listingData as Record<string, unknown>)[binding];
    if (typeof value !== "string" || !value) continue;

    // Only check local uploads
    if (!value.startsWith("/uploads/")) continue;
    const filePath = path.join(process.cwd(), "public", value);
    try {
      const info = await stat(filePath);
      if (info.size < MIN_IMAGE_BYTES) {
        warnings.push(
          `Image "${binding}" semble de faible résolution (${Math.round(info.size / 1024)} Ko — recommandé > ${Math.round(MIN_IMAGE_BYTES / 1024)} Ko pour l'impression).`
        );
      }
      // Check against canvas dimensions
      const { width, height } = templateJson.canvas;
      const blockPx = Math.max(block.w, block.h);
      if (blockPx > MIN_PRINT_PX && info.size < 300_000) {
        const already = warnings.some((w) => w.includes(binding));
        if (!already) {
          warnings.push(
            `Image "${binding}" peut être pixelisée à l'impression (bloc ${block.w}×${block.h}px sur canvas ${width}×${height}px).`
          );
        }
      }
    } catch {
      // File not found — not a local upload warning
    }
  }
  return warnings;
}

type RenderTrackingUpdate = {
  status?: "PENDING" | "PROCESSING" | "DONE" | "ERROR";
  pipeline?: string;
  stage?: string;
  statusDetail?: string | null;
  progress?: number;
  errorMsg?: string | null;
  runpodJobId?: string | null;
  pngUrl?: string | null;
  pdfUrl?: string | null;
  videoUrl?: string | null;
  startedAt?: Date;
  finishedAt?: Date | null;
  heartbeat?: boolean;
};

async function updateRenderTracking(renderId: string, update: RenderTrackingUpdate): Promise<void> {
  const data: Record<string, unknown> = {
    status: update.status,
    pipeline: update.pipeline,
    stage: update.stage,
    statusDetail: update.statusDetail,
    progress: update.progress,
    errorMsg: update.errorMsg,
    runpodJobId: update.runpodJobId,
    pngUrl: update.pngUrl,
    pdfUrl: update.pdfUrl,
    videoUrl: update.videoUrl,
    startedAt: update.startedAt,
    finishedAt: update.finishedAt,
  };

  if (update.heartbeat !== false) {
    data.lastHeartbeatAt = new Date();
  }

  await prisma.render.update({ where: { id: renderId }, data: data as Prisma.RenderUpdateInput });
}

async function failRender(renderId: string, message: string, pipeline?: string, stage = RENDER_STAGE.ERROR): Promise<void> {
  await updateRenderTracking(renderId, {
    status: "ERROR",
    pipeline,
    stage,
    statusDetail: message,
    errorMsg: message,
    progress: 1,
    finishedAt: new Date(),
  });
}

function getActiveVideoBlocks(
  templateJson: TemplateJSON,
  listingData: ListingData
): VideoBlock[] {
  const groupMap = new Map((templateJson.groups ?? []).map((group) => [group.id, group]));
  const declaredFieldKeys = new Set((templateJson.schema ?? []).map((field) => field.key));
  const visibleFieldKeys = getVisibleFieldKeys(templateJson.schema ?? [], templateJson.formSections ?? [], listingData);

  return templateJson.blocks
    .filter((block): block is VideoBlock => block.type === "video")
    .filter((block) => {
      if (block.binding && declaredFieldKeys.has(block.binding) && !visibleFieldKeys.has(block.binding)) {
        return false;
      }
      const group = block.groupId ? groupMap.get(block.groupId) : undefined;
      return isBlockVisibleForListing(block, listingData, group);
    })
    .map((block) => {
      const group = block.groupId ? groupMap.get(block.groupId) : undefined;
      return resolveBlockForListing(block, listingData, group);
    });
}

export async function startRenderGeneration(renderId: string): Promise<"accepted" | "already-processed" | "missing"> {
  const now = new Date();
  const startData: Prisma.RenderUpdateManyMutationInput = {
    status: "PROCESSING",
    stage: RENDER_STAGE.QUEUED,
    statusDetail: "Job accepté",
    progress: 0.02,
    startedAt: now,
    lastHeartbeatAt: now,
    finishedAt: null,
    errorMsg: null,
  };
  const started = await prisma.render.updateMany({
    where: { id: renderId, status: "PENDING" },
    data: startData,
  });

  if (started.count === 0) {
    const existing = await prisma.render.findUnique({ where: { id: renderId } });
    return existing ? "already-processed" : "missing";
  }

  generateRender(renderId).catch(async (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[generate] Render ${renderId} FAILED:`, err);
    await failRender(renderId, msg);
  });

  return "accepted";
}

export async function generateRender(renderId: string): Promise<void> {
  await updateRenderTracking(renderId, {
    stage: RENDER_STAGE.LOAD_RENDER,
    statusDetail: "Chargement du render",
    progress: 0.04,
  });

  // 1. Charger render + listing + template
  const render = await prisma.render.findUniqueOrThrow({ where: { id: renderId } });
  const listing = await prisma.listing.findUniqueOrThrow({ where: { id: render.listingId } });
  if (!render.templateId) {
    await failRender(renderId, "Template supprimé");
    return;
  }
  const template = await prisma.template.findUniqueOrThrow({ where: { id: render.templateId } });

  const templateJson = normalizeTemplateJSON(JSON.parse(template.jsonData) as TemplateJSON);
  const listingData = JSON.parse(listing.jsonData) as ListingData;
  // 2. Validation conformité (enrichissement auto)
  await updateRenderTracking(renderId, {
    stage: RENDER_STAGE.VALIDATE_LISTING,
    statusDetail: "Validation et enrichissement des données",
    progress: 0.08,
  });
  const { enrichedListing } = validateConformite(listingData);

  // ─── Branchement : vidéo (RunPod) vs image (Node.js) ─────────────────────
  const videoBlocks = getActiveVideoBlocks(templateJson, enrichedListing);
  console.log(
    `[generateRender] ${renderId} — activeVideoBlocks: ${videoBlocks.length}, USE_RUNPOD=${process.env.USE_RUNPOD}`
  );
  if (videoBlocks.length > 0) {
    await generateVideoRender(renderId, templateJson, enrichedListing, videoBlocks);
    return;
  }

  // 3. Collect image resolution warnings
  const warnings = await collectImageWarnings(templateJson, enrichedListing);
  if (warnings.length > 0) {
    console.warn(`[Renderer] ${renderId} — Avertissements résolution :`, warnings);
  }

  // 4. Build HTML (avec résolution des polices locales pour Puppeteer)
  await updateRenderTracking(renderId, {
    pipeline: RENDER_PIPELINE.IMAGE,
    stage: RENDER_STAGE.IMAGE_BUILD_HTML,
    statusDetail: "Construction du visuel HTML",
    progress: 0.2,
  });
  const publicBase = "file://" + path.join(process.cwd(), "public").replace(/\\/g, "/");
  const html = await buildHTML(templateJson, enrichedListing, { publicBase });

  const { canvas } = templateJson;
  const { width, height } = canvas;

  // Formats print → 3x (qualité ~300 DPI). Formats digitaux/vidéo → 1x (pixel-perfect).
  const PRINT_FORMATS: string[] = ["A4_PORTRAIT", "A3_LANDSCAPE"];
  const pngScaleFactor = PRINT_FORMATS.includes(canvas.format) ? 3 : 1;

  // 5. Créer dossier de sortie
  await mkdir(OUTPUT_DIR, { recursive: true });

  // 6. Générer PNG
  await updateRenderTracking(renderId, {
    pipeline: RENDER_PIPELINE.IMAGE,
    stage: RENDER_STAGE.IMAGE_RENDER_PNG,
    statusDetail: "Export PNG en cours",
    progress: 0.55,
  });
  const pngBuffer = await renderPNG(html, width, height, pngScaleFactor);
  const pngFilename = `${renderId}.png`;
  await writeFile(path.join(OUTPUT_DIR, pngFilename), pngBuffer);

  // 7. Générer PDF
  await updateRenderTracking(renderId, {
    pipeline: RENDER_PIPELINE.IMAGE,
    stage: RENDER_STAGE.IMAGE_RENDER_PDF,
    statusDetail: "Export PDF en cours",
    progress: 0.8,
  });
  const pdfBuffer = await renderPDF(html, canvas.format as CanvasFormat, width, height);
  const pdfFilename = `${renderId}.pdf`;
  await writeFile(path.join(OUTPUT_DIR, pdfFilename), pdfBuffer);

  // 8. Mettre à jour le render en DB (avec avertissements éventuels)
  await updateRenderTracking(renderId, {
    status: "DONE",
    pipeline: RENDER_PIPELINE.IMAGE,
    stage: RENDER_STAGE.DONE,
    statusDetail: "Visuel généré",
    progress: 1,
    pngUrl: `/renders/${pngFilename}`,
    pdfUrl: `/renders/${pdfFilename}`,
    errorMsg: warnings.length > 0
      ? `WARNINGS:${JSON.stringify(warnings)}`
      : null,
    finishedAt: new Date(),
  });
}

// ─── Pipeline vidéo (RunPod ou local) ────────────────────────────────────────

// ── Timed overlay helpers ──────────────────────────────────────────────────────

interface SegmentMeta {
  /** Index into the unique overlay states array (= position in overlay_paths list). */
  index: number;
  start: number;
  end: number | null;
}

interface OverlayPlan {
  /** Unique overlay states: each entry lists the block IDs to hide when rendering that PNG. */
  states: { hiddenBlockIds: string[] }[];
  segments: SegmentMeta[];
}

/**
 * Computes a timed overlay plan from template blocks.
 *
 * Returns `null` when no block has timing fields → single-overlay fast path,
 * 100% backward compatible with existing behaviour.
 */
function computeOverlayPlan(blocks: AnyBlock[]): OverlayPlan | null {
  const hasAnyTiming = blocks.some(
    (b) => (b.appearAt !== undefined && b.appearAt > 0) || b.hideAt !== undefined
  );
  if (!hasAnyTiming) return null;

  // Collect all time breakpoints
  const bpSet = new Set<number>([0]);
  for (const b of blocks) {
    if (b.appearAt !== undefined && b.appearAt > 0) bpSet.add(b.appearAt);
    if (b.hideAt !== undefined) bpSet.add(b.hideAt);
  }
  const breakpoints = Array.from(bpSet).sort((a, b) => a - b);

  // For each interval, determine which blocks are hidden
  const intervals: { start: number; end: number | null; hiddenBlockIds: string[] }[] = [];
  for (let i = 0; i < breakpoints.length; i++) {
    const intervalStart = breakpoints[i];
    const intervalEnd = i + 1 < breakpoints.length ? breakpoints[i + 1] : null;
    const hidden = blocks
      .filter((b) => {
        const ap = b.appearAt ?? 0;
        const hp = b.hideAt;
        return !(intervalStart >= ap && (hp === undefined || intervalStart < hp));
      })
      .map((b) => b.id);
    intervals.push({ start: intervalStart, end: intervalEnd, hiddenBlockIds: hidden });
  }

  // Deduplicate identical visibility states
  const stateKey = (ids: string[]) => JSON.stringify([...ids].sort());
  const stateMap = new Map<string, number>();
  const states: { hiddenBlockIds: string[] }[] = [];
  const rawSegments: SegmentMeta[] = [];

  for (const interval of intervals) {
    const key = stateKey(interval.hiddenBlockIds);
    let idx = stateMap.get(key);
    if (idx === undefined) {
      idx = states.length;
      states.push({ hiddenBlockIds: interval.hiddenBlockIds });
      stateMap.set(key, idx);
    }
    rawSegments.push({ index: idx, start: interval.start, end: interval.end });
  }

  // Merge consecutive segments that share the same overlay index
  const segments: SegmentMeta[] = [];
  for (const seg of rawSegments) {
    const last = segments[segments.length - 1];
    if (last && last.index === seg.index && last.end === seg.start) {
      segments[segments.length - 1] = { ...last, end: seg.end };
    } else {
      segments.push(seg);
    }
  }

  return { states, segments };
}

/** Resolves the first music block and its audio URL from the listing data. */
function resolveMusicConfig(
  templateJson: TemplateJSON,
  listingData: ListingData,
): { musicUrl: string; block: MusicBlock } | null {
  const musicBlock = templateJson.blocks.find(
    (b): b is MusicBlock => b.type === "music"
  );
  if (!musicBlock) return null;

  const musicUrl = musicBlock.binding
    ? (listingData as Record<string, unknown>)[musicBlock.binding] as string | undefined
    : undefined;
  if (!musicUrl) return null;

  return { musicUrl, block: musicBlock };
}

async function generateVideoRender(
  renderId: string,
  templateJson: TemplateJSON,
  listingData: ListingData,
  videoBlocks: VideoBlock[],
): Promise<void> {
  const useRunpod = process.env.USE_RUNPOD !== "false";
  if (!useRunpod) {
    await generateVideoRenderLocal(renderId, templateJson, listingData, videoBlocks);
    return;
  }
  const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
  const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;

  if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
    await failRender(
      renderId,
      "RunPod non configuré (RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID manquants)",
      RENDER_PIPELINE.VIDEO_RUNPOD
    );
    return;
  }
  if (!r2Configured()) {
    await failRender(renderId, "R2 non configuré — requis pour les renders vidéo", RENDER_PIPELINE.VIDEO_RUNPOD);
    return;
  }

  try {
    const { width, height } = templateJson.canvas;

    // 1. Rendre les overlay PNG(s)
    await updateRenderTracking(renderId, {
      pipeline: RENDER_PIPELINE.VIDEO_RUNPOD,
      stage: RENDER_STAGE.VIDEO_RENDER_OVERLAY,
      statusDetail: "Rendu de l'overlay vidéo",
      progress: 0.12,
    });

    const overlayPlan = computeOverlayPlan(templateJson.canvas.maxDuration !== undefined
      ? templateJson.blocks  // also consider maxDuration present
      : templateJson.blocks);

    let overlayBuffers: Buffer[];
    if (overlayPlan === null) {
      const html = await buildHTML(templateJson, listingData, { overlayMode: true });
      overlayBuffers = [await renderPNG(html, width, height, 1, true)];
    } else {
      overlayBuffers = await Promise.all(
        overlayPlan.states.map(async (state) => {
          const html = await buildHTML(templateJson, listingData, {
            overlayMode: true,
            hiddenBlockIds: state.hiddenBlockIds,
          });
          return renderPNG(html, width, height, 1, true);
        })
      );
    }

    // 2. Uploader les overlays vers R2
    await updateRenderTracking(renderId, {
      pipeline: RENDER_PIPELINE.VIDEO_RUNPOD,
      stage: RENDER_STAGE.VIDEO_UPLOAD_OVERLAY,
      statusDetail: "Upload de l'overlay vers R2",
      progress: 0.28,
    });
    const overlayUrls = await Promise.all(
      overlayBuffers.map((buf, i) =>
        uploadToR2(`overlays/${renderId}_${i}.png`, buf, "image/png").then((r) => r.url)
      )
    );

    // 3. Récupérer l'URL vidéo depuis le listing (premier bloc vidéo avec binding)
    await updateRenderTracking(renderId, {
      pipeline: RENDER_PIPELINE.VIDEO_RUNPOD,
      stage: RENDER_STAGE.VIDEO_RESOLVE_SOURCE,
      statusDetail: "Préparation de la vidéo source",
      progress: 0.38,
    });
    const videoBlock = videoBlocks[0];
    const videoUrl = videoBlock.binding
      ? (listingData as Record<string, unknown>)[videoBlock.binding] as string | undefined
      : undefined;

    if (!videoUrl) {
      throw new Error(
        `Bloc vidéo sans URL : renseigne la variable "${videoBlock.binding ?? "(pas de binding)"}" dans le formulaire`
      );
    }

    // Cadrage personnalisé (focal point défini par l'user dans le formulaire)
    const focalPoint = videoBlock.binding
      ? (listingData as Record<string, unknown>)[videoBlock.binding + "_focalpoint"] as { x: number; y: number } | null | undefined
      : null;
    const crop_x = focalPoint?.x ?? 0.5;
    const crop_y = focalPoint?.y ?? 0.5;

    // Resolve optional music block
    const music = resolveMusicConfig(templateJson, listingData);

    // 4. Soumettre le job RunPod
    await updateRenderTracking(renderId, {
      pipeline: RENDER_PIPELINE.VIDEO_RUNPOD,
      stage: RENDER_STAGE.VIDEO_SUBMIT_RUNPOD,
      statusDetail: "Soumission du job",
      progress: 0.5,
    });
    const outputKey = `renders/${renderId}.mp4`;
    const runpodData = await submitRunpodJob<{ id: string }>(
      RUNPOD_ENDPOINT_ID,
      RUNPOD_API_KEY,
      {
        input: {
          job_type: "render_template",
          export_profile: "template",
          // Single overlay (legacy) → overlay_url; timed → overlay_urls + overlay_segments
          ...(overlayPlan === null
            ? { overlay_url: overlayUrls[0] }
            : {
                overlay_urls: overlayUrls,
                overlay_segments: overlayPlan.segments,
              }),
          video_url: videoUrl,
          video_block: {
            x: videoBlock.x,
            y: videoBlock.y,
            w: videoBlock.w,
            h: videoBlock.h,
            fit: videoBlock.fit ?? "cover",
            crop_x,
            crop_y,
          },
          canvas: { width, height },
          ...(templateJson.canvas.maxDuration !== undefined && templateJson.canvas.maxDuration > 0
            ? { max_duration: templateJson.canvas.maxDuration }
            : {}),
          ...(videoBlock.mute ? { music_mute_source: true } : {}),
          ...(music ? {
            music_url: music.musicUrl,
            music_volume: music.block.volume ?? 0.3,
            music_source_volume: videoBlock.audioVolume ?? 1.0,
            music_mute_source: videoBlock.mute ?? false,
            music_loop: music.block.loop ?? false,
            music_fade_in: music.block.fadeIn ?? 0,
            music_fade_out: music.block.fadeOut ?? 0,
          } : {}),
          output_key: outputKey,
          render_id: renderId,
        },
      },
      { timeoutMs: RUNPOD_SUBMIT_TIMEOUT_MS }
    );

    // 5. Stocker le runpodJobId — le polling dans GET /api/renders/:id terminera le job
    await updateRenderTracking(renderId, {
      status: "PROCESSING",
      pipeline: RENDER_PIPELINE.VIDEO_RUNPOD,
      stage: RENDER_STAGE.VIDEO_RUNPOD_QUEUED,
      statusDetail: `Job RunPod soumis (${runpodData.id})`,
      progress: 0.6,
      runpodJobId: runpodData.id,
    });
  } catch (err) {
    await failRender(
      renderId,
      err instanceof Error ? err.message : "Erreur génération vidéo",
      RENDER_PIPELINE.VIDEO_RUNPOD
    );
  }
}
// ─── Pipeline vidéo LOCAL (sans RunPod) ──────────────────────────────────────

async function generateVideoRenderLocal(
  renderId: string,
  templateJson: TemplateJSON,
  listingData: ListingData,
  videoBlocks: VideoBlock[],
): Promise<void> {
  try {
    const { width, height } = templateJson.canvas;
    const CAPTIONS_API = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";
    console.log(`[videoLocal] ${renderId} — START canvas=${width}x${height} CAPTIONS_API=${CAPTIONS_API}`);

    // 1. Overlay PNG(s) transparent(s) — single ou multi selon les timings des blocs
    await updateRenderTracking(renderId, {
      pipeline: RENDER_PIPELINE.VIDEO_LOCAL,
      stage: RENDER_STAGE.VIDEO_RENDER_OVERLAY,
      statusDetail: "Rendu de l'overlay vidéo",
      progress: 0.12,
    });
    console.log(`[videoLocal] ${renderId} — step 1: buildHTML overlayMode`);

    const overlayPlan = computeOverlayPlan(templateJson.blocks);

    let overlayBuffers: Buffer[];
    if (overlayPlan === null) {
      // Fast path: single overlay (all blocks visible, identical to pre-timing behaviour)
      const html = await buildHTML(templateJson, listingData, { overlayMode: true });
      overlayBuffers = [await renderPNG(html, width, height, 1, true)];
      console.log(`[videoLocal] ${renderId} — single overlay PNG ready: ${overlayBuffers[0].length} bytes`);
    } else {
      // Timed path: one PNG per unique visibility state
      console.log(`[videoLocal] ${renderId} — timed overlay plan: ${overlayPlan.states.length} states, ${overlayPlan.segments.length} segments`);
      overlayBuffers = await Promise.all(
        overlayPlan.states.map(async (state, i) => {
          const html = await buildHTML(templateJson, listingData, {
            overlayMode: true,
            hiddenBlockIds: state.hiddenBlockIds,
          });
          const buf = await renderPNG(html, width, height, 1, true);
          console.log(`[videoLocal] ${renderId} — overlay state ${i} ready: ${buf.length} bytes (${state.hiddenBlockIds.length} hidden blocks)`);
          return buf;
        })
      );
    }

    // 2. Résoudre l'URL de la vidéo source
    await updateRenderTracking(renderId, {
      pipeline: RENDER_PIPELINE.VIDEO_LOCAL,
      stage: RENDER_STAGE.VIDEO_RESOLVE_SOURCE,
      statusDetail: "Préparation de la vidéo source",
      progress: 0.28,
    });
    const videoBlock = videoBlocks[0];
    const rawVideoUrl = videoBlock.binding
      ? (listingData as Record<string, unknown>)[videoBlock.binding] as string | undefined
      : undefined;

    if (!rawVideoUrl) {
      throw new Error(
        `Bloc vidéo sans URL : renseigne la variable "${videoBlock.binding ?? "(pas de binding)"}" dans le formulaire`
      );
    }
    console.log(`[generateRender] rawVideoUrl = "${rawVideoUrl}"`);

    // Cadrage personnalisé (focal point défini par l'user dans le formulaire)
    const focalPoint = videoBlock.binding
      ? (listingData as Record<string, unknown>)[videoBlock.binding + "_focalpoint"] as { x: number; y: number } | null | undefined
      : null;
    const crop_x = focalPoint?.x ?? 0.5;
    const crop_y = focalPoint?.y ?? 0.5;

    // Resolve optional music block
    const music = resolveMusicConfig(templateJson, listingData);

    // 3. Envoyer overlay(s) + vidéo à render-engine pour composite FFmpeg
    const form = new FormData();
    form.append("video_block", JSON.stringify({
      x: videoBlock.x, y: videoBlock.y, w: videoBlock.w, h: videoBlock.h,
      fit: videoBlock.fit ?? "cover",
      crop_x,
      crop_y,
    }));
    form.append("canvas_w", String(width));
    form.append("canvas_h", String(height));

    // Max duration (optional field from canvas config)
    if (templateJson.canvas.maxDuration !== undefined && templateJson.canvas.maxDuration > 0) {
      form.append("max_duration", String(templateJson.canvas.maxDuration));
    }

    // Video audio controls (always sent when non-default)
    if (videoBlock.mute) {
      form.append("music_mute_source", "true");
    }
    if ((videoBlock.audioVolume ?? 1) !== 1) {
      form.append("music_source_volume", String(videoBlock.audioVolume));
    }

    // Music params (optional — from music block)
    if (music) {
      form.append("music_url", music.musicUrl);
      form.append("music_volume", String(music.block.volume ?? 0.3));
      form.append("music_source_volume", String(videoBlock.audioVolume ?? 1.0));
      form.append("music_mute_source", String(videoBlock.mute ?? false));
      form.append("music_loop", String(music.block.loop ?? false));
      form.append("music_fade_in", String(music.block.fadeIn ?? 0));
      form.append("music_fade_out", String(music.block.fadeOut ?? 0));
    }

    if (overlayPlan === null) {
      // Legacy single-overlay path
      form.append("overlay", new Blob([new Uint8Array(overlayBuffers[0])], { type: "image/png" }), "overlay.png");
    } else {
      // Timed multi-overlay path
      for (let i = 0; i < overlayBuffers.length; i++) {
        form.append(`overlay_${i}`, new Blob([new Uint8Array(overlayBuffers[i])], { type: "image/png" }), `overlay_${i}.png`);
      }
      form.append("overlays_metadata", JSON.stringify(
        overlayPlan.segments.map((seg) => ({
          index: seg.index,
          start: seg.start,
          end: seg.end,
        }))
      ));
    }

    // Vidéo locale → envoyer en binaire (évite les problèmes DNS inter-containers Docker)
    // Vidéo distante (http/https) → envoyer l'URL
    if (rawVideoUrl.startsWith("/")) {
      const videoFilePath = path.join(process.cwd(), "public", rawVideoUrl);
      const videoBytes = await readFile(videoFilePath);
      console.log(`[videoLocal] ${renderId} — video local file: ${videoFilePath} — ${videoBytes.length} bytes`);
      if (videoBytes.length === 0) {
        throw new Error(`Fichier vidéo vide : ${videoFilePath}`);
      }
      form.append("video", new Blob([videoBytes], { type: "video/mp4" }), "video.mp4");
    } else {
      console.log(`[videoLocal] ${renderId} — video URL: ${rawVideoUrl}`);
      form.append("video_url", rawVideoUrl);
    }

    await updateRenderTracking(renderId, {
      pipeline: RENDER_PIPELINE.VIDEO_LOCAL,
      stage: RENDER_STAGE.VIDEO_LOCAL_SEND,
      statusDetail: "Envoi au render-engine",
      progress: 0.42,
    });
    console.log(`[videoLocal] ${renderId} — step 3: POST ${CAPTIONS_API}/api/render_template`);
    const res = await fetch(`${CAPTIONS_API}/api/render_template`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(LOCAL_VIDEO_RENDER_TIMEOUT_MS),
    });
    console.log(`[videoLocal] ${renderId} — render-engine responded: ${res.status}`);
    if (!res.ok) {
      throw new Error(`render-engine ${res.status}: ${await res.text()}`);
    }

    await updateRenderTracking(renderId, {
      pipeline: RENDER_PIPELINE.VIDEO_LOCAL,
      stage: RENDER_STAGE.VIDEO_LOCAL_COMPOSITING,
      statusDetail: "Composite vidéo local en cours",
      progress: 0.78,
    });
    console.log(`[videoLocal] ${renderId} — step 4: reading JSON response`);
    const data = await res.json() as { videoUrl?: string };
    if (!data.videoUrl) {
      throw new Error("render-engine n'a pas renvoyé d'URL vidéo")
    }
    const finalUrl = data.videoUrl.startsWith("http")
      ? data.videoUrl
      : `/api/captions${data.videoUrl.startsWith("/") ? data.videoUrl : `/${data.videoUrl}`}`;

    console.log(`[videoLocal] ${renderId} — DONE: ${finalUrl}`);
    await updateRenderTracking(renderId, {
      status: "DONE",
      pipeline: RENDER_PIPELINE.VIDEO_LOCAL,
      stage: RENDER_STAGE.DONE,
      statusDetail: "Vidéo générée localement",
      progress: 1,
      videoUrl: finalUrl,
      finishedAt: new Date(),
    });
  } catch (err) {
    console.error(`[videoLocal] ${renderId} — ERROR:`, err);
    await failRender(
      renderId,
      err instanceof Error ? err.message : "Erreur génération vidéo locale",
      RENDER_PIPELINE.VIDEO_LOCAL
    );
  }
}