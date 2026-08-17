/**
 * GET /api/transcription/[id]/audit
 *
 * Retourne le score de qualité et les avertissements SRT pour une transcription terminée.
 *
 * Réponse 200 :
 *   { score: number (0–100), warnings: SRTWarning[], subtitleCount: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { getFromR2 } from "@/lib/r2";
import path from "path";
import { readFile } from "fs/promises";
import {
  buildSubtitlesFromWords,
  auditSRT,
  srtQualityScore,
  type Segment,
} from "@/lib/transcriptionProcess";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const { id } = await params;

  const job = await prisma.transcriptionJob.findUnique({ where: { id } });
  if (!job) {
    return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  }
  if (job.userId !== userContext.effectiveUser.id && !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  if (job.status !== "COMPLETED") {
    return NextResponse.json({ error: "Transcription non terminée" }, { status: 409 });
  }
  if (!job.outputJsonKey) {
    return NextResponse.json({ error: "Fichier de sortie introuvable" }, { status: 404 });
  }

  let segments: Segment[];
  try {
    let buf: Buffer;
    if (job.outputJsonKey.startsWith("local/")) {
      const localPath = path.join(process.cwd(), "public", job.outputJsonKey.replace(/^local\//, ""));
      buf = await readFile(localPath);
    } else {
      buf = await getFromR2(job.outputJsonKey);
    }
    segments = JSON.parse(buf.toString("utf-8")) as Segment[];
  } catch (err) {
    console.error("[transcription/audit] Erreur lecture segments:", err);
    return NextResponse.json({ error: "Impossible de lire les données de transcription" }, { status: 500 });
  }

  const subtitles = buildSubtitlesFromWords(segments);
  const warnings = auditSRT(segments);
  const score = srtQualityScore(warnings);

  return NextResponse.json({
    score,
    warnings,
    subtitleCount: subtitles.length,
  });
}
