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
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

const CAPTIONS_API = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";

async function probeDuration(url: string): Promise<number | null> {
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
    console.warn(`[backfill-duration] probe failed for ${url}:`, err);
    return null;
  }
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

  let succeeded = 0;
  let failed = 0;

  for (const asset of assets) {
    const duration = await probeDuration(asset.url);
    if (duration != null) {
      try {
        await prisma.mediaAsset.update({ where: { id: asset.id }, data: { duration } });
        succeeded++;
      } catch (err) {
        console.error(`[backfill-duration] update failed for asset ${asset.id}:`, err);
        failed++;
      }
    } else {
      failed++;
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
