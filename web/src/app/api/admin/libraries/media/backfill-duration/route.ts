/**
 * POST /api/admin/libraries/media/backfill-duration
 *
 * Probe la duration des assets vidéo/audio qui ont duration=NULL en DB
 * (legacy uploads d'avant le probe vidéo systématique au confirm/route.ts).
 *
 * One-shot admin tool — pas de pagination, traite tous les assets éligibles
 * d'un coup. Si la lib a 1000+ assets, prévoir un timeout généreux côté
 * client (jusqu'à 10 minutes).
 *
 * Le probe est tenté via le render-engine (CAPTIONS_API_URL). Si l'asset
 * n'est pas joignable ou si le probe rate, on log et on continue.
 *
 * Body (optionnel) : { libraryId?: string } pour ne traiter qu'une lib.
 * Sinon traite tous les assets vidéo/audio de toutes les libs.
 *
 * Retour : { processed, succeeded, failed, alreadyHadDuration }.
 *
 * Accès : ADMIN uniquement.
 */

import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { existsSync } from "fs";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

const execFileAsync = promisify(execFile);
const CAPTIONS_API = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";

/** Base URL atteignable par le render-engine pour les fichiers /uploads/ en dev.
 *  Par défaut `http://web:3000` (hostname du service web dans docker-compose).
 *  Override possible via INTERNAL_BASE_URL si setup différent. */
const INTERNAL_BASE_URL = process.env.INTERNAL_BASE_URL ?? "http://web:3000";

/**
 * Résout une URL d'asset en target probeable par ffprobe :
 *  - "/uploads/xyz.mp4" (dev sans R2) → chemin filesystem absolu vers
 *    web/public/uploads/xyz.mp4 si existe.
 *  - URL absolue (R2 / https) → renvoyée telle quelle.
 *  - Tout autre cas → renvoyée telle quelle, ffprobe tentera.
 */
function resolveProbeTarget(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/uploads/")) {
    const localPath = path.join(process.cwd(), "public", url);
    if (existsSync(localPath)) return localPath;
  }
  return url;
}

/** Construit l'URL HTTP absolue qu'un service externe (render-engine) peut
 *  fetch pour récupérer ce fichier. Utilisé quand ffprobe local n'est pas
 *  installé dans le container web. */
function toExternalUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/uploads/")) return `${INTERNAL_BASE_URL}${url}`;
  return url;
}

async function probeDurationFromRenderEngine(url: string): Promise<number | null> {
  try {
    const res = await fetch(`${CAPTIONS_API}/api/probe-duration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { duration?: number | null };
    return typeof data.duration === "number" && data.duration > 0 ? data.duration : null;
  } catch (err) {
    console.warn(`[backfill-duration] render-engine probe failed for ${url}:`, err);
    return null;
  }
}

async function probeDuration(url: string): Promise<number | null> {
  const target = resolveProbeTarget(url);
  // ffprobe local en premier (fonctionne sur path fichier ET URL HTTPS).
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "json", target],
      { timeout: 30_000 },
    );
    const d = parseFloat((JSON.parse(stdout) as { format?: { duration?: string } }).format?.duration ?? "");
    if (!isNaN(d) && d > 0) return d;
  } catch { /* fall through — ffprobe non installé OU fichier illisible */ }

  // Fallback render-engine : on lui passe une URL HTTP qu'il sait fetch.
  // Pour les /uploads/ en dev, on construit l'URL interne docker-compose.
  return probeDurationFromRenderEngine(toExternalUrl(url));
}

export async function POST(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as { libraryId?: string };

  const assets = await prisma.mediaAsset.findMany({
    where: {
      duration: null,
      OR: [{ mimeType: { startsWith: "video/" } }, { mimeType: { startsWith: "audio/" } }],
      ...(body.libraryId ? { libraryId: body.libraryId } : {}),
    },
    select: { id: true, url: true, mimeType: true, filename: true },
  });

  // W5.13 : Promise.allSettled par batches de 5. Sans ça, la boucle for
  // séquentielle avec 30s timeout ffprobe + 60s render-engine prenait
  // jusqu'à 100min sur 100 assets — bien au-delà du timeout Vercel/Next.
  // 5 concurrents reste raisonnable pour R2/render-engine (pas de saturation).
  const BATCH_SIZE = 5;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < assets.length; i += BATCH_SIZE) {
    const batch = assets.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (asset) => {
        const duration = await probeDuration(asset.url);
        if (duration == null) {
          throw new Error("no_duration");
        }
        await prisma.mediaAsset.update({ where: { id: asset.id }, data: { duration } });
        return asset.id;
      }),
    );
    for (const [idx, r] of results.entries()) {
      if (r.status === "fulfilled") {
        succeeded++;
      } else {
        const err = (r as PromiseRejectedResult).reason;
        if (err instanceof Error && err.message !== "no_duration") {
          console.error(`[backfill-duration] failed for asset ${batch[idx].id}:`, err);
        }
        failed++;
      }
    }
  }

  return NextResponse.json({
    processed: assets.length,
    succeeded,
    failed,
    note: failed > 0
      ? "Certains assets n'ont pas pu être probés (R2 inaccessible, render-engine down, ou vidéo corrompue). Ré-essayez plus tard ou inspectez les warnings serveur."
      : null,
  });
}
