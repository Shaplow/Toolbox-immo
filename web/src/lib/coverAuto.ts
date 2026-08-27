import path from "path";
import { mkdir, writeFile } from "fs/promises";
import { prisma } from "@/lib/prisma";
import { createLimiter, mapWithConcurrencySettled } from "@/lib/concurrency";
import { withRetry, withRetryIf } from "@/lib/retry";
import { resolveRunpodJobPhase, runpodConfigured, submitRunpodJob } from "@/lib/runpod";
import { getRunpodWebhookUrl } from "@/lib/webhooks/runpod";
import { deleteFromR2, deleteR2Prefix, r2Configured, uploadToR2 } from "@/lib/r2";
import { buildHTML } from "@/lib/renderer/buildHTML";
import { renderPNG } from "@/lib/renderer/renderPNG";
import { normalizeTemplateJSON } from "@/lib/templateNormalization";
import { expandGroupIdsWithChildren } from "@/lib/groupLayout";
import { resolveSlotExcludeZones, resolveZone } from "@/lib/triggerAutoCaptionFromTranscription";
import { logActivity, type ActivityType } from "@/lib/services/slot/activity";
import { notifyUser } from "@/lib/sseStore";
import { POST_VALIDATION_STATUSES } from "@/lib/publications/constants";
import { slotEffectivePatternSelect, resolveSlotEffectivePattern } from "@/lib/services/slot/effectivePattern";
import { parsePatternCoverConfig, resolveCoverPreset } from "@/lib/publications/coverMode";
import { enrichListingWithEntityFields, loadRenderEntityContext } from "@/lib/renderer/enrichListingWithEntityFields";
import type { ListingData } from "@/types/listing";
import type { AnyBlock, CoverAutoConfig, ImageBlock, SchemaField, TemplateJSON, TextBlock, VideoBlock, VideoSequenceSlot } from "@/types/template";

const CAPTIONS_API = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";
const WEB_MEDIA_BASE = (process.env.FONT_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
const DEFAULT_FRAME_COUNT = 36;
// Au-delà, un job RunPod cover est considéré perdu par la réconciliation. Large
// à dessein : un job peut attendre en file derrière les renders.
const COVER_RUNPOD_STALL_MS = 90 * 60_000;
const MIN_FRAME_GAP_S = 1 / 30;

// Concurrence bornée sur le process unique (cf. lib/concurrency.ts).
// - Persistance des frames : chaque frame = fetch + upload R2 avec un buffer en
//   RAM. Sans borne, ~36 buffers/pack × M packs résident simultanément → pic RAM
//   → OOM-restart. On plafonne le nombre de frames traitées en parallèle.
const FRAME_PERSIST_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.COVER_FRAME_PERSIST_CONCURRENCY ?? "", 10) || 6,
);
// - Préparation des packs. Sur le chemin LOCAL, une prep déclenche une extraction
//   sur le render-engine du VPS plus le fan-out de frames ci-dessus : sans borne,
//   M packs lancés d'un coup saturent le CPU et la RAM. Sur le chemin RunPod, elle
//   ne fait plus qu'un calcul DB et une soumission de quelques millisecondes — y
//   garder une borne à 2 sérialiserait la file pour rien, ce qui est précisément ce
//   qu'on cherche à supprimer. D'où deux défauts, la borne restant réglable.
const coverPrepLimiter = createLimiter(
  Math.max(
    1,
    Number.parseInt(process.env.COVER_PREP_CONCURRENCY ?? "", 10) ||
      (runpodConfigured() && process.env.USE_RUNPOD !== "false" ? 8 : 2),
  ),
);

type ExtractedFrame = {
  /** Position réelle de la frame extraite (c'est elle qui est stockée et affichée). */
  timestamp: number;
  /** Position demandée, présente uniquement quand le render-engine a dû se replier
   *  légèrement en arrière. Sert à retrouver le pick d'origine (provenance slot). */
  requestedTimestamp?: number;
  url: string;
};
type FrameInterval = { start: number; end: number };
type CoverSeenFrame = number | { sourceUrl: string; timestamp: number };
type CoverFramePick = { sourceUrl: string; timestamp: number; slotId?: string; sequenceIndex?: number };
type CoverFrameSource = { slotId: string; sourceUrl: string; duration: number };

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Best-effort logActivity dédié au cycle cover. Avale les erreurs car le
 * pipeline cover ne doit jamais être bloqué par un problème de log.
 */
async function logCoverActivity(
  slotId: string | null | undefined,
  type: Extract<ActivityType, "COVER_QUEUED" | "COVER_READY" | "COVER_FAILED" | "COVER_CONFIG_ERROR">,
  payload?: Record<string, unknown>,
): Promise<void> {
  if (!slotId) return;
  try {
    await logActivity(prisma, { slotId, actorId: null, type, payload });
  } catch (err) {
    console.warn(`[coverAuto] logActivity(${type}) failed for slot=${slotId}:`, err);
  }
}

function normalizeFrameCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(72, Math.max(6, Math.round(value)))
    : DEFAULT_FRAME_COUNT;
}

type ProbeResult = { ok: true; duration: number } | { ok: false; reason: string };

/**
 * Probe la durée d'une vidéo via le render-engine (CAPTIONS_API).
 * Retourne un résultat structuré pour permettre au caller de propager la cause
 * d'échec (timeout, 5xx, durée invalide, etc.) dans le message d'erreur final.
 *
 * Retry exponentiel sur les causes potentiellement transient (timeout, 5xx,
 * erreur réseau). PAS de retry sur HTTP 4xx ni sur durée invalide (causes
 * permanentes côté upstream).
 */
async function probeDuration(videoUrl: string): Promise<ProbeResult> {
  if (!CAPTIONS_API) return { ok: false, reason: "CAPTIONS_API non configuré" };

  const attempts = 3;
  const backoffMs = [0, 500, 1500];
  let lastReason = "raison inconnue";

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (backoffMs[attempt] > 0) await new Promise((r) => setTimeout(r, backoffMs[attempt]));

    let retryable = false;
    try {
      const res = await fetch(`${CAPTIONS_API}/api/probe-duration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: videoUrl }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        lastReason = `CAPTIONS_API HTTP ${res.status}`;
        if (res.status >= 500) {
          retryable = true;
        } else {
          // 4xx → cause permanente côté URL/auth, pas de retry.
          console.warn(`[coverAuto] probe duration HTTP ${res.status} for ${videoUrl} (no retry)`);
          return { ok: false, reason: lastReason };
        }
      } else {
        const data = await res.json() as { duration?: number | null };
        if (typeof data.duration === "number" && data.duration > 0) {
          return { ok: true, duration: data.duration };
        }
        // Durée absente/invalide → upstream a répondu mais sans donnée exploitable.
        // Pas de retry (réponse 200 OK = pas transient).
        lastReason = "durée invalide dans la réponse du render-engine";
        console.warn(`[coverAuto] probe duration invalid response for ${videoUrl}:`, data);
        return { ok: false, reason: lastReason };
      }
    } catch (err) {
      const isTimeout = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
      lastReason = isTimeout
        ? "CAPTIONS_API timeout (60s)"
        : `erreur réseau: ${err instanceof Error ? err.message : String(err)}`;
      retryable = true;
      console.warn(`[coverAuto] probe attempt ${attempt + 1}/${attempts} failed for ${videoUrl}: ${lastReason}`);
    }

    if (!retryable) break;
  }

  return { ok: false, reason: lastReason };
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
    for (let seqIdx = 0; seqIdx < sources.length; seqIdx += 1) {
      const source = sources[seqIdx]!;
      const sourceFrameCount = Math.floor(source.duration / MIN_FRAME_GAP_S);
      for (let index = 0; index < sourceFrameCount; index += 1) {
        const timestamp = Math.round((((index + 0.5) * source.duration) / sourceFrameCount) * 1000) / 1000;
        if (!seenValues.has(`${source.sourceUrl}::${timestamp}`)) {
          candidates.push({ sourceUrl: source.sourceUrl, timestamp, slotId: source.slotId, sequenceIndex: seqIdx });
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
    .map((zone) => resolveZone(zone, template.blocks ?? [], template.groups ?? []))
    .filter((zone): zone is NonNullable<typeof zone> => zone !== null);
  const slotZones =
    config.excludeSlotIds?.length && template.videoSequence?.length
      ? resolveSlotExcludeZones(config.excludeSlotIds, template.videoSequence, duration, slotDurations)
      : [];
  const intervals = subtractZones(duration, [...blockZones, ...slotZones]);
  return pickTimestamps(intervals, count, seen);
}

/** Erreur d'extraction portant le statut HTTP, pour décider de retenter ou non. */
class ExtractFramesError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = "ExtractFramesError";
  }
}

function envInt(name: string, fallback: number, min: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

// Un pack demande typiquement 36 frames. Les envoyer en une seule requête faisait
// dépendre TOUT le pack d'un seul appel de plusieurs minutes : sur des rushs 4K
// HLG, le tonemap par frame suffit à dépasser n'importe quel budget raisonnable,
// et le `headersTimeout` interne d'undici (300 s, non configurable sans passer
// par un dispatcher) plafonne de toute façon la durée d'un fetch.
// On découpe donc en lots courts. Chaque lot est indépendant : un lot trop lent
// coûte ses frames, pas le pack entier.
const EXTRACT_FRAMES_BATCH_SIZE = envInt("COVER_EXTRACT_BATCH_SIZE", 8, 1);
// Le PREMIER lot paie le téléchargement de la source par le render-engine (un
// rush peut peser plusieurs centaines de Mo) — il lui faut un budget nettement
// plus large que les suivants, qui tapent dans le cache disque de l'engine.
const EXTRACT_FRAMES_WARMUP_TIMEOUT_MS = envInt("COVER_EXTRACT_WARMUP_TIMEOUT_MS", 240_000, 10_000);
const EXTRACT_FRAMES_BATCH_TIMEOUT_MS = envInt("COVER_EXTRACT_BATCH_TIMEOUT_MS", 90_000, 10_000);

async function extractFramesBatch(
  videoUrl: string,
  timestamps: number[],
  timeoutMs: number,
): Promise<ExtractedFrame[]> {
  return withRetryIf(
    `extract-covers:${timestamps.length}ts`,
    async () => {
      const form = new FormData();
      form.append("video_url", videoUrl);
      form.append("timestamps_json", JSON.stringify(timestamps));
      let res: Response;
      try {
        res = await fetch(`${CAPTIONS_API}/api/extract-covers`, {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const isTimeout = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
        throw new ExtractFramesError(
          isTimeout
            ? `pas de réponse du render-engine en ${Math.round(timeoutMs / 1000)}s`
            : `render-engine injoignable : ${err instanceof Error ? err.message : String(err)}`,
          null,
        );
      }
      if (!res.ok) {
        throw new ExtractFramesError(
          `Extraction frames échouée (${res.status}) : ${await readEngineError(res)}`,
          res.status,
        );
      }
      return await res.json() as ExtractedFrame[];
    },
    // 422 = échec déterministe (source illisible) : inutile de retenter.
    // Un timeout, lui, mérite UNE reprise : l'engine poursuit son travail après
    // notre abandon, la source est donc en cache et la reprise est rapide.
    (err) => !(err instanceof ExtractFramesError) || err.status === null || err.status >= 500,
    [2000],
  );
}

async function extractFrames(videoUrl: string, timestamps: number[]): Promise<ExtractedFrame[]> {
  const frames: ExtractedFrame[] = [];
  const failures: string[] = [];

  for (let offset = 0; offset < timestamps.length; offset += EXTRACT_FRAMES_BATCH_SIZE) {
    const batch = timestamps.slice(offset, offset + EXTRACT_FRAMES_BATCH_SIZE);
    const isFirst = offset === 0;
    try {
      frames.push(
        ...(await extractFramesBatch(
          videoUrl,
          batch,
          isFirst ? EXTRACT_FRAMES_WARMUP_TIMEOUT_MS : EXTRACT_FRAMES_BATCH_TIMEOUT_MS,
        )),
      );
    } catch (err) {
      // Un lot perdu coûte ses frames, pas le pack : mieux vaut 28 candidats que
      // zéro. On ne remonte l'erreur que si AUCUN lot n'a rien donné.
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (frames.length === 0 && failures.length > 0) {
    throw new ExtractFramesError(failures[0], null);
  }
  if (failures.length > 0) {
    console.warn(
      `[coverAuto] extraction partielle : ${frames.length}/${timestamps.length} frames, ` +
        `${failures.length} lot(s) perdu(s) — ${failures[0]}`,
    );
  }
  return frames;
}

/** Lit le `detail` d'une erreur FastAPI plutôt que d'exposer le JSON brut. */
async function readEngineError(res: Response): Promise<string> {
  const raw = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(raw) as { detail?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
  } catch { /* corps non-JSON */ }
  return raw.slice(0, 300);
}

/**
 * Libellé court et sûr d'une source de frames, pour les messages d'erreur
 * remontés jusqu'à l'UI : uniquement le nom de fichier (jamais l'hôte, le
 * chemin local ni la query string d'une URL présignée).
 */
function describeCoverSource(picks: CoverFramePick[], sourceUrl: string): string {
  const slotId = picks.find((pick) => pick.slotId)?.slotId;
  let name = sourceUrl;
  try {
    name = decodeURIComponent(new URL(sourceUrl).pathname.split("/").pop() || sourceUrl);
  } catch {
    name = sourceUrl.split("?")[0]?.split("/").pop() || sourceUrl;
  }
  if (name.length > 60) name = `${name.slice(0, 57)}…`;
  return slotId ? `${name} (slot ${slotId})` : name;
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
  // Phase 2.5 — si includeSlotIds est fourni, prend le pas (mode "uniquement
  // ces clips"). Sinon on tombe sur le mode historique exclude.
  const slotFilter = (slot: { id: string }) => {
    const includes = config.includeSlotIds ?? [];
    if (includes.length > 0) return includes.includes(slot.id);
    return !(config.excludeSlotIds ?? []).includes(slot.id);
  };
  const sourceKeys = slots.length > 0
    ? slots.filter(slotFilter).map((slot) => slot.id)
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
    ? slots.filter(slotFilter).map((slot) => ({
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
    let probedDuration: number | null = null;
    if (typeof assetDuration === "number" && assetDuration > 0) {
      probedDuration = assetDuration;
    } else {
      const probe = await probeDuration(sourceUrl);
      if (probe.ok) probedDuration = probe.duration;
      else console.warn(`[coverAuto] Durée rush introuvable pour source=${sourceItem.id} url=${sourceUrl}: ${probe.reason}`);
    }
    if (!probedDuration) continue;
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

/**
 * Rapatrie une frame depuis le render-engine et la pousse sur R2 sous la clé du
 * candidat. La clé vient de l'appelant (et non d'un index) pour rester identique
 * à celle qu'aurait produite le worker RunPod : les deux chemins écrivent au même
 * endroit, et `deleteCoverPackAssets` les purge de la même façon.
 */
async function persistFrame(frame: ExtractedFrame, key: string): Promise<{ imageUrl: string; imageKey: string | null }> {
  const sourceUrl = frame.url.startsWith("http")
    ? frame.url
    : `${CAPTIONS_API}${frame.url.startsWith("/") ? frame.url : `/${frame.url}`}`;

  if (!r2Configured()) {
    return {
      imageUrl: toBrowserMediaUrl(sourceUrl),
      imageKey: null,
    };
  }

  // Retry : le fetch de la frame depuis le render-engine n'en avait aucun, alors
  // que l'upload R2 juste en dessous en a 4. Un hoquet réseau sur une seule frame
  // faisait tomber tout le pack.
  const buffer = await withRetry(`cover-frame:${frame.timestamp}`, async () => {
    const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Frame ${frame.timestamp}s introuvable (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }, [500, 1500]);
  const uploaded = await uploadToR2(key, buffer, "image/jpeg", buffer.byteLength);
  return { imageUrl: uploaded.url, imageKey: uploaded.key };
}

/**
 * Purge TOUT le préfixe R2 d'un pack (`covers/{userId}/{packId}/`) : candidats,
 * y compris ceux dont la ligne DB n'a jamais été créée, et `final.png`.
 *
 * À n'utiliser que sur les chemins qui repartent de zéro (regenerate, re-trigger
 * depuis un render) — jamais après avoir écrit une cover finale, puisqu'elle vit
 * sous le même préfixe. Le nettoyage ciblé des seuls candidats reste
 * `deleteCoverCandidateAssets`.
 */
export async function deleteCoverPackAssets(packId: string): Promise<void> {
  if (!r2Configured()) return;
  const pack = await prisma.coverFramePack.findUnique({
    where: { id: packId },
    select: { userId: true },
  });
  if (!pack) return;
  try {
    await deleteR2Prefix(`covers/${pack.userId}/${packId}/`);
  } catch (err) {
    console.warn(`[coverAuto] R2 prefix cleanup failed for pack=${packId}:`, err);
  }
}

/**
 * Supprime les seuls objets R2 référencés par les CoverFrameCandidate en base.
 * Sûr après l'écriture d'une cover finale (elle n'est pas référencée ici).
 */
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

/** Un pick dont la ligne `CoverFrameCandidate` existe déjà, encore sans image. */
type PlannedPick = CoverFramePick & { candidateId: string };

/**
 * Tout ce qu'il faut pour extraire — calculé côté web, où vit l'accès Postgres.
 * Le reste (télécharger, ffmpeg, uploader) est du calcul pur, déportable.
 */
export interface CoverExtractionPlan {
  packId: string;
  userId: string;
  slotId: string | null;
  attempt: number;
  duration: number;
  /** true = frames tirées des rushs natifs ; false = source unique (repli). */
  native: boolean;
  /** Préfixe R2 des candidats de CE tirage. */
  keyPrefix: string;
  picksBySource: Map<string, PlannedPick[]>;
}

/** Résultat d'extraction, quelle que soit sa provenance (worker ou local). */
export interface CoverFrameOutcome {
  candidateId: string;
  timestamp: number;
  imageUrl: string;
  imageKey: string | null;
}

/**
 * Calcule le plan d'extraction et matérialise les candidats en base.
 *
 * Les `CoverFrameCandidate` sont créés AVANT l'extraction, sans image. C'est ce
 * qui permet au webhook RunPod — qui arrive dans un autre process, plus tard — de
 * retrouver la provenance de chaque frame (`slotId`, `sequenceIndex`, `sourceUrl`)
 * sans qu'on ait à sérialiser un snapshot opaque, et de donner à chaque frame une
 * clé R2 déterministe. Deux picks au même timestamp (deux slots alimentés par le
 * même rush) restent deux lignes distinctes, donc deux objets distincts.
 *
 * Retourne `null` quand le pack a déjà été mené à un état terminal (config cover
 * désactivée, template manquant) — rien à extraire.
 */
async function planCoverFrameExtraction(packId: string): Promise<CoverExtractionPlan | null> {
  const pack = await prisma.coverFramePack.findUnique({
    where: { id: packId },
    include: {
      template: true,
      // Phase 5 : render est nullable (slots one-off → publicationVersion).
      // Si render est null, on utilise publicationVersion pour récupérer le slotId.
      render: {
        select: {
          usedAssets: true,
          slotDurations: true,
          listing: { select: { jsonData: true } },
          publicationSlot: { select: { id: true } },
        },
      },
      publicationVersion: {
        select: { slot: { select: { id: true } } },
      },
    },
  });
  // Fix bug audit 2026-05-30 (H4) : si pack/template/sourceVideoUrl manquant,
  // anciennement on faisait `return` sans update → pack restait en QUEUED
  // indéfiniment. Désormais on bascule en FAILED avec errorMsg explicite.
  if (!pack) {
    console.warn(`[coverAuto] Pack introuvable: ${packId}`);
    return null;
  }
  if (!pack.template || !pack.sourceVideoUrl) {
    const errorMsg = !pack.template
      ? "Template introuvable pour ce pack."
      : "Vidéo source manquante pour l'extraction des frames.";
    await failCoverFramePack(packId, null, errorMsg);
    return null;
  }

  // slotId : priorité render → fallback publicationVersion (slot one-off)
  const slotId =
    pack.render?.publicationSlot?.id ??
    pack.publicationVersion?.slot?.id ??
    null;

  let slotDurations: Record<string, number> | undefined;
  if (pack.render?.slotDurations) {
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
  notifyUser(pack.userId, { jobType: "cover", jobId: packId, status: "PROCESSING" });

  const templateJson = normalizeTemplateJSON(JSON.parse(pack.template.jsonData) as TemplateJSON);
  const config = safeJson<CoverAutoConfig>(pack.config, { enabled: false, excludeZones: [] });
  // Fix bug audit 2026-05-30 (H4 bis) : si config désactivé, on était passé en
  // PROCESSING sans revenir → pack bloqué. Désormais FAILED, état visible.
  if (!config.enabled) {
    await failCoverFramePack(packId, null, "Configuration cover désactivée sur ce template.", slotId);
    return null;
  }

  const frameCount = normalizeFrameCount(config.frameCount ?? pack.frameCount);
  const seen = normalizeSeenFrames(safeJson<CoverSeenFrame[]>(pack.usedTimestamps, []));
  const nativeSources = await resolveNativeCoverSources(
    templateJson,
    config,
    pack.render?.usedAssets ?? null,
    pack.render?.listing?.jsonData ?? null,
  );

  let duration = pack.duration;
  let framePicks: CoverFramePick[] = [];
  const native = nativeSources.length > 0;

  if (native) {
    duration = nativeSources.reduce((sum, source) => sum + source.duration, 0);
    framePicks = pickNativeFrames(nativeSources, frameCount, seen.nativeKeys);
  } else {
    // Fallback 1 : sommer Render.slotDurations si dispo (couvre les renders
    // sequence pour lesquels resolveNativeCoverSources est vide pour d'autres
    // raisons — ex. excludeZones qui masquent tout).
    if (!duration && pack.render?.slotDurations) {
      try {
        const slotDurMap = JSON.parse(pack.render.slotDurations) as Record<string, number>;
        const sumSlot = Object.values(slotDurMap).reduce(
          (s, v) => s + (typeof v === "number" && v > 0 ? v : 0),
          0,
        );
        if (sumSlot > 0) duration = sumSlot;
      } catch { /* JSON invalide, on continue vers probe */ }
    }

    // Fallback 2 : probe la durée via le render-engine.
    let probeReason: string | null = null;
    if (!duration) {
      const probe = await probeDuration(pack.sourceVideoUrl);
      if (probe.ok) duration = probe.duration;
      else probeReason = probe.reason;
    }
    if (!duration) {
      throw new Error(`Durée vidéo introuvable pour préparer les frames cover${probeReason ? ` (${probeReason})` : ""}`);
    }

    const timestamps = resolveCoverTimestamps(templateJson, config, duration, frameCount, seen.finalTimestamps, slotDurations);
    framePicks = timestamps.map((timestamp) => ({ sourceUrl: pack.sourceVideoUrl!, timestamp }));
  }

  if (!duration) throw new Error("Durée vidéo introuvable pour préparer les frames cover");
  if (framePicks.length === 0) {
    throw new Error("Aucune frame disponible après application des zones exclues");
  }

  // Matérialisation des candidats — sans image pour l'instant.
  const created = await prisma.$transaction(
    framePicks.map((pick) =>
      prisma.coverFrameCandidate.create({
        data: {
          packId,
          timestamp: pick.timestamp,
          imageUrl: null,
          // sourceUrl seulement en mode natif : en source unique, `usedTimestamps`
          // s'écrit en nombres nus (cf. normalizeSeenFrames).
          sourceUrl: native ? pick.sourceUrl : null,
          slotId: pick.slotId ?? null,
          sequenceIndex: pick.sequenceIndex ?? null,
        },
        select: { id: true },
      }),
    ),
  );

  const picksBySource = new Map<string, PlannedPick[]>();
  framePicks.forEach((pick, index) => {
    const planned: PlannedPick = { ...pick, candidateId: created[index].id };
    const arr = picksBySource.get(pick.sourceUrl) ?? [];
    arr.push(planned);
    picksBySource.set(pick.sourceUrl, arr);
  });

  await prisma.coverFramePack.update({ where: { id: packId }, data: { duration } });

  return {
    packId,
    userId: pack.userId,
    slotId,
    attempt: pack.extractAttempt,
    duration,
    native,
    keyPrefix: `covers/${pack.userId}/${packId}/a${pack.extractAttempt}/`,
    picksBySource,
  };
}

/**
 * Chemin de repli : extraction par le render-engine du VPS, puis upload R2 depuis
 * Node. C'est l'ancien comportement, conservé pour le développement local et pour
 * les packs dont les sources ne sont pas joignables depuis l'extérieur.
 */
async function extractCoverFramesLocally(plan: CoverExtractionPlan): Promise<CoverFrameOutcome[]> {
  const outcomes: CoverFrameOutcome[] = [];
  const failedSources: string[] = [];

  // On itère sur picksBySource et NON sur les sources : deux slots alimentés par le
  // même rush partagent la même URL, et boucler sur les sources extrairait deux fois
  // le tableau fusionné de picks.
  for (const [sourceUrl, sourcePicks] of plan.picksBySource) {
    if (sourcePicks.length === 0) continue;
    try {
      const frames = await extractFrames(sourceUrl, sourcePicks.map((pick) => pick.timestamp));
      if (frames.length === 0) {
        failedSources.push(`${describeCoverSource(sourcePicks, sourceUrl)} : aucune frame extraite`);
        continue;
      }
      // Persistance tolérante : une frame qui refuse de se télécharger ou de monter
      // sur R2 ne doit pas annuler les autres.
      const persisted = await mapWithConcurrencySettled(frames, FRAME_PERSIST_CONCURRENCY, async (frame) => {
        // On matche sur la position DEMANDÉE quand le render-engine s'est replié :
        // la tolérance (0,6 × 1/30 s) est bien plus fine que le décalage du repli.
        const requested = frame.requestedTimestamp ?? frame.timestamp;
        const pick =
          sourcePicks.find((p) => Math.abs(p.timestamp - requested) < MIN_FRAME_GAP_S * 0.6) ?? sourcePicks[0];
        const stored = await persistFrame(frame, `${plan.keyPrefix}${pick.candidateId}.jpg`);
        return { candidateId: pick.candidateId, timestamp: frame.timestamp, ...stored };
      });
      outcomes.push(...persisted.flatMap((result) => (result.ok ? [result.value] : [])));
      const errors = persisted.flatMap((result) => (result.ok ? [] : [result.error]));
      if (errors.length > 0) {
        console.warn(`[coverAuto] pack=${plan.packId} ${errors.length} frame(s) non persistée(s) :`, errors);
      }
    } catch (err) {
      // Tolérance par source : un rush illisible, un téléchargement qui tombe ou un
      // timeout ne doit pas faire tomber le pack entier.
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[coverAuto] pack=${plan.packId} source=${sourceUrl} extraction échouée : ${reason}`);
      failedSources.push(`${describeCoverSource(sourcePicks, sourceUrl)} : ${reason}`);
    }
  }

  if (outcomes.length === 0) {
    throw new Error(
      failedSources.length > 0
        ? `Le render-engine n'a extrait aucune frame — ${failedSources.join(" ; ")}`
        : "Le render-engine n'a extrait aucune frame",
    );
  }
  if (failedSources.length > 0) {
    console.warn(
      `[coverAuto] pack=${plan.packId} extraction partielle : ${outcomes.length} frames, ` +
        `${failedSources.length} source(s) en échec — ${failedSources.join(" ; ")}`,
    );
  }
  return outcomes;
}

/**
 * Finalise un pack à partir des frames obtenues — appelée par le webhook RunPod
 * comme par le chemin local, pour qu'il n'existe qu'un seul code de finalisation.
 *
 * `attempt` protège des webhooks périmés : un pack remis à zéro entre-temps a vu
 * son `extractAttempt` incrémenté, et le résultat de l'ancien job est ignoré.
 */
export async function applyCoverFrameResults(
  packId: string,
  attempt: number | null,
  frames: CoverFrameOutcome[],
): Promise<"applied" | "stale" | "unknown"> {
  const pack = await prisma.coverFramePack.findUnique({
    where: { id: packId },
    select: {
      id: true, userId: true, extractAttempt: true, status: true, usedTimestamps: true,
      render: { select: { publicationSlot: { select: { id: true } } } },
      publicationVersion: { select: { slot: { select: { id: true } } } },
    },
  });
  if (!pack) return "unknown";
  if (attempt !== null && pack.extractAttempt !== attempt) {
    console.warn(
      `[coverAuto] résultat périmé ignoré pour pack=${packId} (tentative ${attempt}, courante ${pack.extractAttempt})`,
    );
    return "stale";
  }
  // Un pack QUEUED attend une NOUVELLE soumission, pas le résultat d'une ancienne.
  if (pack.status !== "PROCESSING") {
    console.warn(`[coverAuto] résultat ignoré pour pack=${packId} en statut ${pack.status}`);
    return "stale";
  }

  await prisma.$transaction(
    frames.map((frame) =>
      prisma.coverFrameCandidate.updateMany({
        // Le packId est une garde : un id de candidat forgé ne peut pas viser un autre pack.
        where: { id: frame.candidateId, packId },
        data: { imageUrl: frame.imageUrl, imageKey: frame.imageKey, timestamp: frame.timestamp },
      }),
    ),
  );
  // Les picks jamais servis sont supprimés : ils ne doivent ni apparaître dans le
  // picker, ni compter comme « déjà vus » au tirage suivant.
  await prisma.coverFrameCandidate.deleteMany({ where: { packId, imageUrl: null } });

  const served = await prisma.coverFrameCandidate.findMany({
    where: { packId },
    select: { timestamp: true, sourceUrl: true },
  });
  const seenEntries: CoverSeenFrame[] = served.map((row) =>
    row.sourceUrl ? { sourceUrl: row.sourceUrl, timestamp: row.timestamp } : row.timestamp,
  );

  await prisma.coverFramePack.update({
    where: { id: packId },
    data: {
      status: "READY",
      usedTimestamps: JSON.stringify([
        ...safeJson<CoverSeenFrame[]>(pack.usedTimestamps, []),
        ...seenEntries,
      ]),
      errorMsg: null,
      runpodJobId: null,
    },
  });

  const slotId = pack.render?.publicationSlot?.id ?? pack.publicationVersion?.slot?.id ?? null;
  notifyUser(pack.userId, { jobType: "cover", jobId: packId, status: "READY", frameCount: served.length });
  await logCoverActivity(slotId, "COVER_READY", { coverFramePackId: packId, frameCount: served.length });
  return "applied";
}

/** Bascule un pack en échec — chemin unique pour le local, le dispatch et le webhook. */
export async function failCoverFramePack(
  packId: string,
  attempt: number | null,
  errorMsg: string,
  knownSlotId?: string | null,
): Promise<void> {
  const pack = await prisma.coverFramePack.findUnique({
    where: { id: packId },
    select: {
      userId: true, extractAttempt: true,
      render: { select: { publicationSlot: { select: { id: true } } } },
      publicationVersion: { select: { slot: { select: { id: true } } } },
    },
  });
  if (!pack) return;
  if (attempt !== null && pack.extractAttempt !== attempt) return;

  // Les candidats créés à la planification n'ont jamais reçu d'image : les laisser
  // afficherait des vignettes vides dans le picker, et ils compteraient à tort au
  // tirage suivant.
  await prisma.coverFrameCandidate
    .deleteMany({ where: { packId, imageUrl: null } })
    .catch((err) => console.warn(`[coverAuto] purge des candidats vides échouée pack=${packId}:`, err));

  await prisma.coverFramePack
    .update({ where: { id: packId }, data: { status: "FAILED", errorMsg, runpodJobId: null } })
    .catch((err) => console.error(`[coverAuto] Échec update FAILED pour pack=${packId}:`, err));
  notifyUser(pack.userId, { jobType: "cover", jobId: packId, status: "FAILED", errorMsg });
  const slotId =
    knownSlotId ?? pack.render?.publicationSlot?.id ?? pack.publicationVersion?.slot?.id ?? null;
  await logCoverActivity(slotId, "COVER_FAILED", { coverFramePackId: packId, errorMsg });
}

/**
 * Le déport RunPod suppose que le worker puisse ATTEINDRE les sources. Ce n'est
 * pas toujours vrai : sur les pipelines locaux, `Render.videoUrl` (et donc
 * `CoverFramePack.sourceVideoUrl`) vaut `${CAPTIONS_API}/outputs/...`, une adresse
 * qui n'existe que sur le VPS — et c'est persisté en base, donc ça rejoue à chaque
 * « Refaire un tirage ». Dans ce cas on extrait en local plutôt que d'échouer.
 */
function coverSourcesArePubliclyReachable(plan: CoverExtractionPlan): boolean {
  return [...plan.picksBySource.keys()].every((url) => /^https?:\/\//i.test(url));
}

async function dispatchCoverFramesToRunpod(plan: CoverExtractionPlan): Promise<void> {
  const payload = {
    input: {
      job_type: "cover_frames",
      pack_id: plan.packId,
      attempt: plan.attempt,
      key_prefix: plan.keyPrefix,
      sources: [...plan.picksBySource.entries()].map(([sourceUrl, picks]) => ({
        source_url: sourceUrl,
        frames: picks.map((pick) => ({ id: pick.candidateId, timestamp: pick.timestamp })),
      })),
    },
    ...(getRunpodWebhookUrl("/api/webhooks/runpod/cover-frames")
      ? { webhook: getRunpodWebhookUrl("/api/webhooks/runpod/cover-frames") }
      : {}),
  };

  const data = await submitRunpodJob<{ id: string }>(
    process.env.RUNPOD_ENDPOINT_ID!,
    process.env.RUNPOD_API_KEY!,
    payload,
    // Jamais le pod : il n'a qu'une GPU et un Semaphore(1). Une extraction de JPEG
    // y bloquerait un render ou une transcription — voir SubmitRunpodJobOptions.
    { serverlessOnly: true },
  );

  await prisma.coverFramePack.update({
    where: { id: plan.packId },
    data: { runpodJobId: data.id, dispatchedAt: new Date() },
  });
  console.info(
    `[coverAuto] pack=${plan.packId} tentative=${plan.attempt} soumis à RunPod (job=${data.id}, ` +
      `${plan.picksBySource.size} source(s))`,
  );
}

export async function prepareCoverFramePack(packId: string): Promise<void> {
  let plan: CoverExtractionPlan | null = null;
  try {
    plan = await planCoverFrameExtraction(packId);
    if (!plan) return;

    if (
      process.env.USE_RUNPOD !== "false" &&
      runpodConfigured() &&
      coverSourcesArePubliclyReachable(plan)
    ) {
      // Le webhook prend le relais : la préparation s'arrête ici.
      await dispatchCoverFramesToRunpod(plan);
      return;
    }

    const frames = await extractCoverFramesLocally(plan);
    await applyCoverFrameResults(plan.packId, plan.attempt, frames);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await failCoverFramePack(packId, plan?.attempt ?? null, errorMsg, plan?.slotId);
    throw err;
  }
}

/**
 * Rattrape les packs dont le job RunPod est parti mais dont le webhook n'est
 * jamais revenu (worker tué, réseau, NEXTAUTH_URL invalide).
 *
 * On interroge RunPod plutôt que de conclure sur un simple délai : un job peut
 * légitimement attendre en file bien plus longtemps que nos seuils, et le déclarer
 * mort à l'aveugle ferait perdre un travail déjà payé. Appelée par le cron, jamais
 * par le GET que l'UI poll toutes les 3 secondes.
 *
 * Les jobs dispatchés sur pod (`pod-…`) ne sont pas pollables : `resolveRunpodJobPhase`
 * les signale et on les laisse au seuil temporel. En pratique les covers ne passent
 * jamais par le pod (voir `dispatchCoverFramesToRunpod`).
 */
export async function reconcileDispatchedCoverPacks(): Promise<{ checked: number; failed: number }> {
  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!endpointId || !apiKey) return { checked: 0, failed: 0 };

  const packs = await prisma.coverFramePack.findMany({
    where: { status: "PROCESSING", runpodJobId: { not: null } },
    select: { id: true, runpodJobId: true, extractAttempt: true, dispatchedAt: true, updatedAt: true },
    take: 50,
  });

  let failed = 0;
  for (const pack of packs) {
    try {
      const phase = await resolveRunpodJobPhase(
        endpointId,
        apiKey,
        pack.runpodJobId!,
        pack.dispatchedAt ?? pack.updatedAt,
        COVER_RUNPOD_STALL_MS,
      );
      if (phase.phase === "in_progress") continue;
      if (phase.phase === "completed") {
        // Le webhook s'est perdu mais le job a bien tourné. On ne peut pas rejouer
        // son output ici sans dupliquer la logique du webhook : on marque en échec
        // avec un message actionnable plutôt que de laisser le pack en PROCESSING.
        await failCoverFramePack(
          pack.id,
          pack.extractAttempt,
          "Le job d'extraction s'est terminé mais sa notification s'est perdue. Relance l'extraction.",
        );
      } else if (phase.phase === "failed") {
        await failCoverFramePack(pack.id, pack.extractAttempt, `Extraction échouée — ${phase.error}`);
      } else if (phase.phase === "stalled") {
        await failCoverFramePack(pack.id, pack.extractAttempt, "Le job d'extraction n'a plus donné signe de vie.");
      } else {
        continue; // unreachable : RunPod injoignable, on retentera au prochain passage
      }
      failed += 1;
    } catch (err) {
      console.warn(`[coverAuto] réconciliation impossible pour pack=${pack.id}:`, err);
    }
  }
  return { checked: packs.length, failed };
}

export function queueCoverFramePackPreparation(packId: string): void {
  // Passe par le limiteur global : au plus COVER_PREP_CONCURRENCY packs préparés
  // en parallèle. Les autres attendent en file (restent QUEUED côté DB/UI).
  void coverPrepLimiter(() => prepareCoverFramePack(packId)).catch((err) => {
    console.error(`[coverAuto] Préparation pack=${packId} échouée : ${String(err)}`);
  });
}

export async function triggerAutoCoverPackForRender(
  renderId: string,
  templateId: string | null | undefined,
  sourceVideoUrl: string,
  userId: string,
): Promise<void> {
  if (!templateId) {
    console.info(`[autoCover] skip render=${renderId} reason=no_templateId`);
    return;
  }
  if (!sourceVideoUrl) {
    console.info(`[autoCover] skip render=${renderId} reason=no_sourceVideoUrl`);
    return;
  }

  const templateExists = await prisma.template.findUnique({ where: { id: templateId }, select: { id: true } });
  if (!templateExists) {
    console.info(`[autoCover] skip render=${renderId} reason=template_not_found template=${templateId}`);
    return;
  }

  // Lire Pattern.coverConfig — source de vérité Phase 1.8 (template.coverAutoConfig supprimé)
  // + slot.id pour pouvoir logger les activities cover sur la fiche.
  // + slot.status + needsClientValidation pour la garde "post-validation" (2026-05-30).
  const renderSlot = await prisma.render.findUnique({
    where: { id: renderId },
    select: {
      publicationSlot: {
        select: {
          id: true,
          status: true,
          needsClientValidationOverride: true,
          // patternBindingId pour la traçabilité (logActivity) — la forme
          // résolue n'expose pas d'id.
          patternBindingId: true,
          // Binding (recette par compte) + template global — voir effectivePattern.ts.
          ...slotEffectivePatternSelect,
        },
      },
    },
  });
  const slotId = renderSlot?.publicationSlot?.id ?? null;
  const slotStatus = renderSlot?.publicationSlot?.status ?? null;
  const slotPattern = renderSlot?.publicationSlot
    ? resolveSlotEffectivePattern(renderSlot.publicationSlot)
    : undefined;

  if (slotPattern?.coverMode !== "autoPack") {
    console.info(`[autoCover] skip render=${renderId} slot=${slotId ?? "?"} reason=coverMode_not_autoPack value=${slotPattern?.coverMode ?? "null"}`);
    return;
  }
  // coverConfig null/absent N'EST PAS bloquant : si la recette est en autoPack
  // mais sans preset choisi (ex. cover configurée sur la template APRÈS la
  // recette), on retombe sur le preset par défaut du template (fallback plus
  // bas). Avant : hard-fail `coverConfig_null` → incohérent avec le cas
  // `{enabled:true}` sans preset qui, lui, faisait déjà le fallback.

  // Garde "client en train de revoir" : si l'admin a manuellement envoyé le
  // slot au client (AWAITING_CLIENT ou CLIENT_REVISION), on diffère quoi qu'il
  // arrive — même si needsValidation=false. Cohérent avec la garde équivalente
  // dans triggerAutoDescriptionFromTranscription.
  if (slotStatus === "AWAITING_CLIENT" || slotStatus === "CLIENT_REVISION") {
    console.info(
      `[autoCover] skip render=${renderId} slot=${slotId} reason=client_review_in_flight status=${slotStatus}`,
    );
    return;
  }

  // Garde "post-validation client" (2026-05-30) : si le slot a une validation
  // client requise et n'est PAS encore validé (SCHEDULED ou aval), on skip le
  // déclenchement auto. Le job cover sera lancé manuellement quand le client
  // approuve via /api/validate/[token] (POST handler → triggerAutoCoverPackForRender).
  const needsValidation =
    renderSlot?.publicationSlot?.needsClientValidationOverride ??
    slotPattern.needsClientValidation ??
    false;
  if (needsValidation && slotStatus && !POST_VALIDATION_STATUSES.has(slotStatus)) {
    console.info(
      `[autoCover] skip render=${renderId} slot=${slotId} reason=awaiting_client_validation status=${slotStatus}`,
    );
    return;
  }

  // Phase 2.6 — résolution simplifiée : pattern.coverConfig.coverPresetId/Name
  // restent supportés (legacy), mais si absents on utilise le preset par défaut
  // (sortOrder min). Chaque template a maintenant 1 config cover unique
  // auto-créée dans le builder.
  const patternTemplateId = slotPattern.templateId ?? templateId;

  // enabled = true par défaut quand coverMode === autoPack. Le toggle pattern
  // a été retiré (redondant avec le mode). On n'arrête que si explicitement
  // false (legacy).
  if (!parsePatternCoverConfig(slotPattern.coverConfig).enabled) {
    console.info(
      `[autoCover] skip render=${renderId} slot=${slotId ?? "?"} reason=coverConfig_disabled (legacy explicit false)`,
    );
    return;
  }

  const preset = await resolveCoverPreset({ coverConfig: slotPattern.coverConfig, templateId: patternTemplateId });

  if (!preset) {
    console.warn(
      `[autoCover] Aucune config cover sur le template ${patternTemplateId} — skip`,
    );
    await logCoverActivity(slotId, "COVER_CONFIG_ERROR", {
      patternId: renderSlot?.publicationSlot?.patternBindingId ?? null,
      reason: "no_template_cover_config",
      templateId: patternTemplateId,
      message:
        "Aucune config cover sur le template. Ouvre le builder → onglet « Cover auto » pour l'activer.",
    });
    return;
  }

  const config = preset.config as unknown as CoverAutoConfig;
  if (!config?.enabled) return;

  // V7.6 — Garde unifiée slot-level. Avant : on vérifiait juste `renderId`,
  // mais un pack pouvait être créé en parallèle via `publicationVersionId`
  // (autoCoverTrigger.ts). 2 packs non-stale pour le même slot — divergence.
  // Désormais : findFirst sur les 2 FK + filtre non-stale. Si déjà un pack
  // actif pour ce slot, on skip.
  if (slotId) {
    const existingSlotPack = await prisma.coverFramePack.findFirst({
      where: {
        OR: [
          { render: { publicationSlotId: slotId } },
          { publicationVersion: { slotId } },
        ],
        staleSince: null,
      },
      select: { id: true },
    });
    if (existingSlotPack) {
      console.info(
        `[autoCover] Pack non-stale déjà existant (${existingSlotPack.id}) pour slot=${slotId} — skip render=${renderId}`,
      );
      return;
    }
  } else {
    // Fallback legacy : pas de slot (cas standalone très rare) → check renderId seul.
    const existing = await prisma.coverFramePack.findUnique({ where: { renderId } });
    if (existing) {
      console.info(`[autoCover] Pack déjà existant (${existing.id}) pour render=${renderId} — skip`);
      return;
    }
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

  await logCoverActivity(slotId, "COVER_QUEUED", {
    coverFramePackId: pack.id,
    presetId: preset.id,
    presetName: preset.name,
    frameCount,
  });

  queueCoverFramePackPreparation(pack.id);
  console.info(`[autoCover] Pack ${pack.id} lancé pour render=${renderId} (preset="${preset.name}" id=${preset.id})`);
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
  // Cocher un groupe parent inclut ses sous-groupes : `block.groupId` pointe
  // vers le groupe feuille, et `groups` doit rester cohérent avec les blocs
  // conservés (sinon buildHTML n'émet plus de data-layout-group-id et le bloc
  // n'est plus auto-layouté).
  const allowedGroups = expandGroupIdsWithChildren(overlayGroupIds, templateJson.groups);
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
  if (!pack?.render?.template) {
    // Phase 5 : packs créés sur publicationVersion (slot one-off sans render)
    // ne supportent pas encore le rendu final composite avec overlays + listing.
    // Le CM peut voir/sélectionner les frames mais pas générer la cover finale
    // ici — utiliser /tools/cover dédié pour le finaliser à la main.
    throw new Error(
      "Pack cover sans render lié — le rendu final compositionnel n'est pas encore supporté pour les slots one-off (Phase 5). Utiliser /tools/cover ou ajouter le support via une itération suivante.",
    );
  }
  const candidate = pack.candidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error("Frame candidate introuvable");
  // Les candidats existent avant leur image (ils portent la provenance et la clé
  // R2 dès la planification). Une ligne sans image n'a jamais été extraite : elle
  // ne peut pas servir de fond de cover.
  if (!candidate.imageUrl) throw new Error("Cette frame n'a pas encore été extraite");

  let templateJson = normalizeTemplateJSON(JSON.parse(pack.render.template.jsonData) as TemplateJSON);
  const rawListingData = safeJson<ListingData>(pack.render.listing.jsonData, {} as ListingData);
  const entityContext = await loadRenderEntityContext(pack.render.publicationSlotId);
  const listingData = enrichListingWithEntityFields(rawListingData, templateJson.schema ?? [], entityContext);
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
    select: {
      render: { select: { template: { select: { jsonData: true } } } },
      template: { select: { jsonData: true } }, // fallback pour packs one-off
    },
  });
  try {
    // Priorité render.template, fallback pack.template (slots one-off)
    const jsonData = pack?.render?.template?.jsonData ?? pack?.template?.jsonData ?? "{}";
    const tpl = JSON.parse(jsonData) as { canvas?: { width?: number; height?: number } };
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
  if (!pack?.render?.template) {
    // Phase 5 : pas encore supporté pour slots one-off (sans render).
    throw new Error(
      "Cover overlay preview non supportée pour les packs one-off (sans render lié).",
    );
  }

  let templateJson = normalizeTemplateJSON(JSON.parse(pack.render.template.jsonData) as TemplateJSON);
  const rawListingData = safeJson<ListingData>(pack.render.listing.jsonData, {} as ListingData);
  const entityContext = await loadRenderEntityContext(pack.render.publicationSlotId);
  const listingData = enrichListingWithEntityFields(rawListingData, templateJson.schema ?? [], entityContext);
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
  // Cocher un groupe parent inclut ses sous-groupes (cf. buildCoverTemplate).
  const allowedGroups = expandGroupIdsWithChildren(overlayGroupIds, templateJson.groups);
  const overlayTemplate: TemplateJSON = {
    ...templateJson,
    blocks: templateJson.blocks
      .filter((block) => block.groupId && allowedGroups.has(block.groupId))
      .filter((block) => block.type !== "video" && block.type !== "music"),
    groups: templateJson.groups.filter((group) => allowedGroups.has(group.id)),
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
