/**
 * GET /api/transcription/[id]/audit
 *
 * Retourne le score de qualité et les avertissements SRT pour une transcription terminée.
 *
 * Réponse 200 :
 *   { score: number (0–100), warnings: SRTWarning[], subtitleCount: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getFromR2 } from "@/lib/r2";
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
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;

  const job = await prisma.transcriptionJob.findUnique({ where: { id } });
  if (!job) {
    return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  }
  if (job.userId !== session.user.id && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  if (job.status !== "COMPLETED") {
    return NextResponse.json({ error: "Transcription non terminée" }, { status: 409 });
  }
  if (!job.outputJsonKey) {
    return NextResponse.json({ error: "Fichier de sortie introuvable en R2" }, { status: 404 });
  }

  let segments: Segment[];
  try {
    const buf = await getFromR2(job.outputJsonKey);
    segments = JSON.parse(buf.toString("utf-8")) as Segment[];
  } catch (err) {
    console.error("[transcription/audit] Erreur lecture R2:", err);
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
