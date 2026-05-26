import path from "path";
import { mkdir, writeFile } from "fs/promises";
import { prisma } from "@/lib/prisma";
import { deleteFromR2, r2Configured, uploadToR2 } from "@/lib/r2";
import { buildHTML } from "@/lib/renderer/buildHTML";
import { renderPNG } from "@/lib/renderer/renderPNG";
import { normalizeTemplateJSON } from "@/lib/templateNormalization";
import { resolveSlotExcludeZones, resolveZone } from "@/lib/triggerAutoCaptionFromTranscription";
import type { ListingData } from "@/types/listing";
import type { AnyBlock, CoverAutoConfig, ImageBlock, SchemaField, TemplateJSON, TextBlock, VideoBlock, VideoSequenceSlot } from "@/types/template";

const CAPTIONS_API = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";
const WEB_MEDIA_BASE = (process.env.FONT_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
const DEFAULT_FRAME_COUNT = 36;
const MIN_FRAME_GAP_S = 1 / 30;

type ExtractedFrame = { timestamp: number; url: string };
type FrameInterval = { start: number; end: number };
type CoverSeenFrame = number | { sourceUrl: string; timestamp: number };
type CoverFramePick = { sourceUrl: string; timestamp: number };
type CoverFrameSource = { slotId: string; sourceUrl: string; duration: number };

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeFrameCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(72, Math.max(6, Math.round(value)))
    : DEFAULT_FRAME_COUNT;
}

async function probeDuration(videoUrl: string): Promise<number | null> {
  try {
    const res = await fetch(`${CAPTIONS_API}/api/probe-duration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: videoUrl }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { duration?: number | null };
    return typeof data.duration === "number" && data.duration > 0 ? data.duration : null;
  } catch (err) {
    console.warn(`[coverAuto] probe duration failed for ${videoUrl}:`, err);
    return null;
  }
}

function subtractZones(duration: number, zones: Array<{ startSec: number; endSec: number | null }>): FrameInterval[] {
  let intervals: FrameInterval[] = [{ start: 0, end: duration }];
  const sorted = zones
    .map((zone) => ({
      start: Math.max(0, Math.min(duration, zone.startSec)),
      end: Math.max(0, Math.min(duration, zone.endSec ?? duration)),
    }))
    .filter((zone) => zone.end > zone.start)
    .sort((a, b) => a.start - b.start);

  for (const zone of sorted) {
    const next: FrameInterval[] = [];
    for (const interval of intervals) {
      if (zone.end <= interval.start || zone.start >= interval.end) {
        next.push(interval);
        continue;
      }
      if (zone.start > interval.start) next.push({ start: interval.start, end: zone.start });
      if (zone.end < interval.end) next.push({ start: zone.end, end: interval.end });
    }
    intervals = next;
  }

  return intervals.filter((interval) => interval.end - interval.start >= MIN_FRAME_GAP_S);
}

function sampleEvenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const step = items.length / count;
  return Array.from({ length: count }, (_, index) => items[Math.min(items.length - 1, Math.floor(index * step + step / 2))]);
}

function targetFrameCount(totalDuration: number, requestedCount: number): number {
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) return 0;
  return Math.min(requestedCount, Math.max(1, Math.floor(totalDuration / MIN_FRAME_GAP_S)));
}

function pickTimestamps(intervals: FrameInterval[], count: number, seen: number[]): number[] {
  const collect = (seenValues: number[]) => {
    const candidates: number[] = [];
    for (const interval of intervals) {
      const intervalDuration = interval.end - interval.start;
      const intervalFrameCount = Math.floor(intervalDuration / MIN_FRAME_GAP_S);
      for (let index = 0; index < intervalFrameCount; index += 1) {
        const ts = Math.round((interval.start + ((index + 0.5) * intervalDuration) / intervalFrameCount) * 1000) / 1000;
        const tooClose = seenValues.some((value) => Math.abs(value - ts) < MIN_FRAME_GAP_S * 0.8);
        if (!tooClose) candidates.push(ts);
      }
    }
    return candidates;
  };

  const target = targetFrameCount(intervals.reduce((sum, interval) => sum + interval.end - interval.start, 0), count);
  if (target === 0) return [];
  let candidates = collect(seen);
  if (candidates.length < target && seen.length > 0) {
    candidates = collect([]);
  }
  return sampleEvenly(candidates, target);
}

function normalizeSeenFrames(raw: CoverSeenFrame[]): { finalTimestamps: number[]; nativeKeys: Set<string> } {
  const finalTimestamps: number[] = [];
  const nativeKeys = new Set<string>();
  for (const item of raw) {
    if (typeof item === "number" && Number.isFinite(item)) {
      finalTimestamps.push(item);
      continue;
    }
    if (item && typeof item === "object" && typeof item.sourceUrl === "string" && typeof item.timestamp === "number") {
      nativeKeys.add(`${item.sourceUrl}::${Math.round(item.timestamp * 1000) / 1000}`);
    }
  }
  return { finalTimestamps, nativeKeys };
}

function pickNativeFrames(sources: CoverFrameSource[], count: number, seen: Set<string>): CoverFramePick[] {
  const collect = (seenValues: Set<string>) => {
    const candidates: CoverFramePick[] = [];
    for (const source of sources) {
      const sourceFrameCount = Math.floor(source.duration / MIN_FRAME_GAP_S);
      for (let index = 0; index < sourceFrameCount; index += 1) {
        const timestamp = Math.round((((index + 0.5) * source.duration) / sourceFrameCount) * 1000) / 1000;
        if (!seenValues.has(`${source.sourceUrl}::${timestamp}`)) {
          candidates.push({ sourceUrl: source.sourceUrl, timestamp });
        }
      }
    }
    return candidates;
  };

  const target = targetFrameCount(sources.reduce((sum, source) => sum + source.duration, 0), count);
  if (target === 0) return [];
  let candidates = collect(seen);
  if (candidates.length < target && seen.size > 0) {
    candidates = collect(new Set());
  }
  return sampleEvenly(candidates, target);
}

function resolveCoverTimestamps(
  template: TemplateJSON,
  config: CoverAutoConfig,
  duration: number,
  count: number,
  seen: number[],
  slotDurations?: Record<string, number>,
): number[] {
  const blockZones = (config.excludeZones ?? [])
    .map((zone) => resolveZone(zone, template.blocks ?? []))
    .filter((zone): zone is NonNullable<typeof zone> => zone !== null);
  const slotZones =
    config.excludeSlotIds?.length && template.videoSequence?.length
      ? resolveSlotExcludeZones(config.excludeSlotIds, template.videoSequence, duration, slotDurations)
      : [];
  const intervals = subtractZones(duration, [...blockZones, ...slotZones]);
  return pickTimestamps(intervals, count, seen);
}

async function extractFrames(videoUrl: string, timestamps: number[]): Promise<ExtractedFrame[]> {
  const form = new FormData();
  form.append("video_url", videoUrl);
  form.append("timestamps_json", JSON.stringify(timestamps));
  const res = await fetch(`${CAPTIONS_API}/api/extract-covers`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(15 * 60_000),
  });
  if (!res.ok) {
    throw new Error(`Extraction frames échouée (${res.status}): ${await res.text()}`);
  }
  return await res.json() as ExtractedFrame[];
}

function toBrowserMediaUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/outputs/")) {
      return `/api/captions${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Relative URLs are handled below.
  }
  return url.startsWith("/outputs/") ? `/api/captions${url}` : url;
}

function toRenderMediaUrl(url: string): string {
  if (url.startsWith("/api/captions/")) {
    return `${CAPTIONS_API}/${url.replace(/^\/api\/captions\//, "")}`;
  }
  if (url.startsWith("/")) {
    return `${WEB_MEDIA_BASE}${url}`;
  }
  return url;
}

export function toCoverSourceVideoUrl(url: string): string {
  return toRenderMediaUrl(url);
}

async function resolveNativeCoverSources(
  template: TemplateJSON,
  config: CoverAutoConfig,
  usedAssetsRaw: string | null,
  listingDataRaw: string | null,
): Promise<CoverFrameSource[]> {
  const slots = template.videoSequence ?? [];
  const usedAssets = safeJson<{ videoAssets?: Record<string, string> }>(usedAssetsRaw, {});
  const listingData = safeJson<ListingData>(listingDataRaw, {} as ListingData);
  const videoAssets = usedAssets.videoAssets ?? {};
  const videoBlocks = (template.blocks ?? []).filter((block): block is VideoBlock => block.type === "video");
  const sourceKeys = slots.length > 0
    ? slots.filter((slot) => !(config.excludeSlotIds ?? []).includes(slot.id)).map((slot) => slot.id)
    : videoBlocks.map((block) => block.id);
  if (sourceKeys.length === 0) return [];

  const assetIds = sourceKeys
    .map((sourceKey) => videoAssets[sourceKey])
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const assets = assetIds.length > 0
    ? await prisma.mediaAsset.findMany({
        where: { id: { in: [...new Set(assetIds)] } },
        select: { id: true, url: true, duration: true },
      })
    : [];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));

  const sources: CoverFrameSource[] = [];
  const sourceItems = slots.length > 0
    ? slots.filter((slot) => !(config.excludeSlotIds ?? []).includes(slot.id)).map((slot) => ({
        id: slot.id,
        maxDuration: slot.maxDuration,
        rawUrl: resolveSlotNativeUrl(slot, videoAssets, assetById, listingData),
      }))
    : videoBlocks.map((block) => ({
        id: block.id,
        maxDuration: undefined,
        rawUrl: resolveVideoBlockNativeUrl(block, videoAssets, assetById, listingData),
      }));

  for (const sourceItem of sourceItems) {
    const rawUrl = sourceItem.rawUrl;
    if (!rawUrl) continue;

    const sourceUrl = toRenderMediaUrl(rawUrl);
    const assetDuration = assetById.get(videoAssets[sourceItem.id] ?? "")?.duration ?? null;
    const probedDuration = typeof assetDuration === "number" && assetDuration > 0 ? assetDuration : await probeDuration(sourceUrl);
    if (!probedDuration) {
      console.warn(`[coverAuto] Durée rush introuvable pour source=${sourceItem.id} url=${sourceUrl}`);
      continue;
    }
    const duration = sourceItem.maxDuration && sourceItem.maxDuration > 0
      ? Math.min(probedDuration, sourceItem.maxDuration)
      : probedDuration;
    if (duration > MIN_FRAME_GAP_S) sources.push({ slotId: sourceItem.id, sourceUrl, duration });
  }
  return sources;
}

function resolveSlotNativeUrl(
  slot: VideoSequenceSlot,
  videoAssets: Record<string, string>,
  assetById: Map<string, { id: string; url: string; duration: number | null }>,
  listingData: ListingData,
): string | null {
  const assetId = videoAssets[slot.id];
  const assetUrl = assetId ? assetById.get(assetId)?.url : null;
  if (assetUrl) return assetUrl;
  if (slot.binding) {
    const raw = (listingData as Record<string, unknown>)[slot.binding];
    if (typeof raw === "string" && (raw.startsWith("http") || raw.startsWith("/"))) return raw;
  }
  return null;
}

function resolveVideoBlockNativeUrl(
  block: VideoBlock,
  videoAssets: Record<string, string>,
  assetById: Map<string, { id: string; url: string; duration: number | null }>,
  listingData: ListingData,
): string | null {
  const assetId = videoAssets[block.id];
  const assetUrl = assetId ? assetById.get(assetId)?.url : null;
  if (assetUrl) return assetUrl;
  if (block.binding) {
    const raw = (listingData as Record<string, unknown>)[block.binding];
    if (typeof raw === "string" && (raw.startsWith("http") || raw.startsWith("/"))) return raw;
  }
  return null;
}

async function persistFrame(packId: string, userId: string, frame: ExtractedFrame, index: number): Promise<{ imageUrl: string; imageKey: string | null }> {
  const sourceUrl = frame.url.startsWith("http")
    ? frame.url
    : `${CAPTIONS_API}${frame.url.startsWith("/") ? frame.url : `/${frame.url}`}`;

  if (!r2Configured()) {
    return {
      imageUrl: toBrowserMediaUrl(sourceUrl),
      imageKey: null,
    };
  }

  const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Frame ${frame.timestamp}s introuvable (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const key = `covers/${userId}/${packId}/candidate-${index + 1}.jpg`;
  const uploaded = await uploadToR2(key, buffer, "image/jpeg", buffer.byteLength);
  return { imageUrl: uploaded.url, imageKey: uploaded.key };
}

export async function deleteCoverCandidateAssets(packId: string): Promise<void> {
  if (!r2Configured()) return;
  const candidates = await prisma.coverFrameCandidate.findMany({
    where: { packId, imageKey: { not: null } },
    select: { imageKey: true },
  });
  await Promise.all(
    candidates.map((candidate) =>
      candidate.imageKey
        ? deleteFromR2(candidate.imageKey).catch((err) =>
            console.warn(`[coverAuto] R2 cleanup failed for key=${candidate.imageKey}:`, err),
          )
        : Promise.resolve(),
    ),
  );
}

export async function prepareCoverFramePack(packId: string): Promise<void> {
  const pack = await prisma.coverFramePack.findUnique({
    where: { id: packId },
    include: {
      template: true,
      render: { select: { usedAssets: true, slotDurations: true, listing: { select: { jsonData: true } } } },
    },
  });
  if (!pack?.template || !pack.sourceVideoUrl) return;

  let slotDurations: Record<string, number> | undefined;
  if (pack.render.slotDurations) {
    try {
      slotDurations = JSON.parse(pack.render.slotDurations) as Record<string, number>;
    } catch {
      console.warn(`[coverAuto] slotDurations JSON invalide pour pack=${packId} — ignoré`);
    }
  }

  await prisma.coverFramePack.update({
    where: { id: packId },
    data: { status: "PROCESSING", errorMsg: null },
  });

  try {
    const templateJson = normalizeTemplateJSON(JSON.parse(pack.template.jsonData) as TemplateJSON);
    const config = safeJson<CoverAutoConfig>(pack.config, { enabled: false, excludeZones: [] });
    if (!config.enabled) return;

    const frameCount = normalizeFrameCount(config.frameCount ?? pack.frameCount);
    const seen = normalizeSeenFrames(safeJson<CoverSeenFrame[]>(pack.usedTimestamps, []));
    const nativeSources = await resolveNativeCoverSources(
      templateJson,
      config,
      pack.render.usedAssets,
      pack.render.listing.jsonData,
    );
    let duration = pack.duration;
    let framePicks: CoverFramePick[] = [];
    let extractedFrames: ExtractedFrame[] = [];

    if (nativeSources.length > 0) {
      duration = nativeSources.reduce((sum, source) => sum + source.duration, 0);
      framePicks = pickNativeFrames(nativeSources, frameCount, seen.nativeKeys);
      for (const source of nativeSources) {
        const sourcePicks = framePicks.filter((pick) => pick.sourceUrl === source.sourceUrl);
        if (sourcePicks.length === 0) continue;
        const frames = await extractFrames(source.sourceUrl, sourcePicks.map((pick) => pick.timestamp));
        extractedFrames.push(...frames);
      }
    } else {
      duration = duration ?? await probeDuration(pack.sourceVideoUrl);
      if (!duration) throw new Error("Durée vidéo introuvable pour préparer les frames cover");
      const timestamps = resolveCoverTimestamps(templateJson, config, duration, frameCount, seen.finalTimestamps, slotDurations);
      framePicks = timestamps.map((timestamp) => ({ sourceUrl: pack.sourceVideoUrl!, timestamp }));
      extractedFrames = await extractFrames(pack.sourceVideoUrl, timestamps);
    }

    if (!duration) throw new Error("Durée vidéo introuvable pour préparer les frames cover");
    if (framePicks.length === 0) {
      throw new Error("Aucune frame disponible après application des zones exclues");
    }
    if (extractedFrames.length === 0) throw new Error("Le render-engine n'a extrait aucune frame");

    const persisted = await Promise.all(
      extractedFrames.map(async (frame, index) => ({
        timestamp: frame.timestamp,
        ...(await persistFrame(pack.id, pack.userId, frame, index)),
      })),
    );

    await prisma.coverFrameCandidate.createMany({
      data: persisted.map((frame) => ({
        packId: pack.id,
        timestamp: frame.timestamp,
        imageUrl: frame.imageUrl,
        imageKey: frame.imageKey,
      })),
    });

    await prisma.coverFramePack.update({
      where: { id: pack.id },
      data: {
        status: "READY",
        duration,
        usedTimestamps: JSON.stringify([
          ...safeJson<CoverSeenFrame[]>(pack.usedTimestamps, []),
          ...framePicks.map((pick) =>
            nativeSources.length > 0
              ? { sourceUrl: pick.sourceUrl, timestamp: pick.timestamp }
              : pick.timestamp,
          ),
        ]),
        errorMsg: null,
      },
    });
  } catch (err) {
    await prisma.coverFramePack.update({
      where: { id: packId },
      data: { status: "FAILED", errorMsg: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

export function queueCoverFramePackPreparation(packId: string): void {
  void prepareCoverFramePack(packId).catch((err) => {
    console.error(`[coverAuto] Préparation pack=${packId} échouée : ${String(err)}`);
  });
}

export async function triggerAutoCoverPackForRender(
  renderId: string,
  templateId: string | null | undefined,
  sourceVideoUrl: string,
  userId: string,
): Promise<void> {
  if (!templateId || !sourceVideoUrl) return;

  const templateExists = await prisma.template.findUnique({ where: { id: templateId }, select: { id: true } });
  if (!templateExists) return;

  // Lire Pattern.coverConfig — source de vérité Phase 1.8 (template.coverAutoConfig supprimé)
  const renderSlot = await prisma.render.findUnique({
    where: { id: renderId },
    select: {
      publicationSlot: {
        select: {
          pattern: { select: { coverMode: true, coverConfig: true } },
        },
      },
    },
  });
  const slotPattern = renderSlot?.publicationSlot?.pattern;
  const config: CoverAutoConfig | undefined =
    slotPattern?.coverMode === "auto" && slotPattern.coverConfig
      ? (slotPattern.coverConfig as unknown as CoverAutoConfig)
      : undefined;

  if (!config?.enabled) return;

  const existing = await prisma.coverFramePack.findUnique({ where: { renderId } });
  if (existing) {
    console.info(`[autoCover] Pack déjà existant (${existing.id}) pour render=${renderId} — skip`);
    return;
  }

  const frameCount = normalizeFrameCount(config.frameCount);
  let pack: { id: string };
  try {
    pack = await prisma.coverFramePack.create({
      data: {
        userId,
        renderId,
        templateId,
        status: "QUEUED",
        sourceVideoUrl,
        frameCount,
        config: JSON.stringify(config),
        overlayGroupIds: JSON.stringify(config.overlayGroupIds ?? []),
      },
    });
  } catch (err) {
    console.warn(`[autoCover] Création pack ignorée pour render=${renderId} : ${String(err)}`);
    return;
  }

  queueCoverFramePackPreparation(pack.id);
  console.info(`[autoCover] Pack ${pack.id} lancé pour render=${renderId}`);
}

function buildMetadataByLibrary(assets: Array<{ libraryId: string; metadata: string }>): Map<string, Record<string, string | number | null>> {
  const map = new Map<string, Record<string, string | number | null>>();
  for (const asset of assets) {
    map.set(asset.libraryId, safeJson<Record<string, string | number | null>>(asset.metadata, {}));
  }
  return map;
}

function enrichListingWithAssetMetadata(
  listingData: ListingData,
  schema: SchemaField[],
  assetMetadataByLibrary: Map<string, Record<string, string | number | null>>,
): ListingData {
  if (assetMetadataByLibrary.size === 0) return listingData;
  const patch: Record<string, unknown> = {};
  for (const field of schema) {
    if (!field.metadataSource) continue;
    const meta = assetMetadataByLibrary.get(field.metadataSource.libraryId);
    const value = meta?.[field.metadataSource.metadataKey];
    if (value === null || value === undefined) continue;
    const existing = (listingData as Record<string, unknown>)[field.key];
    if (existing !== undefined && existing !== null && existing !== "") continue;
    patch[field.key] = value;
  }
  return Object.keys(patch).length > 0 ? ({ ...listingData, ...patch } as ListingData) : listingData;
}

function applyAssetMetadata(templateJson: TemplateJSON, assetMetadataByLibrary: Map<string, Record<string, string | number | null>>): TemplateJSON {
  if (assetMetadataByLibrary.size === 0) return templateJson;
  return {
    ...templateJson,
    blocks: templateJson.blocks.map((block) => {
      if (block.type !== "text") return block;
      const textBlock = block as TextBlock;
      if (!textBlock.libraryMetadataRef) return block;
      const meta = assetMetadataByLibrary.get(textBlock.libraryMetadataRef.libraryId);
      const value = meta?.[textBlock.libraryMetadataRef.key];
      if (value === null || value === undefined) return block;
      const text = String(value);
      return { ...textBlock, content: text, contentSegments: [{ type: "text" as const, value: text }] };
    }),
  };
}

function buildCoverTemplate(
  templateJson: TemplateJSON,
  frameUrl: string,
  overlayGroupIds: string[],
  offsetX: number,
  offsetY: number,
): TemplateJSON {
  const allowedGroups = new Set(overlayGroupIds);
  const overlayBlocks = templateJson.blocks
    .filter((block) => block.groupId && allowedGroups.has(block.groupId))
    .filter((block) => block.type !== "video" && block.type !== "music")
    .map((block) => ({
      ...block,
      x: Math.round(block.x + offsetX),
      y: Math.round(block.y + offsetY),
      z: Math.max(1, (block.z ?? 0) + 1),
    } as AnyBlock));

  const background: ImageBlock = {
    id: "cover-frame-background",
    type: "image",
    x: 0,
    y: 0,
    w: templateJson.canvas.width,
    h: templateJson.canvas.height,
    z: 0,
    fit: "cover",
    staticSrc: frameUrl,
    animations: [],
  };

  return {
    ...templateJson,
    blocks: [background, ...overlayBlocks],
    groups: templateJson.groups.filter((group) => allowedGroups.has(group.id)),
    videoSequence: undefined,
    captionAutoConfig: undefined,
  };
}

export async function renderFinalCover(
  packId: string,
  candidateId: string,
  offsetX: number,
  offsetY: number,
): Promise<{ url: string; key: string | null }> {
  const pack = await prisma.coverFramePack.findUnique({
    where: { id: packId },
    include: {
      render: { include: { listing: true, template: true } },
      candidates: true,
    },
  });
  if (!pack?.render.template) throw new Error("Pack cover introuvable");
  const candidate = pack.candidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error("Frame candidate introuvable");

  let templateJson = normalizeTemplateJSON(JSON.parse(pack.render.template.jsonData) as TemplateJSON);
  const listingData = safeJson<ListingData>(pack.render.listing.jsonData, {} as ListingData);
  const usedAssets = safeJson<{ videoAssets?: Record<string, string> }>(pack.render.usedAssets, {});
  const assetIds = [...new Set(Object.values(usedAssets.videoAssets ?? {}))];
  const assets = assetIds.length > 0
    ? await prisma.mediaAsset.findMany({
        where: { id: { in: assetIds } },
        select: { libraryId: true, metadata: true },
      })
    : [];
  const metadataByLibrary = buildMetadataByLibrary(assets);
  const enrichedListing = enrichListingWithAssetMetadata(listingData, templateJson.schema ?? [], metadataByLibrary);
  templateJson = applyAssetMetadata(templateJson, metadataByLibrary);

  const overlayGroupIds = safeJson<string[]>(pack.overlayGroupIds, []);
  const coverTemplate = buildCoverTemplate(templateJson, toRenderMediaUrl(candidate.imageUrl), overlayGroupIds, offsetX, offsetY);
  const publicBase = "file://" + path.join(process.cwd(), "public").replace(/\\/g, "/");
  const html = await buildHTML(coverTemplate, enrichedListing, { publicBase });
  const png = await renderPNG(html, coverTemplate.canvas.width, coverTemplate.canvas.height, 1, false);

  const key = `covers/${pack.userId}/${pack.id}/final.png`;
  if (!r2Configured()) {
    const outputDir = path.join(process.cwd(), "public", "covers", pack.userId, pack.id);
    await mkdir(outputDir, { recursive: true });
    const filename = "final.png";
    await writeFile(path.join(outputDir, filename), png);
    return { url: `/covers/${pack.userId}/${pack.id}/${filename}`, key: null };
  }

  const uploaded = await uploadToR2(key, png, "image/png", png.byteLength);
  return { url: uploaded.url, key: uploaded.key };
}

export async function getCoverOverlayCanvasDimensions(packId: string): Promise<{ width: number; height: number }> {
  const pack = await prisma.coverFramePack.findUnique({
    where: { id: packId },
    select: { render: { select: { template: { select: { jsonData: true } } } } },
  });
  try {
    const tpl = JSON.parse(pack?.render.template?.jsonData ?? "{}") as { canvas?: { width?: number; height?: number } };
    return { width: tpl.canvas?.width ?? 1080, height: tpl.canvas?.height ?? 1920 };
  } catch {
    return { width: 1080, height: 1920 };
  }
}

export async function buildCoverOverlayPreviewHtml(packId: string): Promise<string> {
  const pack = await prisma.coverFramePack.findUnique({
    where: { id: packId },
    include: {
      render: { include: { listing: true, template: true } },
    },
  });
  if (!pack?.render.template) throw new Error("Pack cover introuvable");

  let templateJson = normalizeTemplateJSON(JSON.parse(pack.render.template.jsonData) as TemplateJSON);
  const listingData = safeJson<ListingData>(pack.render.listing.jsonData, {} as ListingData);
  const usedAssets = safeJson<{ videoAssets?: Record<string, string> }>(pack.render.usedAssets, {});
  const assetIds = [...new Set(Object.values(usedAssets.videoAssets ?? {}))];
  const assets = assetIds.length > 0
    ? await prisma.mediaAsset.findMany({
        where: { id: { in: assetIds } },
        select: { libraryId: true, metadata: true },
      })
    : [];
  const metadataByLibrary = buildMetadataByLibrary(assets);
  const enrichedListing = enrichListingWithAssetMetadata(listingData, templateJson.schema ?? [], metadataByLibrary);
  templateJson = applyAssetMetadata(templateJson, metadataByLibrary);

  const overlayGroupIds = safeJson<string[]>(pack.overlayGroupIds, []);
  const overlayTemplate: TemplateJSON = {
    ...templateJson,
    blocks: templateJson.blocks
      .filter((block) => block.groupId && overlayGroupIds.includes(block.groupId))
      .filter((block) => block.type !== "video" && block.type !== "music"),
    groups: templateJson.groups.filter((group) => overlayGroupIds.includes(group.id)),
    videoSequence: undefined,
    captionAutoConfig: undefined,
  };
  const publicBase = "file://" + path.join(process.cwd(), "public").replace(/\\/g, "/");
  const html = await buildHTML(overlayTemplate, enrichedListing, { publicBase, overlayMode: true });
  // Le viewport meta (width=canvas.width) gère le scaling côté navigateur — identique
  // à ce que fait Puppeteer lors du rendu final. On applique un scale CSS uniquement
  // si le meta viewport n'est pas respecté (fallback pour certains contextes sandbox).
  // On évite de surcharger body.style.width avec '100vw' : sur certains navigateurs
  // 100vw inclut la largeur de la scrollbar, ce qui décale le calcul d'échelle.
  return html.replace(
    "</body>",
    `<script>
      (function () {
        var sw = ${overlayTemplate.canvas.width};
        var sh = ${overlayTemplate.canvas.height};
        if (window.innerWidth >= sw - 1) return;
        var scale = Math.min(window.innerWidth / sw, window.innerHeight / sh);
        var canvas = document.getElementById('canvas');
        if (!canvas) return;
        canvas.style.transformOrigin = '0 0';
        canvas.style.transform = 'scale(' + scale + ')';
      })();
    </script></body>`,
  );
}
