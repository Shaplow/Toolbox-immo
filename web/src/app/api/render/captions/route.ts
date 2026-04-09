/**
 * POST /api/render/captions
 *
 * Démarre un rendu vidéo sous-titré via RunPod.
 * - Nécessite RUNPOD_API_KEY + RUNPOD_ENDPOINT_ID (→ 503 si absents)
 * - Nécessite R2 configuré pour stocker la vidéo source et l'output
 *
 * Corps : multipart/form-data
 *   video       : File (mp4/mov...)
 *   subtitles   : File (srt/json)
 *   config      : JSON string (ConfigState)
 *   preview_mode: "true" | "false"  (défaut: "true")
 *
 * Réponse 202 :
 *   { captionJobId, runpodJobId }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isCaptionCompatibleFontAsset, listFontAssetsByFamilies } from "@/lib/fontAssets";
import { normalizeCaptionConfig } from "@/lib/captionsEngine";
import { prisma } from "@/lib/prisma";
import { uploadToR2, r2Configured } from "@/lib/r2";
import { submitRunpodJob } from "@/lib/runpod";

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;
const USE_RUNPOD = process.env.USE_RUNPOD !== "false";

function runpodConfigured(): boolean {
  return !!(RUNPOD_API_KEY && RUNPOD_ENDPOINT_ID);
}

type RunpodSubmitResponse = { id: string };

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

  const assets = (await listFontAssetsByFamilies(families))
    .filter(isCaptionCompatibleFontAsset)
    .map((asset) => ({
      family: requestedFamilyMap.get(asset.family.trim().toLowerCase()) ?? asset.family,
      url: resolveFontAssetUrl(asset.url, origin),
      originalName: asset.originalName,
    }));

  if (assets.length === 0) return configData;
  return {
    ...configData,
    font_assets: assets,
  };
}

export async function POST(req: NextRequest) {
  // ─── Auth ────────────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  // Verify the user has the captions tool
  const isAdmin = session.user.role === "ADMIN";
  if (!isAdmin) {
    const { hasTool, TOOLS } = await import("@/lib/permissions");
    if (!(await hasTool(session.user.id, TOOLS.CAPTIONS))) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }
  }
  // ─── Parse form ──────────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Impossible de lire le formulaire" }, { status: 400 });
  }

  const videoFile = formData.get("video") as File | null;
  const subtitlesFile = formData.get("subtitles") as File | null;
  const configStr = formData.get("config") as string | null;
  const previewModeStr = (formData.get("preview_mode") as string | null) ?? "true";
  const presetId = (formData.get("preset_id") as string | null) ?? undefined;

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

  const previewMode = previewModeStr !== "false";

  // ─── Mode local (USE_RUNPOD=false) : forward vers render-engine ───────────
  if (!USE_RUNPOD) {
    const CAPTIONS_API = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";
    const srtContentLocal = await subtitlesFile.text();

    const captionJob = await prisma.captionJob.create({
      data: {
        userId: session.user.id,
        status: "PROCESSING",
        inputUrl: videoFile.name,
        config: configPayload,
        srtContent: srtContentLocal,
        presetId: presetId ?? null,
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
        body: localForm,
        signal: AbortSignal.timeout(20 * 60 * 1000), // 20 min max (qualité max peut être lent)
      });

      if (!localRes.ok) {
        const errText = await localRes.text();
        throw new Error(`render-engine ${localRes.status}: ${errText}`);
      }

      const data = await localRes.json() as { videoUrl: string; engine?: string };
      // Build a proxied URL accessible from the browser.
      // The render-engine returns a path like /outputs/temp/file.mp4.
      // We expose it via /api/captions/... which the Next.js proxy forwards
      // to CAPTIONS_API_URL. Direct internal Docker URLs (render-engine:8000)
      // are unreachable from the browser, so we never embed them here.
      const absoluteUrl = data.videoUrl.startsWith("http")
        ? data.videoUrl
        : `/api/captions${data.videoUrl.startsWith("/") ? data.videoUrl : `/${data.videoUrl}`}`;

      await prisma.captionJob.update({
        where: { id: captionJob.id },
        data: { status: "DONE", outputUrl: absoluteUrl },
      });

      return NextResponse.json({
        captionJobId: captionJob.id,
        videoUrl: absoluteUrl,
        engine: data.engine,
        message: "Rendu local terminé",
      });
    } catch (err) {
      await prisma.captionJob.update({
        where: { id: captionJob.id },
        data: { status: "FAILED" },
      });
      return NextResponse.json(
        { error: `Erreur rendu local : ${String(err)}` },
        { status: 502 }
      );
    }
  }

  // ─── Vérification config RunPod ──────────────────────────────────────────
  if (!runpodConfigured()) {
    return NextResponse.json(
      {
        error:
          "RunPod non configuré. Renseigner RUNPOD_API_KEY et RUNPOD_ENDPOINT_ID dans les variables d'environnement.",
      },
      { status: 503 }
    );
  }

  // ─── Vérification config R2 ──────────────────────────────────────────────
  if (!r2Configured()) {
    return NextResponse.json(
      {
        error:
          "Stockage R2 non configuré. Renseigner R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL.",
      },
      { status: 503 }
    );
  }

  // ─── Upload vidéo source vers R2 ─────────────────────────────────────────
  const srtContent = await subtitlesFile.text();
  const jobTimestamp = Date.now();
  const videoExt = (videoFile.name.split(".").pop() ?? "mp4").toLowerCase();
  const inputVideoKey = `inputs/captions/${jobTimestamp}/video.${videoExt}`;

  let inputVideoUrl: string;
  try {
    const videoBuffer = Buffer.from(await videoFile.arrayBuffer());
    const uploadResult = await uploadToR2(inputVideoKey, videoBuffer, videoFile.type || "video/mp4");
    inputVideoUrl = uploadResult.url;
  } catch (err) {
    console.error("[render/captions] Upload vidéo R2 failed:", err);
    return NextResponse.json({ error: "Échec upload vidéo vers R2" }, { status: 500 });
  }

  // ─── Clé de sortie R2 ────────────────────────────────────────────────────
  const outputSuffix = previewMode ? "preview" : "full";
  const outputKey = `outputs/captions/${jobTimestamp}/${outputSuffix}.mp4`;

  // ─── Créer CaptionJob en DB ───────────────────────────────────────────────
  const captionJob = await prisma.captionJob.create({
    data: {
      userId: session.user.id,
      status: "QUEUED",
      inputUrl: videoFile.name,
      config: configPayload,
      srtContent,
      presetId: presetId ?? null,
    },
  });

  // ─── Soumettre le job RunPod ──────────────────────────────────────────────
  const runpodPayload = {
    input: {
      video_url: inputVideoUrl,
      srt_content: srtContent,
      config: configData,
      preview_mode: previewMode,
      output_key: outputKey,
      caption_job_id: captionJob.id,
    },
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
    // Annuler le job en DB
    await prisma.captionJob.update({
      where: { id: captionJob.id },
      data: { status: "FAILED" },
    });
    console.error("[render/captions] RunPod submit failed:", err);
    return NextResponse.json(
      { error: `Échec soumission RunPod : ${String(err)}` },
      { status: 502 }
    );
  }

  // ─── Mettre à jour DB avec runpodJobId ────────────────────────────────────
  await prisma.captionJob.update({
    where: { id: captionJob.id },
    data: {
      status: "PROCESSING",
      runpodJobId,
      outputKey,
    },
  });

  return NextResponse.json(
    {
      captionJobId: captionJob.id,
      runpodJobId,
      message: "Job soumis à RunPod",
    },
    { status: 202 }
  );
}
