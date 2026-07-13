/**
 * POST /api/render/captions
 *
 * Deux modes selon le Content-Type :
 *
 * ── Mode presigned (JSON body, RunPod uniquement) ──────────────────────────
 * Corps JSON :
 *   { filename, ext, srtContent, srtFilename, config, previewMode, presetId? }
 * → Crée le CaptionJob (QUEUED) + retourne une URL PUT pré-signée pour la vidéo.
 *   { captionJobId, uploadUrl }
 * Le browser uploade la vidéo directement vers R2 puis appelle
 *   POST /api/render/captions/[id]/submit  pour soumettre le job à RunPod.
 *
 * ── Mode multipart (form-data, local ou fallback) ──────────────────────────
 * Corps multipart :
 *   video, subtitles, config, preview_mode, preset_id?
 * → Mode local  : forward vers render-engine, réponse synchrone.
 * → Mode RunPod : upload vidéo → soumet RunPod (legacy — préférer le mode presigned).
 *
 * Réponse 202 :
 *   { captionJobId, runpodJobId? }  ou  { captionJobId, uploadUrl }
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext, type UserContext } from "@/lib/userContext";
import { hasTool, TOOLS } from "@/lib/permissions";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { isCaptionCompatibleFontAsset, listFontAssetsByFamilies } from "@/lib/fontAssets";
import { normalizeCaptionConfig } from "@/lib/captionsEngine";
import { prisma } from "@/lib/prisma";
import { uploadToR2, deleteFromR2, r2Configured, createPresignedUploadUrl } from "@/lib/r2";
import { createMultipartUpload, createPresignedUploadPartUrl } from "@/lib/r2Multipart";
import { submitRunpodJob, runpodConfigured } from "@/lib/runpod";
import { getRunpodWebhookUrl } from "@/lib/webhooks/runpod";
import { onCaptionsCompleted } from "@/lib/services/slot/pipelineHooks";

/**
 * Vérifie qu'un slotId soumis par le client appartient bien à un slot
 * auquel l'utilisateur a accès. Sans ce check, un user authentifié pouvait
 * lier un CaptionJob à un slot tiers et injecter via le webhook une
 * activity STATUS_CHANGED + auto-transition CAPTIONS_COMPLETED sur ce
 * slot (IDOR via slot association).
 *
 * Retourne le slotId si OK, null si on doit refuser (caller renvoie 404).
 */
async function resolveSlotIdOrNull(
  slotId: string | undefined,
  userContext: UserContext,
): Promise<{ ok: true; slotId: string | null } | { ok: false }> {
  if (!slotId) return { ok: true, slotId: null };
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
      assigneeVideasteId: true,
    },
  });
  const role = toUserRole(userContext.effectiveUser.role);
  if (!slot || !canUserAccessSlot(slot, role, userContext.effectiveUser.id)) {
    return { ok: false };
  }
  return { ok: true, slotId: slot.id };
}

/**
 * Extrait la clé R2 depuis une URL publique R2 (convention `<publicUrl>/<key>`).
 * Retourne null si l'URL n'est pas parseable. Utilisé pour le fallback
 * auto_template (le slot n'a pas de currentVersion, juste un Render).
 */
function extractR2KeyFromVideoUrl(videoUrl: string): string | null {
  try {
    const u = new URL(videoUrl);
    return u.pathname.replace(/^\//, "") || null;
  } catch {
    return null;
  }
}

/**
 * Résout la vidéo source d'un slot déjà stockée en R2 (montage validé
 * `currentVersion`, sinon `render` fallback auto_template), pour y incruster
 * les sous-titres sans re-upload navigateur (mode `useSlotVideo`). Retourne la
 * clé R2 + un nom/ext dérivés, ou null si aucune vidéo source n'est disponible.
 */
async function resolveSlotSourceVideo(
  slotId: string,
): Promise<{ key: string; filename: string; ext: string } | null> {
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      currentVersion: { select: { r2Key: true, fileName: true } },
      render: { select: { videoUrl: true } },
    },
  });
  if (!slot) return null;

  const fromKey = (key: string, name?: string | null) => {
    const filename = name ?? key.split("/").pop() ?? "video.mp4";
    const ext = (key.split(".").pop() ?? "mp4").toLowerCase();
    return { key, filename, ext };
  };

  if (slot.currentVersion?.r2Key) {
    return fromKey(slot.currentVersion.r2Key, slot.currentVersion.fileName);
  }
  if (slot.render?.videoUrl) {
    const key = extractR2KeyFromVideoUrl(slot.render.videoUrl);
    if (key) return fromKey(key);
  }
  return null;
}

const RUNPOD_API_KEY    = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;
const USE_RUNPOD        = process.env.USE_RUNPOD !== "false";

type RunpodSubmitResponse = { id: string };

const VIDEO_EXTENSIONS = new Set([
  "mp4", "mov", "mkv", "webm", "avi", "m4v",
]);

/** Max SRT/subtitle content size stored in DB and sent to the worker. */
const MAX_SRT_BYTES = 512_000; // 512 KB

// Upload vidéo direct navigateur → R2. Au-delà de 100 Mo on passe en multipart :
// R2 refuse tout objet en PUT unique > 5 Go. Constantes alignées publications.
const MULTIPART_THRESHOLD = 100 * 1024 * 1024;   // 100 Mo
const PART_SIZE = 50 * 1024 * 1024;              // 50 Mo par partie
const PART_URL_EXPIRY_SECONDS = 6 * 60 * 60;     // 6h
const MAX_UPLOAD_SIZE = 20 * 1024 * 1024 * 1024; // 20 Go

function extractCaptionFontFamilies(configData: Record<string, unknown>): string[] {
  const baseFont = (configData.base as { font?: string } | undefined)?.font;
  const highlightFont = (configData.highlight as { font?: string } | undefined)?.font;
  const highlight2 = configData.highlight2 as { enabled?: boolean; font?: string } | undefined;
  const highlight2Font = highlight2?.enabled ? highlight2.font : undefined;

  return [...new Set([baseFont, highlightFont, highlight2Font].map((font) => font?.trim()).filter(Boolean) as string[])];
}

function getRequestOrigin(req: NextRequest): string {
  // En Docker, le render-engine ne peut pas atteindre localhost:3000.
  // FONT_BASE_URL permet de forcer l'origine (ex: http://web:3000).
  if (process.env.FONT_BASE_URL) return process.env.FONT_BASE_URL;

  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = req.headers.get("host");

  if (forwardedHost || host) {
    return `${forwardedProto ?? req.nextUrl.protocol.replace(":", "") ?? "https"}://${forwardedHost ?? host}`;
  }

  return req.nextUrl.origin;
}

function resolveFontAssetUrl(url: string, origin: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return `https:${url}`;
  return `${origin}${url.startsWith("/") ? url : `/${url}`}`;
}

async function attachCaptionFontAssets(req: NextRequest, configData: Record<string, unknown>): Promise<Record<string, unknown>> {
  const families = extractCaptionFontFamilies(configData);
  if (families.length === 0) return configData;
  const origin = getRequestOrigin(req);
  const requestedFamilyMap = new Map(
    families.map((family) => [family.trim().toLowerCase(), family])
  );

  let assets: { family: string; url: string; originalName: string | null }[] = [];
  try {
    assets = (await listFontAssetsByFamilies(families))
      .filter(isCaptionCompatibleFontAsset)
      .map((asset) => ({
        family: requestedFamilyMap.get(asset.family.trim().toLowerCase()) ?? asset.family,
        url: resolveFontAssetUrl(asset.url, origin),
        originalName: asset.originalName,
      }));
  } catch (err) {
    console.warn(`[render/captions] Font asset lookup failed for families [${families.join(", ")}] — proceeding without custom fonts:`, err);
    return configData;
  }

  if (assets.length === 0) return configData;
  return {
    ...configData,
    font_assets: assets,
  };
}

export async function POST(req: NextRequest) {
  // ─── Auth ─────────────────────────────────────────────────────────────────
  const userContext = await getUserContext();
  if (!userContext) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.CAPTIONS))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const contentType = req.headers.get("content-type") ?? "";

  // ── Mode presigned (JSON body, RunPod uniquement) ─────────────────────────
  if (contentType.includes("application/json")) {
    if (!USE_RUNPOD || !runpodConfigured() || !r2Configured()) {
      return NextResponse.json(
        { error: "Mode presigned URL non disponible (RunPod ou R2 non configuré)." },
        { status: 503 }
      );
    }

    let body: {
      filename?: unknown;
      ext?: unknown;
      size?: unknown;
      srtContent?: unknown;
      srtFilename?: unknown;
      config?: unknown;
      previewMode?: unknown;
      presetId?: unknown;
      slotId?: unknown;
      useSlotVideo?: unknown;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
    }

    const filename     = String(body.filename ?? "").trim();
    const ext          = String(body.ext ?? "").toLowerCase().trim();
    const srtContent   = String(body.srtContent ?? "").trim();
    const srtFilename  = String(body.srtFilename ?? "captions.srt").trim();
    const previewMode  = String(body.previewMode ?? "false").toLowerCase() !== "false";
    const presetId     = body.presetId ? String(body.presetId).trim() : undefined;
    const slotIdRaw    = body.slotId ? String(body.slotId).trim() : undefined;

    const slotCheck = await resolveSlotIdOrNull(slotIdRaw, userContext);
    if (!slotCheck.ok) {
      return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
    }
    const slotId = slotCheck.slotId;

    // Source « vidéo du slot » : incrustation sur la vidéo montée validée déjà
    // stockée en R2 (currentVersion / render), sans re-upload navigateur. Le
    // client saute alors le PUT presigned et appelle directement /submit.
    const useSlotVideo = body.useSlotVideo === true;
    let slotSource: { key: string; filename: string; ext: string } | null = null;
    if (useSlotVideo) {
      if (!slotId) {
        return NextResponse.json(
          { error: "slotId requis pour incruster sur la vidéo du slot." },
          { status: 400 },
        );
      }
      slotSource = await resolveSlotSourceVideo(slotId);
      if (!slotSource) {
        return NextResponse.json(
          { error: "Aucune vidéo source disponible pour ce slot — promeus une version d'abord." },
          { status: 400 },
        );
      }
    }

    // filename/ext ne sont requis que pour l'upload navigateur (pas useSlotVideo).
    if (!slotSource && (!filename || !VIDEO_EXTENSIONS.has(ext))) {
      return NextResponse.json(
        { error: `Extension vidéo non supportée : .${ext}. Formats acceptés : ${[...VIDEO_EXTENSIONS].join(", ")}` },
        { status: 400 }
      );
    }
    if (!srtContent) {
      return NextResponse.json({ error: "srtContent manquant" }, { status: 400 });
    }
    if (Buffer.byteLength(srtContent) > MAX_SRT_BYTES) {
      return NextResponse.json({ error: `Sous-titres trop volumineux (${Math.round(MAX_SRT_BYTES / 1024)} Ko max)` }, { status: 400 });
    }
    if (!body.config) {
      return NextResponse.json({ error: "config manquant" }, { status: 400 });
    }

    let configData: Record<string, unknown>;
    try {
      configData = typeof body.config === "string"
        ? JSON.parse(body.config)
        : (body.config as Record<string, unknown>);
    } catch {
      return NextResponse.json({ error: "config JSON invalide" }, { status: 400 });
    }

    if (presetId && !isAdmin) {
      const presetAccess = await prisma.captionPresetAccess.findFirst({
        where: { userId: userContext.effectiveUser.id, presetId },
      });
      if (!presetAccess) {
        return NextResponse.json({ error: "Accès refusé à ce preset" }, { status: 403 });
      }
    }

    configData = await attachCaptionFontAssets(req, configData);
    configData = normalizeCaptionConfig(configData);

    const jobTimestamp = Date.now();
    const outputSuffix = previewMode ? "preview" : "full";
    const outputKey    = `outputs/captions/${userContext.effectiveUser.id}/${jobTimestamp}/${outputSuffix}.mp4`;

    // useSlotVideo : la vidéo est déjà en R2 (clé slotSource.key) → pas de
    // presigned upload, on renvoie juste captionJobId et le client appelle
    // /submit (qui lit job.inputKey et vérifie objectExistsInR2). Sinon :
    // upload navigateur classique via URL présignée.
    let inputKey: string;
    let uploadUrl: string | null = null;
    let multipart: { uploadId: string; partSize: number; partUrls: { partNumber: number; url: string }[] } | null = null;
    let inputUrlLabel: string;
    if (slotSource) {
      inputKey      = slotSource.key;
      inputUrlLabel = slotSource.filename;
    } else {
      inputKey      = `inputs/captions/${userContext.effectiveUser.id}/${jobTimestamp}/video.${ext}`;
      inputUrlLabel = filename;

      const size = Number(body.size);
      if (!Number.isFinite(size) || size <= 0) {
        return NextResponse.json({ error: "Le champ 'size' (octets) est requis" }, { status: 400 });
      }
      if (size > MAX_UPLOAD_SIZE) {
        return NextResponse.json({ error: "Fichier trop volumineux (max 20 Go)" }, { status: 400 });
      }

      const mimeByExt: Record<string, string> = {
        mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska",
        webm: "video/webm", avi: "video/x-msvideo", m4v: "video/mp4",
      };
      const contentTypeForUpload = mimeByExt[ext] ?? "video/mp4";

      // Single PUT (<= 100 Mo) vs multipart (> 100 Mo, obligatoire > 5 Go).
      // Le client finalise via /upload-complete après avoir uploadé les parties.
      try {
        if (size > MULTIPART_THRESHOLD) {
          const { uploadId } = await createMultipartUpload(inputKey, contentTypeForUpload);
          const partCount = Math.ceil(size / PART_SIZE);
          const partUrls: { partNumber: number; url: string }[] = [];
          for (let i = 1; i <= partCount; i++) {
            const url = await createPresignedUploadPartUrl(inputKey, uploadId, i, PART_URL_EXPIRY_SECONDS);
            partUrls.push({ partNumber: i, url });
          }
          multipart = { uploadId, partSize: PART_SIZE, partUrls };
        } else {
          uploadUrl = await createPresignedUploadUrl(inputKey, contentTypeForUpload, 3600);
        }
      } catch (err) {
        console.error("[render/captions/prepare] Presigned URL failed:", err);
        return NextResponse.json({ error: "Impossible de générer l'URL d'upload" }, { status: 500 });
      }
    }

    const captionJob = await prisma.captionJob.create({
      data: {
        userId:      userContext.effectiveUser.id,
        status:      "QUEUED",
        inputUrl:    inputUrlLabel,
        inputKey,
        outputKey,
        config:      JSON.stringify(configData),
        srtContent,
        srtFilename,
        previewMode,
        presetId:    presetId ?? null,
        slotId:      slotId ?? null,
      },
    });

    return NextResponse.json(
      {
        captionJobId: captionJob.id,
        ...(uploadUrl ? { uploadUrl } : {}),
        ...(multipart ? { multipart } : {}),
      },
      { status: 202 },
    );
  }

  // ── Mode multipart ────────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Impossible de lire le formulaire" }, { status: 400 });
  }

  const videoFile      = formData.get("video") as File | null;
  const subtitlesFile  = formData.get("subtitles") as File | null;
  const configStr      = formData.get("config") as string | null;
  const previewModeStr = (formData.get("preview_mode") as string | null) ?? "true";
  const presetId       = (formData.get("preset_id") as string | null) ?? undefined;
  const slotIdRaw      = (formData.get("slot_id") as string | null) ?? undefined;

  // Vérifie l'accès au slot avant tout traitement (IDOR — voir
  // resolveSlotIdOrNull plus haut).
  const slotCheckMp = await resolveSlotIdOrNull(slotIdRaw ?? undefined, userContext);
  if (!slotCheckMp.ok) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }
  const slotId = slotCheckMp.slotId;

  if (presetId && !isAdmin) {
    const presetAccess = await prisma.captionPresetAccess.findFirst({
      where: { userId: userContext.effectiveUser.id, presetId },
    });
    if (!presetAccess) {
      return NextResponse.json({ error: "Accès refusé à ce preset" }, { status: 403 });
    }
  }

  if (!videoFile || !subtitlesFile || !configStr) {
    return NextResponse.json(
      { error: "Champs requis manquants : video, subtitles, config" },
      { status: 400 }
    );
  }

  let configData: Record<string, unknown>;
  try {
    configData = JSON.parse(configStr);
  } catch {
    return NextResponse.json({ error: "config JSON invalide" }, { status: 400 });
  }

  configData = await attachCaptionFontAssets(req, configData);
  configData = normalizeCaptionConfig(configData);
  const configPayload = JSON.stringify(configData);
  const previewMode   = previewModeStr !== "false";

  // ── Mode local (USE_RUNPOD=false) ─────────────────────────────────────────
  if (!USE_RUNPOD) {
    const CAPTIONS_API    = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";
    const srtContentLocal = await subtitlesFile.text();

    const captionJob = await prisma.captionJob.create({
      data: {
        userId:     userContext.effectiveUser.id,
        status:     "PROCESSING",
        inputUrl:   videoFile.name,
        config:     configPayload,
        srtContent: srtContentLocal,
        srtFilename: subtitlesFile.name,
        presetId:   presetId ?? null,
        slotId:     slotId ?? null,
      },
    });

    try {
      const localForm = new FormData();
      localForm.append("video", videoFile, videoFile.name);
      localForm.append("subtitles", new Blob([srtContentLocal], { type: "text/plain" }), subtitlesFile.name);
      localForm.append("config", configPayload);
      localForm.append("preview_mode", String(previewMode));

      const localRes = await fetch(`${CAPTIONS_API}/api/render`, {
        method: "POST",
        body:   localForm,
        signal: AbortSignal.timeout(20 * 60 * 1000),
      });

      if (!localRes.ok) {
        throw new Error(`render-engine ${localRes.status}: ${await localRes.text()}`);
      }

      const data = await localRes.json() as { videoUrl: string; engine?: string };
      const absoluteUrl = data.videoUrl.startsWith("http")
        ? data.videoUrl
        : `/api/captions${data.videoUrl.startsWith("/") ? data.videoUrl : `/${data.videoUrl}`}`;

      await prisma.captionJob.update({
        where: { id: captionJob.id },
        data:  { status: "COMPLETED", outputUrl: absoluteUrl },
      });

      // Parité webhook RunPod : log activity + auto-transition pipeline.
      await onCaptionsCompleted(captionJob.id);

      return NextResponse.json({
        captionJobId: captionJob.id,
        videoUrl:     absoluteUrl,
        engine:       data.engine,
        message:      "Rendu local terminé",
      });
    } catch (err) {
      await prisma.captionJob.update({
        where: { id: captionJob.id },
        data:  { status: "FAILED", errorMsg: String(err) },
      });
      return NextResponse.json(
        { error: `Erreur rendu local : ${String(err)}` },
        { status: 502 }
      );
    }
  }

  // ── RunPod checks ─────────────────────────────────────────────────────────
  if (!runpodConfigured()) {
    return NextResponse.json(
      { error: "RunPod non configuré. Renseigner RUNPOD_API_KEY et RUNPOD_ENDPOINT_ID." },
      { status: 503 }
    );
  }
  if (!r2Configured()) {
    return NextResponse.json(
      { error: "Stockage R2 non configuré. Renseigner R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL." },
      { status: 503 }
    );
  }

  // ── Préparer les clés et créer le job AVANT l'upload R2 ─────────────────
  // Créer d'abord le record DB évite les fichiers R2 orphelins si prisma.create()
  // échoue après que l'upload ait réussi.
  const srtContent    = await subtitlesFile.text();
  if (Buffer.byteLength(srtContent) > MAX_SRT_BYTES) {
    return NextResponse.json({ error: `Sous-titres trop volumineux (${Math.round(MAX_SRT_BYTES / 1024)} Ko max)` }, { status: 400 });
  }
  const jobTimestamp  = Date.now();
  const videoExt      = (videoFile.name.split(".").pop() ?? "mp4").toLowerCase();
  const inputVideoKey = `inputs/captions/${userContext.effectiveUser.id}/${jobTimestamp}/video.${videoExt}`;

  const outputSuffix = previewMode ? "preview" : "full";
  const outputKey    = `outputs/captions/${userContext.effectiveUser.id}/${jobTimestamp}/${outputSuffix}.mp4`;

  const captionJob = await prisma.captionJob.create({
    data: {
      userId:    userContext.effectiveUser.id,
      status:    "QUEUED",
      inputUrl:  videoFile.name,
      inputKey:  inputVideoKey,
      outputKey,
      config:    configPayload,
      srtContent,
      srtFilename: subtitlesFile.name,
      presetId:  presetId ?? null,
      slotId:    slotId ?? null,
    },
  });

  // ── Upload vidéo vers R2 ──────────────────────────────────────────────────
  let inputVideoUrl: string;
  try {
    const videoBuffer  = Buffer.from(await videoFile.arrayBuffer());
    const uploadResult = await uploadToR2(inputVideoKey, videoBuffer, videoFile.type || "video/mp4");
    inputVideoUrl = uploadResult.url;
  } catch (err) {
    console.error("[render/captions] Upload vidéo R2 failed:", err);
    await prisma.captionJob.update({
      where: { id: captionJob.id },
      data:  { status: "FAILED", errorMsg: `Échec upload vidéo vers R2 : ${String(err)}` },
    });
    return NextResponse.json({ error: "Échec upload vidéo vers R2" }, { status: 500 });
  }

  const webhookUrl = getRunpodWebhookUrl("/api/webhooks/runpod/captions");
  const runpodPayload = {
    input: {
      video_url:      inputVideoUrl,
      srt_content:    srtContent,
      config:         configData,
      preview_mode:   previewMode,
      output_key:     outputKey,
      caption_job_id: captionJob.id,
    },
    ...(webhookUrl ? { webhook: webhookUrl } : {}),
  };

  let runpodJobId: string;
  try {
    const runpodData = await submitRunpodJob<RunpodSubmitResponse>(
      RUNPOD_ENDPOINT_ID!,
      RUNPOD_API_KEY!,
      runpodPayload
    );
    runpodJobId = runpodData.id;
  } catch (err) {
    await prisma.captionJob.update({
      where: { id: captionJob.id },
      data:  { status: "FAILED", errorMsg: String(err) },
    });
    try { await deleteFromR2(inputVideoKey); } catch { /* ignore */ }
    console.error("[render/captions] RunPod submit failed:", err);
    return NextResponse.json(
      { error: `Échec soumission RunPod : ${String(err)}` },
      { status: 502 }
    );
  }

  await prisma.captionJob.update({
    where: { id: captionJob.id },
    data:  { status: "PROCESSING", runpodJobId },
  });

  return NextResponse.json(
    { captionJobId: captionJob.id, runpodJobId, message: "Job soumis à RunPod" },
    { status: 202 }
  );
}
