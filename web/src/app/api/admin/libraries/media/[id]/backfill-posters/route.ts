/**
 * POST /api/admin/libraries/media/[id]/backfill-posters
 *
 * Génère les posters (vignettes JPEG légères) manquants des assets vidéo d'une
 * bibliothèque — ceux avec posterUrl=NULL, typiquement des uploads legacy
 * d'avant la capture poster client, ou dont la capture navigateur a échoué.
 *
 * Sans poster, la grille/liste retombe sur un <video> (lourd). Ce backfill
 * supprime ce chemin en posant un posterUrl comme le fait l'upload.
 *
 * Génération de la frame :
 *  1. ffmpeg local (installé sur le serveur prod via `apt install ffmpeg`) ;
 *  2. fallback render-engine `POST /api/generate-poster` (dev docker sans ffmpeg).
 * Le JPEG est ensuite uploadé en R2 sous la clé déterministe
 * `content-library/posters/{assetId}.jpg` (même schéma que la route poster
 * client), puis posterUrl est posé.
 *
 * One-shot admin, idempotent (skip si posterUrl déjà présent) et rejouable.
 * Traitement par batches pour ne pas saturer R2 / le render-engine.
 *
 * Accès : ADMIN uniquement. Retour : { processed, succeeded, failed, note }.
 */

import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { existsSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { getUserContext } from "@/lib/userContext";
import { canManageMediaLibraries } from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";
import { uploadToR2, getR2PublicUrl, r2Configured } from "@/lib/r2";

type Params = { params: Promise<{ id: string }> };

const execFileAsync = promisify(execFile);
const CAPTIONS_API = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";
const INTERNAL_BASE_URL = process.env.INTERNAL_BASE_URL ?? "http://web:3000";

const POSTER_WIDTH = 240;

/** Résout une URL d'asset en target ffmpeg local (chemin fichier pour /uploads/). */
function resolveLocalTarget(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/uploads/")) {
    const localPath = path.join(process.cwd(), "public", url);
    if (existsSync(localPath)) return localPath;
  }
  return url;
}

/** URL HTTP absolue qu'un service externe (render-engine) peut fetch. */
function toExternalUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/uploads/")) return `${INTERNAL_BASE_URL}${url}`;
  return url;
}

/** Extrait une frame JPEG via ffmpeg local. Retente à 0s pour les clips courts. */
async function extractPosterLocal(target: string): Promise<Buffer | null> {
  for (const ss of ["0.5", "0"]) {
    try {
      const { stdout } = (await execFileAsync(
        "ffmpeg",
        [
          "-y", "-loglevel", "error",
          "-ss", ss,
          "-i", target,
          "-frames:v", "1",
          "-vf", `scale=${POSTER_WIDTH}:-2`,
          "-q:v", "6", "-an",
          "-f", "image2", "pipe:1",
        ],
        { timeout: 60_000, maxBuffer: 16 * 1024 * 1024, encoding: "buffer" },
      )) as unknown as { stdout: Buffer };
      if (stdout && stdout.length > 0) return stdout;
    } catch {
      // ffmpeg absent, clip plus court que le seek, ou fichier illisible.
    }
  }
  return null;
}

/** Fallback render-engine : renvoie les octets JPEG. */
async function extractPosterRenderEngine(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${CAPTIONS_API}/api/generate-poster`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, at: 0.5, width: POSTER_WIDTH }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return ab.byteLength > 0 ? Buffer.from(ab) : null;
  } catch (err) {
    console.warn(`[backfill-posters] render-engine failed for ${url}:`, err);
    return null;
  }
}

async function generatePoster(url: string): Promise<Buffer | null> {
  const local = await extractPosterLocal(resolveLocalTarget(url));
  if (local) return local;
  return extractPosterRenderEngine(toExternalUrl(url));
}

/** Stocke le JPEG (R2 en prod, /uploads en dev) et renvoie l'URL publique. */
async function storePoster(assetId: string, jpeg: Buffer): Promise<string> {
  if (r2Configured()) {
    const key = `content-library/posters/${assetId}.jpg`;
    await uploadToR2(key, jpeg, "image/jpeg", jpeg.length);
    return getR2PublicUrl(key);
  }
  const dir = path.join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${assetId}_poster.jpg`), jpeg);
  return `/uploads/${assetId}_poster.jpg`;
}

export async function POST(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !canManageMediaLibraries(userContext.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id } = await params;

  const assets = await prisma.mediaAsset.findMany({
    where: { libraryId: id, posterUrl: null, mimeType: { startsWith: "video/" } },
    select: { id: true, url: true },
  });

  const BATCH_SIZE = 3;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < assets.length; i += BATCH_SIZE) {
    const batch = assets.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (asset) => {
        const jpeg = await generatePoster(asset.url);
        if (!jpeg) throw new Error("no_poster");
        const posterUrl = await storePoster(asset.id, jpeg);
        await prisma.mediaAsset.update({ where: { id: asset.id }, data: { posterUrl } });
        return asset.id;
      }),
    );
    for (const [idx, r] of results.entries()) {
      if (r.status === "fulfilled") {
        succeeded++;
      } else {
        const err = (r as PromiseRejectedResult).reason;
        if (err instanceof Error && err.message !== "no_poster") {
          console.error(`[backfill-posters] failed for asset ${batch[idx].id}:`, err);
        }
        failed++;
      }
    }
  }

  return NextResponse.json({
    processed: assets.length,
    succeeded,
    failed,
    note:
      failed > 0
        ? "Certains posters n'ont pas pu être générés (ffmpeg indisponible, R2/render-engine injoignable ou vidéo illisible). Ré-essayez — le backfill est idempotent."
        : null,
  });
}
