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
import { auth } from "@/lib/auth";
import { hasTool, TOOLS } from "@/lib/permissions";
import { isCaptionCompatibleFontAsset, listFontAssetsByFamilies } from "@/lib/fontAssets";
import { normalizeCaptionConfig } from "@/lib/captionsEngine";
import { prisma } from "@/lib/prisma";
import { uploadToR2, deleteFromR2, r2Configured, createPresignedUploadUrl } from "@/lib/r2";
import { submitRunpodJob, runpodConfigured } from "@/lib/runpod";
import { getRunpodWebhookUrl } from "@/lib/webhooks/runpod";

const RUNPOD_API_KEY    = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;
const USE_RUNPOD        = process.env.USE_RUNPOD !== "false";

type RunpodSubmitResponse = { id: string };

const VIDEO_EXTENSIONS = new Set([
  "mp4", "mov", "mkv", "webm", "avi", "m4v",
]);

/** Max SRT/subtitle content size stored in DB and sent to the worker. */
const MAX_SRT_BYTES = 512_000; // 512 KB

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
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const isAdmin = session.user.role === "ADMIN";
  if (!isAdmin && !(await hasTool(session.user.id, TOOLS.CAPTIONS))) {
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
      srtContent?: unknown;
      srtFilename?: unknown;
      config?: unknown;
      previewMode?: unknown;
      presetId?: unknown;
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

    if (!filename || !VIDEO_EXTENSIONS.has(ext)) {
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
        where: { userId: session.user.id, presetId },
      });
      if (!presetAccess) {
        return NextResponse.json({ error: "Accès refusé à ce preset" }, { status: 403 });
      }
    }

    configData = await attachCaptionFontAssets(req, configData);
    configData = normalizeCaptionConfig(configData);

    const jobTimestamp = Date.now();
    const inputKey     = `inputs/captions/${session.user.id}/${jobTimestamp}/video.${ext}`;
    const outputSuffix = previewMode ? "preview" : "full";
    const outputKey    = `outputs/captions/${session.user.id}/${jobTimestamp}/${outputSuffix}.mp4`;

    const mimeByExt: Record<string, string> = {
      mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska",
      webm: "video/webm", avi: "video/x-msvideo", m4v: "video/mp4",
    };
    let uploadUrl: string;
    try {
      uploadUrl = await createPresignedUploadUrl(inputKey, mimeByExt[ext] ?? "video/mp4", 3600);
    } catch (err) {
      console.error("[render/captions/prepare] Presigned URL failed:", err);
      return NextResponse.json({ error: "Impossible de générer l'URL d'upload" }, { status: 500 });
    }

    const captionJob = await prisma.captionJob.create({
      data: {
        userId:      session.user.id,
        status:      "QUEUED",
        inputUrl:    filename,
        inputKey,
        outputKey,
        config:      JSON.stringify(configData),
        srtContent,
        srtFilename,
        previewMode,
        presetId:    presetId ?? null,
      },
    });

    return NextResponse.json({ captionJobId: captionJob.id, uploadUrl }, { status: 202 });
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

  if (presetId && !isAdmin) {
    const presetAccess = await prisma.captionPresetAccess.findFirst({
      where: { userId: session.user.id, presetId },
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
        userId:     session.user.id,
        status:     "PROCESSING",
        inputUrl:   videoFile.name,
        config:     configPayload,
        srtContent: srtContentLocal,
        srtFilename: subtitlesFile.name,
        presetId:   presetId ?? null,
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
  const inputVideoKey = `inputs/captions/${session.user.id}/${jobTimestamp}/video.${videoExt}`;

  const outputSuffix = previewMode ? "preview" : "full";
  const outputKey    = `outputs/captions/${session.user.id}/${jobTimestamp}/${outputSuffix}.mp4`;

  const captionJob = await prisma.captionJob.create({
    data: {
      userId:    session.user.id,
      status:    "QUEUED",
      inputUrl:  videoFile.name,
      inputKey:  inputVideoKey,
      outputKey,
      config:    configPayload,
      srtContent,
      srtFilename: subtitlesFile.name,
      presetId:  presetId ?? null,
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
