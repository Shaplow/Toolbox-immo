import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { buildHTML } from "./buildHTML";
import { renderPNG } from "./renderPNG";
import { validateConformite } from "@/lib/validation/conformite";
import type { TemplateJSON, ImageBlock, VideoBlock, MusicBlock, AnyBlock, VideoSequenceSlot, TextBlock, SchemaField } from "@/types/template";
import type { ListingData } from "@/types/listing";
import { writeFile, mkdir, stat, readFile } from "fs/promises";
import path from "path";
import { uploadToR2, r2Configured, deleteFromR2 } from "@/lib/r2";
import { submitRunpodJob } from "@/lib/runpod";
import { getRunpodWebhookUrl } from "@/lib/webhooks/runpod";
import { normalizeTemplateJSON } from "@/lib/templateNormalization";
import { expandGroupIdsWithChildren } from "@/lib/groupLayout";
import { isBlockVisibleForListing, resolveBlockForListing } from "@/lib/templateConditions";
import { getVisibleFieldKeys } from "@/lib/formSections";
import { RENDER_PIPELINE, RENDER_STAGE } from "./renderWorkflow";
import { recordLibraryUsage, revertLibraryCursors } from "@/lib/recordLibraryUsage";
import { selectAndClaimMediaAsset, selectMediaAssetBySetSequence, selectMediaAssetByMetadataValue, normalizeRule } from "@/lib/contentLibraryResolver";
import { triggerAutoTranscriptionLocal } from "@/lib/triggerAutoTranscriptionLocal";
import { triggerAutoCoverPackForRender } from "@/lib/coverAuto";
import { onRenderCompleted } from "@/lib/services/slot/pipelineHooks";

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
    videoUrl: update.videoUrl,
    startedAt: update.startedAt,
    finishedAt: update.finishedAt,
  };

  if (update.heartbeat !== false) {
    data.lastHeartbeatAt = new Date();
  }

  try {
    await prisma.render.update({ where: { id: renderId }, data: data as Prisma.RenderUpdateInput });
  } catch (err) {
    // DB write failures are logged but must not swallow the pipeline error.
    // The caller's own error handling (failRender / catch block) takes precedence.
    console.error(`[updateRenderTracking] DB write failed for render=${renderId} stage=${update.stage}:`, err);
  }
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
  // Revert library cursors advanced at prefill time so the rotation slot is not
  // permanently consumed by a failed render. Best-effort, non-blocking.
  revertLibraryCursors(renderId).catch((err) => {
    console.error(`[failRender] revertLibraryCursors failed for render=${renderId}:`, err);
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
      return isBlockVisibleForListing(block, listingData, group, templateJson.groups);
    })
    .map((block) => {
      const group = block.groupId ? groupMap.get(block.groupId) : undefined;
      return resolveBlockForListing(block, listingData, group, templateJson.groups);
    });
}

/**
 * Filtre les slots de videoSequence qui ne peuvent rien résoudre dans le
 * contexte courant (ex : binding pointant vers un champ schema masqué par
 * showIf, sans libraryId de secours). Sans ça, un template "photo OU vidéo"
 * dont le slot vidéo a été auto-créé par ensureVideoSequence pousse le
 * pipeline en mode séquence même quand l'utilisateur a choisi "Photo" —
 * resolveSlotVideoUrl finit par échouer avec "aucune vidéo trouvée".
 */
function getActiveSequenceSlots(
  templateJson: TemplateJSON,
  listingData: ListingData,
): VideoSequenceSlot[] {
  const slots = templateJson.videoSequence ?? [];
  if (slots.length === 0) return [];
  const groupMap = new Map((templateJson.groups ?? []).map((group) => [group.id, group]));
  const declaredFieldKeys = new Set((templateJson.schema ?? []).map((field) => field.key));
  const visibleFieldKeys = getVisibleFieldKeys(templateJson.schema ?? [], templateJson.formSections ?? [], listingData);

  return slots.filter((slot) => {
    if (slot.libraryId) return true;
    if (slot.binding && declaredFieldKeys.has(slot.binding) && !visibleFieldKeys.has(slot.binding)) {
      return false;
    }
    if (slot.videoBlockId) {
      const block = templateJson.blocks.find((b) => b.id === slot.videoBlockId);
      if (block) {
        const group = block.groupId ? groupMap.get(block.groupId) : undefined;
        if (!isBlockVisibleForListing(block, listingData, group, templateJson.groups)) return false;
      }
    }
    return true;
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

  // ─── Branchement : vidéo (RunPod ou local) vs image (Node.js) ───────────
  // Chantier C1 — pipeline unifié : tout template avec un VideoBlock arrive
  // ici avec videoSequence non-vide (garanti par normalizeTemplateJSON +
  // migration des templates legacy via scripts/migrate-templates-to-
  // unified-sequence.ts). La branche pipeline single (generateVideoRender)
  // est dead code et supprimée en Phase 5 du chantier.
  const videoBlocks = getActiveVideoBlocks(templateJson, enrichedListing);
  const activeSequenceSlots = getActiveSequenceSlots(templateJson, enrichedListing);
  console.log(
    `[generateRender] ${renderId} — activeVideoBlocks: ${videoBlocks.length}, sequenceSlots: ${templateJson.videoSequence?.length ?? 0}, activeSequenceSlots: ${activeSequenceSlots.length}, USE_RUNPOD=${process.env.USE_RUNPOD}`
  );

  if (activeSequenceSlots.length > 0) {
    const effectiveTemplateJson: TemplateJSON = {
      ...templateJson,
      videoSequence: activeSequenceSlots,
    };
    await generateSequenceRender(renderId, effectiveTemplateJson, enrichedListing, render.accountId ?? null);
    return;
  }

  if (videoBlocks.length > 0) {
    // Filet de sécurité : templateJson devrait avoir une videoSequence après
    // normalizeTemplateJSON. Si on tombe ici c'est qu'un Template a un
    // VideoBlock mais pas de slot — état incohérent. Logue + fail explicite
    // pour qu'on s'en aperçoive en monitoring plutôt que de retomber
    // silencieusement sur le pipeline legacy.
    await failRender(
      renderId,
      "Template incohérent : un bloc vidéo existe mais aucun clip n'est défini dans la séquence. " +
        "Lance le script de migration `migrate-templates-to-unified-sequence` ou ajoute un clip dans le builder.",
    );
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

  // 7. Mettre à jour le render en DB (avec avertissements éventuels)
  await updateRenderTracking(renderId, {
    status: "DONE",
    pipeline: RENDER_PIPELINE.IMAGE,
    stage: RENDER_STAGE.DONE,
    statusDetail: "Visuel généré",
    progress: 1,
    pngUrl: `/renders/${pngFilename}`,
    errorMsg: warnings.length > 0
      ? `WARNINGS:${JSON.stringify(warnings)}`
      : null,
    finishedAt: new Date(),
  });

  // Enregistrer l'usage des assets de bibliothèque (best-effort)
  recordLibraryUsage(renderId).catch((err) =>
    console.error("[generateRender] recordLibraryUsage failed:", err)
  );

  // Parité webhook RunPod : log activity + auto-transition pipeline si le
  // render est rattaché à un PublicationSlot.
  await onRenderCompleted(renderId);
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
 * When `slotId` is provided, per-slot timing overrides (`block.slotTimings[slotId]`)
 * take priority over the global `appearAt`/`hideAt` fields.
 *
 * Returns `null` when no block has timing fields → single-overlay fast path,
 * 100% backward compatible with existing behaviour.
 */
function computeOverlayPlan(blocks: AnyBlock[], slotId?: string): OverlayPlan | null {
  // Resolve effective timing for a block (per-slot override takes priority)
  function timing(b: AnyBlock) {
    const ov = slotId ? b.slotTimings?.[slotId] : undefined;
    return {
      appearAt: ov?.appearAt ?? b.appearAt,
      hideAt: ov?.hideAt ?? b.hideAt,
    };
  }

  const hasAnyTiming = blocks.some((b) => {
    const { appearAt, hideAt } = timing(b);
    return (appearAt !== undefined && appearAt > 0) || hideAt !== undefined;
  });
  if (!hasAnyTiming) return null;

  // Collect all time breakpoints
  const bpSet = new Set<number>([0]);
  for (const b of blocks) {
    const { appearAt, hideAt } = timing(b);
    if (appearAt !== undefined && appearAt > 0) bpSet.add(appearAt);
    if (hideAt !== undefined) bpSet.add(hideAt);
  }
  const breakpoints = Array.from(bpSet).sort((a, b) => a - b);

  // For each interval, determine which blocks are hidden
  const intervals: { start: number; end: number | null; hiddenBlockIds: string[] }[] = [];
  for (let i = 0; i < breakpoints.length; i++) {
    const intervalStart = breakpoints[i];
    const intervalEnd = i + 1 < breakpoints.length ? breakpoints[i + 1] : null;
    const hidden = blocks
      .filter((b) => {
        const { appearAt, hideAt } = timing(b);
        const ap = appearAt ?? 0;
        const hp = hideAt;
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

/**
 * Resolves the first music block and its audio URL.
 *
 * Resolution order:
 *  1. Explicit binding in listingData (form field URL).
 *  2. Library resolution via musicBlock.libraryId + audioSelectionRule (no binding required).
 *
 * Returns null when no MusicBlock exists, no URL can be resolved, or the URL is
 * not a valid http/https URL (to prevent cryptic FFmpeg failures inside the worker).
 */
async function resolveMusicConfig(
  templateJson: TemplateJSON,
  listingData: ListingData,
  accountId: string | null,
  prefillAudioAssetId?: string | null,
): Promise<{ musicUrl: string; block: MusicBlock; assetId: string | null } | null> {
  const musicBlock = templateJson.blocks.find(
    (b): b is MusicBlock => b.type === "music"
  );
  if (!musicBlock) return null;

  // 1. Try explicit binding (form field)
  let rawMusicUrl: string | undefined = musicBlock.binding
    ? (listingData as Record<string, unknown>)[musicBlock.binding] as string | undefined
    : undefined;
  let audioAssetId: string | null = null;

  // 2. Use the audio asset committed at prefill time (before falling back to a fresh query).
  //    This guarantees the rendered audio matches what was resolved when the form opened and
  //    prevents double-advancing the cursor for theme_sequence audio libraries.
  if (!rawMusicUrl && prefillAudioAssetId && musicBlock.libraryId) {
    try {
      const assetRow = await prisma.mediaAsset.findUnique({
        where: { id: prefillAudioAssetId },
        select: { id: true, url: true },
      });
      if (assetRow) {
        rawMusicUrl = assetRow.url;
        audioAssetId = assetRow.id;
      }
    } catch { /* DB lookup failed — fall through to library selection */ }
  }

  // 3. Fall back to library resolution when no URL came from the form or prefill
  if (!rawMusicUrl && musicBlock.libraryId) {
    // Conservative upper-bound on output duration, used to reject too-short tracks.
    // We use the template's explicit caps (slot.maxDuration / canvas.maxDuration) rather
    // than probing assets — at render time the picked video assets are not yet known
    // here, so caps give a safe (often slightly over-) estimate. If no caps exist,
    // we skip the filter (degraded but matches pre-existing behaviour).
    let estimatedVideoDuration = 0;
    const seq = templateJson.videoSequence ?? [];
    if (seq.length > 0) {
      for (const slot of seq) {
        if (slot.maxDuration && slot.maxDuration > 0) {
          estimatedVideoDuration += slot.maxDuration;
        }
      }
    } else if (templateJson.canvas?.maxDuration && templateJson.canvas.maxDuration > 0) {
      estimatedVideoDuration = templateJson.canvas.maxDuration;
    }
    // minDuration from block definition takes priority; otherwise auto-derive from video duration
    // so a non-looping track is long enough to cover the full render.
    const audioMinDuration: number | undefined =
      musicBlock.minDuration != null && musicBlock.minDuration > 0
        ? musicBlock.minDuration
        : (!musicBlock.loop && estimatedVideoDuration > 0 ? estimatedVideoDuration : undefined);

    // Bug-hunter #3 (2026-06-01) — selectAndClaimMediaAsset au lieu de
     // selectMediaAsset : pose un lock atomique + claim immédiat pour
     // éviter qu'un render concurrent prenne le même asset audio en burn-once.
    const asset = await selectAndClaimMediaAsset(
      musicBlock.libraryId,
      musicBlock.audioSelectionRule,
      undefined,
      accountId ?? undefined,
      undefined,
      audioMinDuration,
    );
    if (asset) {
      rawMusicUrl = asset.url;
      audioAssetId = asset.id;
    }
  }

  if (!rawMusicUrl) return null;

  // Resolve relative paths (local uploads) to absolute URL so the render-engine
  // container can reach the file — same pattern as resolveVideoUrl.
  if (rawMusicUrl.startsWith("/")) {
    const base = (process.env.FONT_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
    rawMusicUrl = `${base}${rawMusicUrl}`;
  }

  // Validate that the URL is a reachable http/https URL before including it in
  // the RunPod payload. An unvalidated arbitrary string from listing data would
  // produce a cryptic FFmpeg download failure deep inside the worker.
  try {
    const parsed = new URL(rawMusicUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      console.warn(`[resolveMusicConfig] musicUrl has unsupported protocol "${parsed.protocol}" — skipping`);
      return null;
    }
  } catch {
    console.warn(`[resolveMusicConfig] musicUrl is not a valid URL: "${rawMusicUrl}" — skipping`);
    return null;
  }

  return { musicUrl: rawMusicUrl, block: musicBlock, assetId: audioAssetId };
}

/**
 * Charge `Render.usedAssets` et extrait videoAssets + audioAssetId — utilisé
 * pour préserver les choix prefill (POST /api/renders) lors du processing
 * effectif. Avant W3.6 ce bloc était dupliqué 4× dans generateRender.ts (sequence
 * RunPod, sequence Local, video RunPod, video Local) avec dérive silencieuse.
 *
 * Best-effort : un JSON corrompu ou un render absent retourne des maps vides
 * (la library selection downstream reprendra la main).
 */
async function loadPrefillAssets(
  renderId: string,
): Promise<{ videoAssets: Record<string, string>; audioAssetId: string | null }> {
  try {
    const renderRow = await prisma.render.findUnique({
      where: { id: renderId },
      select: { usedAssets: true },
    });
    const ua = JSON.parse(renderRow?.usedAssets ?? "{}") as {
      videoAssets?: Record<string, string>;
      audioAssetId?: string;
    };
    return {
      videoAssets: ua.videoAssets ?? {},
      audioAssetId: ua.audioAssetId ?? null,
    };
  } catch {
    return { videoAssets: {}, audioAssetId: null };
  }
}

/**
 * Merge `patch` dans `Render.usedAssets` en préservant les autres champs.
 * Avant W3.6 ce read-modify-write était inline 4-6× (mergeAudioAssetId,
 * mergeVideoAsset, et 2 blocs sequence inline). Sans helper, ajouter un
 * nouveau champ (ex: dataResolvedSetTag) imposait 4 éditions parallèles.
 *
 * Note : pas de transaction — c'est best-effort. Deux merges concurrents
 * peuvent silencieusement se marcher dessus, mais en pratique chaque merge
 * vient d'un site de pipeline distinct (audio / video / sequence) qui ne
 * tape pas les mêmes clés.
 */
async function mergeUsedAssets(
  renderId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  try {
    const render = await prisma.render.findUnique({
      where: { id: renderId },
      select: { usedAssets: true },
    });
    let stored: Record<string, unknown> = {};
    try { stored = JSON.parse(render?.usedAssets ?? "{}") as Record<string, unknown>; } catch { /* ignore */ }
    const merged = { ...stored, ...patch };
    await prisma.render.update({
      where: { id: renderId },
      data: { usedAssets: JSON.stringify(merged) },
    });
  } catch (err) {
    console.warn(`[mergeUsedAssets] failed for render ${renderId}:`, err);
  }
}

/**
 * Best-effort: merge audioAssetId into a render's stored usedAssets JSON.
 * Délègue à mergeUsedAssets (helper unifié W3.6).
 */
async function mergeAudioAssetId(renderId: string, assetId: string): Promise<void> {
  await mergeUsedAssets(renderId, { audioAssetId: assetId });
}

/**
 * Enriches listingData with values from asset metadata, for each SchemaField
 * that declares a `metadataSource` (libraryId + metadataKey).
 * Returns a shallow copy of listingData; original is not mutated.
 * Allows {{key}} variables in text blocks to resolve from asset metadata,
 * with full support for formatThousands / decimalSeparator via resolveTextTemplate.
 */
function enrichListingWithAssetMetadata(
  listingData: ListingData,
  schema: SchemaField[],
  assetMetadataByLibrary: Map<string, Record<string, string | number | null>>,
): ListingData {
  if (assetMetadataByLibrary.size === 0) return listingData;
  const fieldsWithSource = schema.filter((f) => f.metadataSource);
  if (fieldsWithSource.length === 0) return listingData;

  const patch: Record<string, unknown> = {};
  for (const field of fieldsWithSource) {
    const { libraryId, metadataKey } = field.metadataSource!;
    const meta = assetMetadataByLibrary.get(libraryId);
    if (!meta) continue;
    const value = meta[metadataKey];
    if (value === null || value === undefined) continue;
    // Only inject when the listingData doesn't already carry a value for this key
    // (form-supplied values take precedence over auto-resolved metadata).
    const existing = (listingData as Record<string, unknown>)[field.key];
    if (existing !== undefined && existing !== null && existing !== "") continue;
    patch[field.key] = value;
  }
  if (Object.keys(patch).length === 0) return listingData;
  return { ...listingData, ...patch } as ListingData;
}

/**
 * Patches TextBlocks that have `libraryMetadataRef` set, replacing their content with
 * the resolved metadata value from the asset library used in this render.
 * Returns a shallow-patched TemplateJSON; original is not mutated.
 * @deprecated Prefer metadataSource on SchemaField + enrichListingWithAssetMetadata.
 *             Kept for backward compat with templates created before this feature.
 */
function applyAssetMetadata(
  templateJson: TemplateJSON,
  assetMetadataByLibrary: Map<string, Record<string, string | number | null>>,
): TemplateJSON {
  if (assetMetadataByLibrary.size === 0) return templateJson;
  const hasRef = templateJson.blocks.some(
    (b) => b.type === "text" && !!(b as TextBlock).libraryMetadataRef,
  );
  if (!hasRef) return templateJson;
  return {
    ...templateJson,
    blocks: templateJson.blocks.map((block) => {
      if (block.type !== "text") return block;
      const tb = block as TextBlock;
      if (!tb.libraryMetadataRef) return block;
      const { libraryId, key } = tb.libraryMetadataRef;
      const meta = assetMetadataByLibrary.get(libraryId);
      if (!meta) return block;
      const value = meta[key];
      if (value === null || value === undefined) return block;
      const strValue = String(value);
      return { ...tb, content: strValue, contentSegments: [{ type: "text" as const, value: strValue }] };
    }),
  };
}

/**
 * Best-effort lookup: trouve l'asset MediaLibrary correspondant à une URL dans
 * la library donnée. Utilisé pour récupérer le `assetId` quand `videoUrl` a été
 * fourni via form binding (sélection manuelle) au lieu de la rotation auto.
 *
 * Sans ce mapping, `usedAssets.videoAssets[blockId]` reste vide, et coverAuto
 * tombe sur la vidéo finale (avec overlays) au lieu du clip de base.
 */
async function findAssetIdByUrl(libraryId: string, url: string): Promise<{ id: string; metadata: Record<string, string | number | null> } | null> {
  try {
    const asset = await prisma.mediaAsset.findFirst({
      where: { libraryId, url },
      select: { id: true, metadata: true },
    });
    if (!asset) return null;
    let metadata: Record<string, string | number | null> = {};
    try { metadata = JSON.parse(asset.metadata ?? "{}") as Record<string, string | number | null>; } catch { /* ignore */ }
    return { id: asset.id, metadata };
  } catch (err) {
    console.warn(`[findAssetIdByUrl] failed libraryId=${libraryId} url=${url}:`, err);
    return null;
  }
}

/**
 * Best-effort: add a video assetId to the render's usedAssets videoAssets map.
 * Called when a single VideoBlock.libraryId was used instead of a form binding.
 */
async function mergeVideoAsset(renderId: string, blockId: string, assetId: string): Promise<void> {
  // Délègue à mergeUsedAssets mais en préservant les autres clés de videoAssets.
  // Note : best-effort race avec un autre mergeVideoAsset concurrent — le 2e
  // patch écrase le 1er pour la même clé blockId. En pratique chaque block
  // génère un seul appel séquentiel.
  try {
    const render = await prisma.render.findUnique({
      where: { id: renderId },
      select: { usedAssets: true },
    });
    let stored: Record<string, unknown> = {};
    try { stored = JSON.parse(render?.usedAssets ?? "{}") as Record<string, unknown>; } catch { /* ignore */ }
    const videoAssets = ((stored.videoAssets ?? {}) as Record<string, string>);
    videoAssets[blockId] = assetId;
    await mergeUsedAssets(renderId, { videoAssets });
  } catch (err) {
    console.warn(`[mergeVideoAsset] failed for render ${renderId}:`, err);
  }
}

/**
 * Resolve a VideoBlock's asset, preferring metadata-driven selection when a SchemaField
 * of type "select" with optionsSource.type === "metadata-values-from-library" targets this block.
 *
 * Falls back to the standard selectMediaAsset rotation if no metadata-select is configured
 * or if the selected value is empty.
 */
async function resolveVideoBlockAsset(
  videoBlock: VideoBlock,
  schema: SchemaField[],
  listingData: ListingData,
  accountId: string | null,
): Promise<{ id: string; url: string; filename: string; metadata: Record<string, string | number | null> } | null> {
  // Check for a metadata-driven select field targeting this block
  const metaSelectField = schema.find(
    (f) =>
      f.type === "select" &&
      f.optionsSource?.type === "metadata-values-from-library" &&
      f.optionsSource.blockId === videoBlock.id &&
      f.optionsSource.libraryId &&
      f.optionsSource.metadataKey,
  );

  if (metaSelectField?.optionsSource?.type === "metadata-values-from-library") {
    const { libraryId, metadataKey } = metaSelectField.optionsSource;
    const selectedValue = (listingData as Record<string, unknown>)[metaSelectField.key];
    if (selectedValue && typeof selectedValue === "string" && selectedValue.trim() !== "" && libraryId && metadataKey) {
      const asset = await selectMediaAssetByMetadataValue(libraryId, metadataKey, selectedValue, accountId ?? undefined);
      if (asset) return asset;
      console.warn(`[resolveVideoBlockAsset] No asset found in library "${libraryId}" where ${metadataKey} = "${selectedValue}" — falling back to rotation`);
    }
  }

  // Standard rotation fallback
  if (!videoBlock.libraryId) return null;
  // Bug-hunter #3 (2026-06-01) — claim atomique pour la race burn-once.
  // Pass minDuration from the block definition to filter out assets that are too short.
  return selectAndClaimMediaAsset(videoBlock.libraryId, videoBlock.selectionRule, undefined, accountId ?? undefined, undefined, videoBlock.minDuration);
}

async function generateVideoRender(
  renderId: string,
  templateJson: TemplateJSON,
  listingData: ListingData,
  videoBlocks: VideoBlock[],
  accountId: string | null,
): Promise<void> {
  const useRunpod = process.env.USE_RUNPOD !== "false";
  if (!useRunpod) {
    await generateVideoRenderLocal(renderId, templateJson, listingData, videoBlocks, accountId);
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

  // Track uploaded overlay keys so we can clean them up if RunPod submit fails.
  let overlayKeys: string[] = [];

  try {
    const { width, height } = templateJson.canvas;

    // Load prefill asset IDs written at POST /api/renders from resolveLibraryPrefill.
    // Using these prevents re-querying the library at render time, which would
    // double-advance the rotation cursor and render different content than shown in the form.
    const { videoAssets: prefillVideoAssets, audioAssetId: prefillAudioAssetId } =
      await loadPrefillAssets(renderId);

    // 0. Résoudre l'URL vidéo en premier — nécessaire pour injecter les métadonnées dans l'overlay
    const videoBlock = videoBlocks[0];
    let videoUrl: string | undefined = videoBlock.binding
      ? (listingData as Record<string, unknown>)[videoBlock.binding] as string | undefined
      : undefined;
    let singleVideoAssetId: string | null = null;
    let singleVideoMetadata: Record<string, string | number | null> = {};

    if (!videoUrl) {
      // Prefer the prefill asset committed at form-open time over a fresh library query.
      const prefillId = videoBlock.id ? prefillVideoAssets[videoBlock.id] : undefined;
      if (prefillId) {
        try {
          const assetRow = await prisma.mediaAsset.findUnique({
            where: { id: prefillId },
            select: { id: true, url: true, filename: true, metadata: true },
          });
          if (assetRow) {
            videoUrl = assetRow.url;
            singleVideoAssetId = assetRow.id;
            try { singleVideoMetadata = JSON.parse(assetRow.metadata ?? "{}") as Record<string, string | number | null>; } catch { /* ignore */ }
          }
        } catch { /* DB lookup failed — fall through to library selection */ }
      }
    }

    if (!videoUrl) {
      const asset = await resolveVideoBlockAsset(videoBlock, templateJson.schema ?? [], listingData, accountId);
      if (asset) {
        videoUrl = asset.url;
        singleVideoAssetId = asset.id;
        singleVideoMetadata = asset.metadata;
      }
    }

    if (!videoUrl) {
      throw new Error(
        `Bloc vidéo sans URL : renseigne la variable "${videoBlock.binding ?? "(pas de binding)"}" dans le formulaire, ou configure une bibliothèque dans l'onglet Vidéo & Musique`
      );
    }

    // Si l'URL vient du form binding sans passer par la library auto-selection,
    // retrouver le MediaAsset matching pour que coverAuto extraie les frames du
    // clip de base (et non de la vidéo finale avec overlays).
    if (videoUrl && videoBlock.libraryId && !singleVideoAssetId) {
      const matched = await findAssetIdByUrl(videoBlock.libraryId, videoUrl);
      if (matched) {
        singleVideoAssetId = matched.id;
        singleVideoMetadata = matched.metadata;
      }
    }

    // Build patched template (backward compat: libraryMetadataRef on TextBlocks)
    // and enrich listingData with asset metadata values for {{variable}} substitution.
    const assetMetadataByLibrary = new Map<string, Record<string, string | number | null>>();
    if (videoBlock.libraryId && Object.keys(singleVideoMetadata).length > 0) {
      assetMetadataByLibrary.set(videoBlock.libraryId, singleVideoMetadata);
    }
    const patchedTemplate = applyAssetMetadata(templateJson, assetMetadataByLibrary);
    const enrichedListingData = enrichListingWithAssetMetadata(listingData, templateJson.schema, assetMetadataByLibrary);

    // 1. Rendre les overlay PNG(s)
    await updateRenderTracking(renderId, {
      pipeline: RENDER_PIPELINE.VIDEO_RUNPOD,
      stage: RENDER_STAGE.VIDEO_RENDER_OVERLAY,
      statusDetail: "Rendu de l'overlay vidéo",
      progress: 0.12,
    });

    // W5.4 : pré-filtre les blocs conditionally-hidden (isBlockVisibleForListing)
    // avant computeOverlayPlan. Sans ce filtre, un bloc avec timing fields qui
    // est aussi caché par condition contribuait des breakpoints et des states
    // overlay → PNG inutiles uploadés sur R2 (cost + bandwidth).
    const visibleBlocksForPlan = patchedTemplate.blocks.filter((b) =>
      isBlockVisibleForListing(b, enrichedListingData)
    );
    const overlayPlan = computeOverlayPlan(visibleBlocksForPlan);

    let overlayBuffers: Buffer[];
    if (overlayPlan === null) {
      const html = await buildHTML(patchedTemplate, enrichedListingData, { overlayMode: true });
      overlayBuffers = [await renderPNG(html, width, height, 1, true)];
    } else {
      overlayBuffers = await Promise.all(
        overlayPlan.states.map(async (state) => {
          const html = await buildHTML(patchedTemplate, enrichedListingData, {
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
    // Track keys for cleanup — assigned to the outer-scope let so the catch block can access them.
    overlayKeys = overlayBuffers.map((_, i) => `overlays/${renderId}_${i}.png`);
    const overlayUrls = await Promise.all(
      overlayBuffers.map((buf, i) =>
        uploadToR2(overlayKeys[i], buf, "image/png").then((r) => r.url)
      )
    );

    // 3. Récupérer les paramètres complémentaires de la vidéo source
    await updateRenderTracking(renderId, {
      pipeline: RENDER_PIPELINE.VIDEO_RUNPOD,
      stage: RENDER_STAGE.VIDEO_RESOLVE_SOURCE,
      statusDetail: "Préparation de la vidéo source",
      progress: 0.38,
    });

    // Cadrage personnalisé (focal point défini par l'user dans le formulaire)
    const focalPoint = videoBlock.binding
      ? (listingData as Record<string, unknown>)[videoBlock.binding + "_focalpoint"] as { x: number; y: number } | null | undefined
      : null;
    const crop_x = focalPoint?.x ?? 0.5;
    const crop_y = focalPoint?.y ?? 0.5;

    // Resolve optional music block
    const music = await resolveMusicConfig(templateJson, listingData, accountId, prefillAudioAssetId);
    if (music?.assetId) await mergeAudioAssetId(renderId, music.assetId);

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
        ...(() => {
          const webhookUrl = getRunpodWebhookUrl("/api/webhooks/runpod/renders");
          return webhookUrl ? { webhook: webhookUrl } : {};
        })(),
      },
      { timeoutMs: RUNPOD_SUBMIT_TIMEOUT_MS }
    );

    // 5. Stocker le runpodJobId — le webhook /api/webhooks/runpod/renders terminera le job
    if (singleVideoAssetId) await mergeVideoAsset(renderId, videoBlock.id, singleVideoAssetId);
    await updateRenderTracking(renderId, {
      status: "PROCESSING",
      pipeline: RENDER_PIPELINE.VIDEO_RUNPOD,
      stage: RENDER_STAGE.VIDEO_RUNPOD_QUEUED,
      statusDetail: `Job RunPod soumis (${runpodData.id})`,
      progress: 0.6,
      runpodJobId: runpodData.id,
    });
  } catch (err) {
    // Clean up any overlay files that were uploaded to R2 before the failure.
    if (overlayKeys.length > 0) {
      await Promise.allSettled(overlayKeys.map((k) => deleteFromR2(k).catch((e) => {
        console.warn(`[generateVideoRender] R2 cleanup failed for key=${k}:`, e);
      })));
    }
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
  accountId: string | null,
): Promise<void> {
  try {
    const { width, height } = templateJson.canvas;
    const CAPTIONS_API = process.env.CAPTIONS_API_URL ?? (() => {
      console.warn("[generateRender] CAPTIONS_API_URL non configuré — fallback localhost:8000 (ne pas utiliser en production)");
      return "http://localhost:8000";
    })();
    console.log(`[videoLocal] ${renderId} — START canvas=${width}x${height} CAPTIONS_API=${CAPTIONS_API}`);

    // Load prefill asset IDs written at POST /api/renders from resolveLibraryPrefill.
    // Using these prevents re-querying the library at render time, which would
    // double-advance the rotation cursor and render different content than shown in the form.
    const { videoAssets: prefillVideoAssets, audioAssetId: prefillAudioAssetId } =
      await loadPrefillAssets(renderId);

    // 0. Résoudre l'URL vidéo en premier — nécessaire pour injecter les métadonnées dans l'overlay
    const videoBlock = videoBlocks[0];
    let rawVideoUrl: string | undefined = videoBlock.binding
      ? (listingData as Record<string, unknown>)[videoBlock.binding] as string | undefined
      : undefined;
    let singleVideoAssetId: string | null = null;
    let singleVideoMetadata: Record<string, string | number | null> = {};

    if (!rawVideoUrl) {
      // Prefer the prefill asset committed at form-open time over a fresh library query.
      const prefillId = videoBlock.id ? prefillVideoAssets[videoBlock.id] : undefined;
      if (prefillId) {
        try {
          const assetRow = await prisma.mediaAsset.findUnique({
            where: { id: prefillId },
            select: { id: true, url: true, filename: true, metadata: true },
          });
          if (assetRow) {
            rawVideoUrl = assetRow.url;
            singleVideoAssetId = assetRow.id;
            try { singleVideoMetadata = JSON.parse(assetRow.metadata ?? "{}") as Record<string, string | number | null>; } catch { /* ignore */ }
          }
        } catch { /* DB lookup failed — fall through to library selection */ }
      }
    }

    if (!rawVideoUrl) {
      const asset = await resolveVideoBlockAsset(videoBlock, templateJson.schema ?? [], listingData, accountId);
      if (asset) {
        rawVideoUrl = asset.url;
        singleVideoAssetId = asset.id;
        singleVideoMetadata = asset.metadata;
      }
    }

    // Si l'URL vient du form binding sans assetId, retrouver le MediaAsset
    // pour que coverAuto puisse extraire les frames du clip de base.
    if (rawVideoUrl && videoBlock.libraryId && !singleVideoAssetId) {
      const matched = await findAssetIdByUrl(videoBlock.libraryId, rawVideoUrl);
      if (matched) {
        singleVideoAssetId = matched.id;
        singleVideoMetadata = matched.metadata;
      }
    }

    if (!rawVideoUrl) {
      throw new Error(
        `Bloc vidéo sans URL : renseigne la variable "${videoBlock.binding ?? "(pas de binding)"}" dans le formulaire, ou configure une bibliothèque dans l'onglet Vidéo & Musique`
      );
    }
    console.log(`[generateRender] rawVideoUrl = "${rawVideoUrl}"`);

    // Build patched template (backward compat: libraryMetadataRef on TextBlocks)
    // and enrich listingData with asset metadata values for {{variable}} substitution.
    const assetMetadataByLibrary = new Map<string, Record<string, string | number | null>>();
    if (videoBlock.libraryId && Object.keys(singleVideoMetadata).length > 0) {
      assetMetadataByLibrary.set(videoBlock.libraryId, singleVideoMetadata);
    }
    const patchedTemplate = applyAssetMetadata(templateJson, assetMetadataByLibrary);
    const enrichedListingData = enrichListingWithAssetMetadata(listingData, templateJson.schema, assetMetadataByLibrary);

    // 1. Overlay PNG(s) transparent(s) — single ou multi selon les timings des blocs
    await updateRenderTracking(renderId, {
      pipeline: RENDER_PIPELINE.VIDEO_LOCAL,
      stage: RENDER_STAGE.VIDEO_RENDER_OVERLAY,
      statusDetail: "Rendu de l'overlay vidéo",
      progress: 0.12,
    });
    console.log(`[videoLocal] ${renderId} — step 1: buildHTML overlayMode`);

    // W5.4 : pré-filtre conditional-hidden blocks (cf. videoRender RunPod).
    const visibleBlocksForPlan = patchedTemplate.blocks.filter((b) =>
      isBlockVisibleForListing(b, enrichedListingData)
    );
    const overlayPlan = computeOverlayPlan(visibleBlocksForPlan);

    let overlayBuffers: Buffer[];
    if (overlayPlan === null) {
      // Fast path: single overlay (all blocks visible, identical to pre-timing behaviour)
      const html = await buildHTML(patchedTemplate, enrichedListingData, { overlayMode: true });
      overlayBuffers = [await renderPNG(html, width, height, 1, true)];
      console.log(`[videoLocal] ${renderId} — single overlay PNG ready: ${overlayBuffers[0].length} bytes`);
    } else {
      // Timed path: one PNG per unique visibility state
      console.log(`[videoLocal] ${renderId} — timed overlay plan: ${overlayPlan.states.length} states, ${overlayPlan.segments.length} segments`);
      overlayBuffers = await Promise.all(
        overlayPlan.states.map(async (state, i) => {
          const html = await buildHTML(patchedTemplate, enrichedListingData, {
            overlayMode: true,
            hiddenBlockIds: state.hiddenBlockIds,
          });
          const buf = await renderPNG(html, width, height, 1, true);
          console.log(`[videoLocal] ${renderId} — overlay state ${i} ready: ${buf.length} bytes (${state.hiddenBlockIds.length} hidden blocks)`);
          return buf;
        })
      );
    }

    // 2. Paramètres de cadrage
    await updateRenderTracking(renderId, {
      pipeline: RENDER_PIPELINE.VIDEO_LOCAL,
      stage: RENDER_STAGE.VIDEO_RESOLVE_SOURCE,
      statusDetail: "Préparation de la vidéo source",
      progress: 0.28,
    });

    // Cadrage personnalisé (focal point défini par l'user dans le formulaire)
    const focalPoint = videoBlock.binding
      ? (listingData as Record<string, unknown>)[videoBlock.binding + "_focalpoint"] as { x: number; y: number } | null | undefined
      : null;
    const crop_x = focalPoint?.x ?? 0.5;
    const crop_y = focalPoint?.y ?? 0.5;

    // Resolve optional music block
    const music = await resolveMusicConfig(templateJson, listingData, accountId, prefillAudioAssetId);
    if (music?.assetId) await mergeAudioAssetId(renderId, music.assetId);

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
    if (singleVideoAssetId) await mergeVideoAsset(renderId, videoBlock.id, singleVideoAssetId);
    await updateRenderTracking(renderId, {
      status: "DONE",
      pipeline: RENDER_PIPELINE.VIDEO_LOCAL,
      stage: RENDER_STAGE.DONE,
      statusDetail: "Vidéo générée localement",
      progress: 1,
      videoUrl: finalUrl,
      finishedAt: new Date(),
    });

    // Enregistrer l'usage des assets de bibliothèque (best-effort)
    recordLibraryUsage(renderId).catch((err) =>
      console.error("[generateRender] recordLibraryUsage failed:", err)
    );

    // Parité webhook RunPod : log activity + auto-transition pipeline.
    await onRenderCompleted(renderId);

    // Auto-sous-titrage local (captionAutoConfig.enabled) — best-effort
    const rawVideoPath = data.videoUrl.startsWith("http") ? null : data.videoUrl;
    if (rawVideoPath) {
      void triggerAutoTranscriptionLocal(renderId, CAPTIONS_API, rawVideoPath).catch((err) =>
        console.error(`[videoLocal] triggerAutoTranscriptionLocal threw: ${String(err)}`)
      );
      const autoCoverRender = await prisma.render.findUnique({
        where: { id: renderId },
        select: { templateId: true, listing: { select: { userId: true } } },
      });
      if (autoCoverRender?.listing.userId) {
        void triggerAutoCoverPackForRender(
          renderId,
          autoCoverRender.templateId,
          `${CAPTIONS_API}${rawVideoPath}`,
          autoCoverRender.listing.userId,
        ).catch((err) =>
          console.error(`[videoLocal] triggerAutoCoverPackForRender threw: ${String(err)}`)
        );
      }
    }
  } catch (err) {
    console.error(`[videoLocal] ${renderId} — ERROR:`, err);
    await failRender(
      renderId,
      err instanceof Error ? err.message : "Erreur génération vidéo locale",
      RENDER_PIPELINE.VIDEO_LOCAL
    );
  }
}

// ─── Pipeline séquence (multi-clip : intro → contenu → outro) ────────────────

/**
 * Résout l'URL vidéo pour un slot de séquence.
 * Priorité :
 *  1. listingData[binding] — override manuel dans le formulaire
 *  2. Sélection metadata-driven via slot.videoBlockId + optionsSource select field
 *  3. Résolution standard depuis la bibliothèque (theme_sequence ou rotation)
 *
 * pinnedSetTag / pinnedCategory : si plusieurs slots partagent la même bibliothèque
 * en mode theme_sequence, le 2ème slot (et suivants) reçoit le setTag/category déjà
 * sélectionné par le 1er slot afin de rester dans le même groupe (intro/outro).
 */
async function resolveSlotVideoUrl(
  slot: VideoSequenceSlot,
  listingData: ListingData,
  accountId: string | null,
  schema: SchemaField[],
  pinnedSetTag?: string,
  pinnedCategory?: string,
  prefillAssetId?: string | null,
  /** Durée minimale requise pour l'asset (s). Héritée du VideoBlock.minDuration ou slot.maxDuration. */
  minDuration?: number,
): Promise<{ url: string; assetId: string | null; resolvedSetTag: string | null; resolvedCategory: string | null; metadata: Record<string, string | number | null> }> {
  // 1. Binding explicite dans les données du formulaire
  if (slot.binding) {
    const raw = (listingData as Record<string, unknown>)[slot.binding] as string | undefined;
    if (raw && (raw.startsWith("http") || raw.startsWith("/"))) {
      return { url: raw, assetId: null, resolvedSetTag: null, resolvedCategory: null, metadata: {} };
    }
  }

  // 2. Sélection metadata-driven : slot.videoBlockId lié à un select field optionsSource
  if (slot.videoBlockId && slot.libraryId) {
    const metaSelectField = schema.find(
      (f) =>
        f.type === "select" &&
        f.optionsSource?.type === "metadata-values-from-library" &&
        f.optionsSource.blockId === slot.videoBlockId &&
        f.optionsSource.libraryId &&
        f.optionsSource.metadataKey,
    );
    if (metaSelectField?.optionsSource?.type === "metadata-values-from-library") {
      const { libraryId: metaLibId, metadataKey } = metaSelectField.optionsSource;
      const selectedValue = (listingData as Record<string, unknown>)[metaSelectField.key];
      if (selectedValue && typeof selectedValue === "string" && selectedValue.trim()) {
        const asset = await selectMediaAssetByMetadataValue(metaLibId!, metadataKey!, selectedValue.trim(), accountId ?? undefined);
        if (asset) {
          return {
            url: asset.url,
            assetId: asset.id,
            resolvedSetTag: asset.setTag ?? null,
            resolvedCategory: asset.category ?? null,
            metadata: asset.metadata as Record<string, string | number | null>,
          };
        }
        console.warn(
          `[resolveSlotVideoUrl] slot="${slot.id}" metadata lookup found no match ` +
          `(field="${metaSelectField.key}", value="${selectedValue}") — falling back to library selection`,
        );
      }
    }
  }

  // 3. Prefill asset — use the asset chosen at prefill time rather than re-querying the
  //    library. This guarantees the rendered video matches what was shown in the form and
  //    prevents double-advancing the cursor (or lastUsedCategory) for theme_sequence libraries.
  //    Only applies when no higher-priority path (binding or metadata-driven) has already
  //    resolved a URL. The pinnedSetTag is NOT checked here because the pinned set is derived
  //    from the first slot's prefill asset — subsequent slots in the same library receive the
  //    correct prefill asset from their own prefillAssetId entry.
  if (prefillAssetId) {
    try {
      const assetRow = await prisma.mediaAsset.findUnique({
        where: { id: prefillAssetId },
        select: { id: true, url: true, filename: true, setTag: true, category: true, metadata: true },
      });
      if (assetRow) {
        let metadata: Record<string, string | number | null> = {};
        try { metadata = JSON.parse(assetRow.metadata ?? "{}") as Record<string, string | number | null>; } catch { /* non-critical */ }
        return {
          url: assetRow.url,
          assetId: assetRow.id,
          resolvedSetTag: assetRow.setTag ?? null,
          resolvedCategory: assetRow.category ?? null,
          metadata,
        };
      }
    } catch { /* DB lookup failed — fall through to library selection */ }
  }

  // 4. Résolution serveur depuis la bibliothèque
  if (slot.libraryId) {
    const rule = slot.selectionRule;
    const ruleConfig = normalizeRule(rule);
    const strategy = ruleConfig.strategy;

    if (strategy === "theme_sequence") {
      // Phase 4 : passe slot.maxDuration comme minimum requis pour l'asset.
      const slotMinDuration = slot.maxDuration && slot.maxDuration > 0 ? slot.maxDuration : undefined;
      const asset = await selectMediaAssetBySetSequence(
        slot.libraryId,
        accountId ?? undefined,
        undefined,
        pinnedSetTag,
        pinnedCategory,
        ruleConfig,
        undefined,  // cursorAccountId
        false,      // readOnly (claim au submit comme avant)
        slotMinDuration,
      );
      if (asset) {
        // selectMediaAssetBySetSequence doesn't yet return metadata — fetch it separately
        let metadata: Record<string, string | number | null> = {};
        try {
          const assetRow = await prisma.mediaAsset.findUnique({ where: { id: asset.id }, select: { metadata: true } });
          if (assetRow?.metadata) metadata = JSON.parse(assetRow.metadata) as Record<string, string | number | null>;
        } catch { /* non-critical */ }
        return {
          url: asset.url,
          assetId: asset.id,
          resolvedSetTag: asset.resolvedSetTag,
          resolvedCategory: asset.resolvedCategory,
          metadata,
        };
      }
    } else {
      // Bug-hunter #3 (2026-06-01) — claim atomique pour la race burn-once sur slot vidéo.
      // Pass minDuration (from VideoBlock.minDuration or slot.maxDuration) to filter short assets.
      const asset = await selectAndClaimMediaAsset(slot.libraryId, rule, undefined, accountId ?? undefined, undefined, minDuration);
      if (asset) {
        return { url: asset.url, assetId: asset.id, resolvedSetTag: null, resolvedCategory: null, metadata: asset.metadata };
      }
    }
  }

  throw new Error(
    `Slot "${slot.id}" : aucune vidéo trouvée (binding="${slot.binding ?? "—"}", libraryId="${slot.libraryId ?? "—"}")`
  );
}

/**
 * Resolves the VideoBlock to use for a slot's position/crop params in the FFmpeg composite.
 *
 * Priority:
 *  1. `slot.videoBlockId` — explicit link set by the builder.
 *  2. A VideoBlock whose `binding` matches `slot.binding` (form-sourced slots).
 *  3. Full-canvas cover (library slots with no explicit block configured).
 */
function videoBlockForSlot(
  slot: VideoSequenceSlot,
  blocks: AnyBlock[],
  canvasW: number,
  canvasH: number,
): { x: number; y: number; w: number; h: number; fit: string } {
  const vb =
    (slot.videoBlockId ? blocks.find((b) => b.type === "video" && b.id === slot.videoBlockId) : undefined) ??
    (slot.binding ? blocks.find((b) => b.type === "video" && b.binding === slot.binding) : undefined);
  return vb
    ? { x: vb.x, y: vb.y, w: vb.w, h: vb.h, fit: (vb as VideoBlock).fit ?? "cover" }
    : { x: 0, y: 0, w: canvasW, h: canvasH, fit: "cover" };
}

/**
 * Returns the audio params for a slot's source video.
 * Reads from the resolved VideoBlock (via videoBlockId or binding match).
 */
function slotSourceAudioParams(
  slot: VideoSequenceSlot,
  blocks: AnyBlock[],
): { music_source_volume: number; music_mute_source: boolean } {
  const vb =
    (slot.videoBlockId ? blocks.find((b) => b.type === "video" && b.id === slot.videoBlockId) : undefined) ??
    (slot.binding ? blocks.find((b) => b.type === "video" && b.binding === slot.binding) : undefined);
  if (!vb) return { music_source_volume: 1.0, music_mute_source: false };
  const vBlock = vb as VideoBlock;
  return {
    music_source_volume: vBlock.audioVolume ?? 1.0,
    music_mute_source: vBlock.mute ?? false,
  };
}

/**
 * Accumulates set-sequence tracking data from a resolved slot into the tracking maps.
 * Extracted to deduplicate identical logic between RunPod and local pipelines.
 */
function accumulateSlotTracking(
  slot: VideoSequenceSlot,
  resolved: { assetId: string | null; resolvedSetTag: string | null; resolvedCategory: string | null },
  setSequencedLibraryIds: string[],
  usedSetTagByLibrary: Record<string, string>,
  usedCategoryByLibrary: Record<string, string>,
  sequenceSlotAssets: Record<string, string>,
) {
  if (resolved.assetId) sequenceSlotAssets[slot.id] = resolved.assetId;
  if (slot.libraryId && normalizeRule(slot.selectionRule).strategy === "theme_sequence") {
    if (!setSequencedLibraryIds.includes(slot.libraryId)) {
      setSequencedLibraryIds.push(slot.libraryId);
    }
    if (resolved.resolvedSetTag) usedSetTagByLibrary[slot.libraryId] = resolved.resolvedSetTag;
    if (resolved.resolvedCategory) usedCategoryByLibrary[slot.libraryId] = resolved.resolvedCategory;
  }
}

// ── Slot overlay result type ──────────────────────────────────────────────────

interface SlotOverlayResult {
  /** Rendered PNG buffer(s). Index matches OverlayPlan.states. null = no overlay at all. */
  buffers: (Buffer | null)[];
  /** null = single overlay (buffers[0]); non-null = timed, use plan.segments for timing. */
  plan: OverlayPlan | null;
}

/**
 * Renders overlay PNG(s) for a slot, respecting:
 *  - overlayGroupIds visibility filter
 *  - per-slot block timing (slotTimings / global appearAt / hideAt)
 *
 * Returns a SlotOverlayResult:
 *  - `{ buffers: [null], plan: null }` → no overlay (overlayGroupIds: [])
 *  - `{ buffers: [buf], plan: null }` → single overlay (no timed visibility in this slot)
 *  - `{ buffers: [buf0, buf1, ...], plan }` → timed overlays
 */
async function renderSlotOverlay(
  templateJson: TemplateJSON,
  listingData: ListingData,
  slot: VideoSequenceSlot,
  width: number,
  height: number,
): Promise<SlotOverlayResult> {
  if (Array.isArray(slot.overlayGroupIds) && slot.overlayGroupIds.length === 0) {
    return { buffers: [null], plan: null };
  }

  // Compute which blocks are hidden by the group filter for this slot.
  // expandGroupIdsWithChildren : cocher un groupe parent inclut ses sous-groupes
  // (block.groupId pointe vers le groupe feuille, cf. groupLayout.ts).
  let baseHiddenByGroup: string[] = [];
  if (slot.overlayGroupIds !== undefined) {
    const allowedGroupIds = expandGroupIdsWithChildren(slot.overlayGroupIds, templateJson.groups ?? []);
    baseHiddenByGroup = templateJson.blocks
      .filter((b) => !b.groupId || !allowedGroupIds.has(b.groupId))
      .map((b) => b.id);
  }

  // Check for timed visibility within this slot (respects slotTimings[slot.id])
  const plan = computeOverlayPlan(templateJson.blocks, slot.id);

  if (plan === null) {
    // Fast path: single overlay
    const html = await buildHTML(templateJson, listingData, {
      overlayMode: true,
      hiddenBlockIds: baseHiddenByGroup,
    });
    return { buffers: [await renderPNG(html, width, height, 1, true)], plan: null };
  }

  // Timed path: one PNG per unique visibility state, merged with group filter
  const buffers = await Promise.all(
    plan.states.map(async (state) => {
      const hidden = [...new Set([...baseHiddenByGroup, ...state.hiddenBlockIds])];
      const html = await buildHTML(templateJson, listingData, {
        overlayMode: true,
        hiddenBlockIds: hidden,
      });
      return renderPNG(html, width, height, 1, true);
    })
  );
  return { buffers, plan };
}

async function generateSequenceRender(
  renderId: string,
  templateJson: TemplateJSON,
  listingData: ListingData,
  accountId: string | null,
): Promise<void> {
  const useRunpod = process.env.USE_RUNPOD !== "false";
  if (!useRunpod) {
    await generateSequenceRenderLocal(renderId, templateJson, listingData, accountId);
    return;
  }

  const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
  const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;
  if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
    await failRender(renderId, "RunPod non configuré (RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID manquants)", RENDER_PIPELINE.SEQUENCE_RUNPOD);
    return;
  }
  if (!r2Configured()) {
    await failRender(renderId, "R2 non configuré — requis pour les renders séquence", RENDER_PIPELINE.SEQUENCE_RUNPOD);
    return;
  }

  const slots = templateJson.videoSequence!;
  const { width, height } = templateJson.canvas;

  // Track overlay R2 keys for cleanup on failure
  const overlayKeys: string[] = [];
  // Track set-sequence libraries for cursor advancement
  const setSequencedLibraryIds: string[] = [];
  const usedSetTagByLibrary: Record<string, string> = {};
  const usedCategoryByLibrary: Record<string, string> = {};
  const sequenceSlotAssets: Record<string, string> = {};

  try {
    // Load prefill asset IDs written at POST /api/renders from resolveLibraryPrefill.
    // Using these prevents re-querying the library at render time, which would
    // double-advance the rotation cursor and render different content than shown in the form.
    const { videoAssets: prefillVideoAssets, audioAssetId: prefillAudioAssetId } =
      await loadPrefillAssets(renderId);

    // 1. Résoudre les URLs vidéo de chaque slot
    await updateRenderTracking(renderId, {
      pipeline: RENDER_PIPELINE.SEQUENCE_RUNPOD,
      stage: RENDER_STAGE.SEQ_RESOLVE_SLOTS,
      statusDetail: "Résolution des clips de la séquence",
      progress: 0.08,
    });

    // Résolution séquentielle pour propager le pinnedSetTag entre slots d'une même bibliothèque
    // (ex : intro → outro dans la même prise doivent rester dans le même set).
    const localPinnedSetTagByLibrary: Record<string, string> = {};
    const localPinnedCategoryByLibrary: Record<string, string> = {};
    const resolvedSlots: { slot: VideoSequenceSlot; videoUrl: string; metadata: Record<string, string | number | null> }[] = [];
    const allBlocks = templateJson.blocks ?? [];
    for (const slot of slots) {
      const pinnedSetTag = slot.libraryId ? localPinnedSetTagByLibrary[slot.libraryId] : undefined;
      const pinnedCategory = slot.libraryId ? localPinnedCategoryByLibrary[slot.libraryId] : undefined;
      // Resolve minDuration from the linked VideoBlock (by videoBlockId or binding),
      // falling back to slot.maxDuration so that the asset covers at least the slot's required duration.
      const linkedVideoBlock = slot.videoBlockId
        ? allBlocks.find((b) => b.type === "video" && b.id === slot.videoBlockId) as VideoBlock | undefined
        : slot.binding
          ? allBlocks.find((b) => b.type === "video" && b.binding === slot.binding) as VideoBlock | undefined
          : undefined;
      const slotMinDuration: number | undefined = linkedVideoBlock?.minDuration ?? (slot.maxDuration && slot.maxDuration > 0 ? slot.maxDuration : undefined);
      const resolved = await resolveSlotVideoUrl(slot, listingData, accountId, templateJson.schema, pinnedSetTag, pinnedCategory, prefillVideoAssets[slot.id], slotMinDuration);
      accumulateSlotTracking(slot, resolved, setSequencedLibraryIds, usedSetTagByLibrary, usedCategoryByLibrary, sequenceSlotAssets);
      // Track pinned set for subsequent slots sharing the same library
      if (slot.libraryId && normalizeRule(slot.selectionRule).strategy === "theme_sequence") {
        if (resolved.resolvedSetTag && !localPinnedSetTagByLibrary[slot.libraryId]) {
          localPinnedSetTagByLibrary[slot.libraryId] = resolved.resolvedSetTag;
        }
        if (resolved.resolvedCategory && !localPinnedCategoryByLibrary[slot.libraryId]) {
          localPinnedCategoryByLibrary[slot.libraryId] = resolved.resolvedCategory;
        }
      }
      resolvedSlots.push({ slot, videoUrl: resolved.url, metadata: resolved.metadata });
    }

    // Collect metadata by library for libraryMetadataRef substitution + variable injection
    const seqMetadataByLibrary = new Map<string, Record<string, string | number | null>>();
    for (const { slot, metadata } of resolvedSlots) {
      if (slot.libraryId && Object.keys(metadata).length > 0) {
        seqMetadataByLibrary.set(slot.libraryId, metadata);
      }
    }
    const patchedTemplateForSeq = applyAssetMetadata(templateJson, seqMetadataByLibrary);
    const enrichedListingData = enrichListingWithAssetMetadata(listingData, templateJson.schema, seqMetadataByLibrary);

    // 2. Rendre les overlays PNG par slot (avec support timed overlays)
    await updateRenderTracking(renderId, {
      pipeline: RENDER_PIPELINE.SEQUENCE_RUNPOD,
      stage: RENDER_STAGE.SEQ_RENDER_OVERLAYS,
      statusDetail: "Rendu des overlays de séquence",
      progress: 0.18,
    });

    const slotOverlays = await Promise.all(
      resolvedSlots.map(({ slot }) => renderSlotOverlay(patchedTemplateForSeq, enrichedListingData, slot, width, height))
    );

    // 3. Uploader les overlays vers R2
    await updateRenderTracking(renderId, {
      pipeline: RENDER_PIPELINE.SEQUENCE_RUNPOD,
      stage: RENDER_STAGE.SEQ_UPLOAD_OVERLAYS,
      statusDetail: "Upload des overlays de séquence",
      progress: 0.32,
    });

    // For each slot, upload all non-null overlay buffers and build the slot overlay descriptor
    const slotOverlayDescriptors = await Promise.all(
      slotOverlays.map(async (result, i) => {
        const uploaded: (string | null)[] = await Promise.all(
          result.buffers.map(async (buf, j) => {
            if (!buf) return null;
            const key = `overlays/${renderId}_seq${i}_${j}.png`;
            overlayKeys.push(key);
            return (await uploadToR2(key, buf, "image/png")).url;
          })
        );
        // Single overlay: use legacy overlay_url field for backward compat
        // Timed: use overlay_urls + overlay_segments per slot
        if (result.plan === null) {
          return { overlay_url: uploaded[0] ?? null };
        }
        return {
          overlay_urls: uploaded,
          overlay_segments: result.plan.segments,
        };
      })
    );

    // 4. Résoudre la musique (MusicBlock du template)
    const music = await resolveMusicConfig(templateJson, listingData, accountId, prefillAudioAssetId);

    // 5. Construire le payload slots pour RunPod
    const runpodSlots = resolvedSlots.map(({ slot, videoUrl }, i) => {
      const audioParams = slotSourceAudioParams(slot, templateJson.blocks);
      const musicBlock = music?.block;
      const slotAudioOverride = musicBlock?.slotAudio?.[slot.id];
      return {
        slot_id: slot.id,
        video_url: videoUrl,
        video_block: videoBlockForSlot(slot, templateJson.blocks, width, height),
        ...slotOverlayDescriptors[i],
        ...(slot.maxDuration !== undefined ? { max_duration: slot.maxDuration } : {}),
        music_source_volume: slotAudioOverride?.volume !== undefined ? slotAudioOverride.volume : audioParams.music_source_volume,
        music_mute_source: slotAudioOverride?.mute !== undefined ? slotAudioOverride.mute : audioParams.music_mute_source,
        ...(slotAudioOverride?.startAt !== undefined ? { music_start_at: slotAudioOverride.startAt } : {}),
        ...(slotAudioOverride?.stopAt !== undefined ? { music_stop_at: slotAudioOverride.stopAt } : {}),
        ...(slotAudioOverride?.musicTrackVolumeDb !== undefined ? { music_track_volume_db: slotAudioOverride.musicTrackVolumeDb } : {}),
        ...(slotAudioOverride?.musicTrackFadeIn !== undefined ? { music_track_fade_in: slotAudioOverride.musicTrackFadeIn } : {}),
        ...(slotAudioOverride?.musicTrackFadeOut !== undefined ? { music_track_fade_out: slotAudioOverride.musicTrackFadeOut } : {}),
      };
    });

    // 6. Soumettre le job RunPod
    await updateRenderTracking(renderId, {
      pipeline: RENDER_PIPELINE.SEQUENCE_RUNPOD,
      stage: RENDER_STAGE.SEQ_SUBMIT_RUNPOD,
      statusDetail: "Soumission de la séquence RunPod",
      progress: 0.5,
    });

    const outputKey = `renders/${renderId}.mp4`;
    const runpodData = await submitRunpodJob<{ id: string }>(
      RUNPOD_ENDPOINT_ID,
      RUNPOD_API_KEY,
      {
        input: {
          job_type: "render_sequence",
          export_profile: "template",
          canvas: { width, height },
          slots: runpodSlots,
          output_key: outputKey,
          render_id: renderId,
          ...(templateJson.canvas.maxDuration !== undefined && templateJson.canvas.maxDuration > 0
            ? { max_duration: templateJson.canvas.maxDuration }
            : {}),
          ...(music ? {
            music_url: music.musicUrl,
            music_volume: music.block.volume ?? 0.3,
            music_loop: music.block.loop ?? false,
            music_fade_in: music.block.fadeIn ?? 0,
            music_fade_out: music.block.fadeOut ?? 0,
          } : {}),
        },
        ...(() => {
          const webhookUrl = getRunpodWebhookUrl("/api/webhooks/runpod/renders");
          return webhookUrl ? { webhook: webhookUrl } : {};
        })(),
      },
      { timeoutMs: RUNPOD_SUBMIT_TIMEOUT_MS }
    );

    // 7. Persist usedAssets so recordLibraryUsage can advance cursors on DONE.
    // Merge into the existing row rather than replacing it — audioAssetId and
    // prevCursorStateByLibrary were written at render creation (POST /api/renders)
    // and must not be lost. Merge sequenceSlotAssets on top of existing videoAssets
    // so prefill entries for slots not re-resolved here are preserved.
    {
      const { videoAssets: existingVideoAssets } = await loadPrefillAssets(renderId);
      await mergeUsedAssets(renderId, {
        videoAssets: { ...existingVideoAssets, ...sequenceSlotAssets },
        ...(music?.assetId ? { audioAssetId: music.assetId } : {}),
        setSequencedLibraryIds,
        usedSetTagByLibrary,
        usedCategoryByLibrary,
      });
    }

    await updateRenderTracking(renderId, {
      status: "PROCESSING",
      pipeline: RENDER_PIPELINE.SEQUENCE_RUNPOD,
      stage: RENDER_STAGE.SEQ_RUNPOD_QUEUED,
      statusDetail: `Séquence RunPod soumise (${runpodData.id})`,
      progress: 0.6,
      runpodJobId: runpodData.id,
    });
  } catch (err) {
    if (overlayKeys.length > 0) {
      await Promise.allSettled(
        overlayKeys.map((k) =>
          deleteFromR2(k).catch((e) => console.warn(`[generateSequenceRender] R2 cleanup failed key=${k}:`, e))
        )
      );
    }
    await failRender(
      renderId,
      err instanceof Error ? err.message : "Erreur génération séquence",
      RENDER_PIPELINE.SEQUENCE_RUNPOD
    );
  }
}

async function generateSequenceRenderLocal(
  renderId: string,
  templateJson: TemplateJSON,
  listingData: ListingData,
  accountId: string | null,
): Promise<void> {
  const CAPTIONS_API = process.env.CAPTIONS_API_URL ?? (() => {
    console.warn("[generateRender] CAPTIONS_API_URL non configuré — fallback localhost:8000 (ne pas utiliser en production)");
    return "http://localhost:8000";
  })();
  const slots = templateJson.videoSequence!;
  const { width, height } = templateJson.canvas;

  // Track set-sequence libraries for cursor advancement (mirrors RunPod path)
  const setSequencedLibraryIds: string[] = [];
  const usedSetTagByLibrary: Record<string, string> = {};
  const usedCategoryByLibrary: Record<string, string> = {};
  const sequenceSlotAssets: Record<string, string> = {};

  try {
    // Load prefill asset IDs written at POST /api/renders from resolveLibraryPrefill.
    // Using these prevents re-querying the library at render time, which would
    // double-advance the rotation cursor and render different content than shown in the form.
    const { videoAssets: prefillVideoAssets, audioAssetId: prefillAudioAssetId } =
      await loadPrefillAssets(renderId);

    // Resolve slots
    await updateRenderTracking(renderId, {
      pipeline: RENDER_PIPELINE.SEQUENCE_LOCAL,
      stage: RENDER_STAGE.SEQ_RESOLVE_SLOTS,
      statusDetail: "Résolution des clips",
      progress: 0.08,
    });

    // Résolution séquentielle pour propager le pinnedSetTag entre slots d'une même bibliothèque
    const localPinnedSetTagByLibrary: Record<string, string> = {};
    const localPinnedCategoryByLibrary: Record<string, string> = {};
    const resolvedSlots: { slot: VideoSequenceSlot; videoUrl: string; metadata: Record<string, string | number | null> }[] = [];
    const allBlocksLocal = templateJson.blocks ?? [];
    for (const slot of slots) {
      const pinnedSetTag = slot.libraryId ? localPinnedSetTagByLibrary[slot.libraryId] : undefined;
      const pinnedCategory = slot.libraryId ? localPinnedCategoryByLibrary[slot.libraryId] : undefined;
      // Resolve minDuration from the linked VideoBlock (by videoBlockId or binding),
      // falling back to slot.maxDuration so that the asset covers at least the slot's required duration.
      const linkedVideoBlockLocal = slot.videoBlockId
        ? allBlocksLocal.find((b) => b.type === "video" && b.id === slot.videoBlockId) as VideoBlock | undefined
        : slot.binding
          ? allBlocksLocal.find((b) => b.type === "video" && b.binding === slot.binding) as VideoBlock | undefined
          : undefined;
      const slotMinDurationLocal: number | undefined = linkedVideoBlockLocal?.minDuration ?? (slot.maxDuration && slot.maxDuration > 0 ? slot.maxDuration : undefined);
      const resolved = await resolveSlotVideoUrl(slot, listingData, accountId, templateJson.schema, pinnedSetTag, pinnedCategory, prefillVideoAssets[slot.id], slotMinDurationLocal);
      accumulateSlotTracking(slot, resolved, setSequencedLibraryIds, usedSetTagByLibrary, usedCategoryByLibrary, sequenceSlotAssets);
      if (slot.libraryId && normalizeRule(slot.selectionRule).strategy === "theme_sequence") {
        if (resolved.resolvedSetTag && !localPinnedSetTagByLibrary[slot.libraryId]) {
          localPinnedSetTagByLibrary[slot.libraryId] = resolved.resolvedSetTag;
        }
        if (resolved.resolvedCategory && !localPinnedCategoryByLibrary[slot.libraryId]) {
          localPinnedCategoryByLibrary[slot.libraryId] = resolved.resolvedCategory;
        }
      }
      resolvedSlots.push({ slot, videoUrl: resolved.url, metadata: resolved.metadata });
    }

    // Collect metadata by library for libraryMetadataRef substitution + variable injection
    const seqMetadataByLibrary = new Map<string, Record<string, string | number | null>>();
    for (const { slot, metadata } of resolvedSlots) {
      if (slot.libraryId && Object.keys(metadata).length > 0) {
        seqMetadataByLibrary.set(slot.libraryId, metadata);
      }
    }
    const patchedTemplateForSeq = applyAssetMetadata(templateJson, seqMetadataByLibrary);
    const enrichedListingData = enrichListingWithAssetMetadata(listingData, templateJson.schema, seqMetadataByLibrary);

    // Render overlays (with timed overlay support)
    const slotOverlays = await Promise.all(
      resolvedSlots.map(({ slot }) => renderSlotOverlay(patchedTemplateForSeq, enrichedListingData, slot, width, height))
    );

    // Resolve music
    const music = await resolveMusicConfig(templateJson, listingData, accountId, prefillAudioAssetId);

    // For local path, convert local /uploads/ paths to absolute URLs.
    // FONT_BASE_URL must be set in Docker (e.g. http://web:3000) so the render-engine
    // container can reach the web container — same pattern as resolveMusicConfig.
    const resolveVideoUrl = (rawUrl: string): string => {
      if (rawUrl.startsWith("http")) return rawUrl;
      const base = (process.env.FONT_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
      return `${base}${rawUrl}`;
    };

    const localSlots = resolvedSlots.map(({ slot, videoUrl }, i) => {
      const overlayResult = slotOverlays[i];
      const audioParams = slotSourceAudioParams(slot, templateJson.blocks);
      const musicBlock = music?.block;
      const slotAudioOverride = musicBlock?.slotAudio?.[slot.id];
      // Single overlay: legacy overlay_data (base64) field; timed: overlay_data_list + overlay_segments
      const overlayPayload = overlayResult.plan === null
        ? { overlay_data: overlayResult.buffers[0]?.toString("base64") ?? null }
        : {
            overlay_data_list: overlayResult.buffers.map((b) => b?.toString("base64") ?? null),
            overlay_segments: overlayResult.plan.segments,
          };
      return {
        slot_id: slot.id,
        video_url: resolveVideoUrl(videoUrl),
        video_block: videoBlockForSlot(slot, templateJson.blocks, width, height),
        ...overlayPayload,
        ...(slot.maxDuration !== undefined ? { max_duration: slot.maxDuration } : {}),
        music_source_volume: slotAudioOverride?.volume !== undefined ? slotAudioOverride.volume : audioParams.music_source_volume,
        music_mute_source: slotAudioOverride?.mute !== undefined ? slotAudioOverride.mute : audioParams.music_mute_source,
        ...(slotAudioOverride?.startAt !== undefined ? { music_start_at: slotAudioOverride.startAt } : {}),
        ...(slotAudioOverride?.stopAt !== undefined ? { music_stop_at: slotAudioOverride.stopAt } : {}),
        ...(slotAudioOverride?.musicTrackVolumeDb !== undefined ? { music_track_volume_db: slotAudioOverride.musicTrackVolumeDb } : {}),
        ...(slotAudioOverride?.musicTrackFadeIn !== undefined ? { music_track_fade_in: slotAudioOverride.musicTrackFadeIn } : {}),
        ...(slotAudioOverride?.musicTrackFadeOut !== undefined ? { music_track_fade_out: slotAudioOverride.musicTrackFadeOut } : {}),
      };
    });

    await updateRenderTracking(renderId, {
      pipeline: RENDER_PIPELINE.SEQUENCE_LOCAL,
      stage: RENDER_STAGE.SEQ_LOCAL_SEND,
      statusDetail: "Envoi de la séquence au render-engine",
      progress: 0.42,
    });

    const res = await fetch(`${CAPTIONS_API}/api/render_sequence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        canvas: { width, height },
        slots: localSlots,
        export_profile: "template",
        ...(templateJson.canvas.maxDuration !== undefined && templateJson.canvas.maxDuration > 0
          ? { max_duration: templateJson.canvas.maxDuration }
          : {}),
        ...(music ? {
          music_url: music.musicUrl,
          music_volume: music.block.volume ?? 0.3,
          music_loop: music.block.loop ?? false,
          music_fade_in: music.block.fadeIn ?? 0,
          music_fade_out: music.block.fadeOut ?? 0,
        } : {}),
      }),
      signal: AbortSignal.timeout(LOCAL_VIDEO_RENDER_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`render-engine ${res.status}: ${await res.text()}`);
    }

    const data = await res.json() as { videoUrl?: string; slotDurations?: Record<string, number> };
    if (!data.videoUrl) throw new Error("render-engine n'a pas renvoyé d'URL vidéo");

    const finalUrl = data.videoUrl.startsWith("http")
      ? data.videoUrl
      : `/api/captions${data.videoUrl.startsWith("/") ? data.videoUrl : `/${data.videoUrl}`}`;

    // Persist usedAssets before marking DONE so recordLibraryUsage can advance cursors.
    // Merge into the existing row rather than replacing it — audioAssetId and
    // prevCursorStateByLibrary were written at render creation (POST /api/renders)
    // and must not be lost. Merge sequenceSlotAssets on top of existing videoAssets
    // so prefill entries for slots not re-resolved here are preserved.
    {
      const { videoAssets: existingVideoAssets } = await loadPrefillAssets(renderId);
      await mergeUsedAssets(renderId, {
        videoAssets: { ...existingVideoAssets, ...sequenceSlotAssets },
        ...(music?.assetId ? { audioAssetId: music.assetId } : {}),
        setSequencedLibraryIds,
        usedSetTagByLibrary,
        usedCategoryByLibrary,
      });
    }
    await updateRenderTracking(renderId, {
      status: "DONE",
      pipeline: RENDER_PIPELINE.SEQUENCE_LOCAL,
      stage: RENDER_STAGE.DONE,
      statusDetail: "Séquence générée localement",
      progress: 1,
      videoUrl: finalUrl,
      finishedAt: new Date(),
    });

    recordLibraryUsage(renderId).catch((err) =>
      console.error("[generateRender] recordLibraryUsage failed:", err)
    );

    // Parité webhook RunPod : log activity + auto-transition pipeline.
    await onRenderCompleted(renderId);

    // Persister slotDurations sur Render pour que les triggers en aval (auto-sous-titres,
    // cover frames) puissent les lire — même path que le webhook RunPod renders.
    if (data.slotDurations && Object.keys(data.slotDurations).length > 0) {
      await prisma.render.update({
        where: { id: renderId },
        data: { slotDurations: JSON.stringify(data.slotDurations) },
      });
    }

    // Auto-sous-titrage local (captionAutoConfig.enabled) — best-effort
    const rawSequenceVideoPath = data.videoUrl.startsWith("http") ? null : data.videoUrl;
    if (rawSequenceVideoPath) {
      void triggerAutoTranscriptionLocal(renderId, CAPTIONS_API, rawSequenceVideoPath).catch((err) =>
        console.error(`[sequenceLocal] triggerAutoTranscriptionLocal threw: ${String(err)}`)
      );
      const autoCoverRender = await prisma.render.findUnique({
        where: { id: renderId },
        select: { templateId: true, listing: { select: { userId: true } } },
      });
      if (autoCoverRender?.listing.userId) {
        void triggerAutoCoverPackForRender(
          renderId,
          autoCoverRender.templateId,
          `${CAPTIONS_API}${rawSequenceVideoPath}`,
          autoCoverRender.listing.userId,
        ).catch((err) =>
          console.error(`[sequenceLocal] triggerAutoCoverPackForRender threw: ${String(err)}`)
        );
      }
    }
  } catch (err) {
    console.error(`[sequenceLocal] ${renderId} — ERROR:`, err);
    await failRender(
      renderId,
      err instanceof Error ? err.message : "Erreur génération séquence locale",
      RENDER_PIPELINE.SEQUENCE_LOCAL
    );
  }
}
