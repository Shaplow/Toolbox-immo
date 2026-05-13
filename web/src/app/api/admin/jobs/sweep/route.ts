/**
 * POST /api/admin/jobs/sweep
 *
 * Balaie tous les jobs en PROCESSING / QUEUED depuis trop longtemps et les
 * passe en FAILED avec un message d'erreur explicite.
 *
 * Utile pour récupérer des jobs bloqués après une coupure RunPod, un redémarrage
 * du serveur sans webhook, ou un upload client qui n'a jamais appelé /submit.
 *
 * Seuils par défaut :
 *   PROCESSING  > 2 h  → RunPod webhook jamais reçu (coupure, NEXTAUTH_URL absent…)
 *   QUEUED      > 30 min → upload client jamais finalisé (/submit jamais appelé)
 *
 * Retourne le décompte de jobs marqués FAILED par type.
 *
 * Accès : ADMIN uniquement.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const PROCESSING_STALL_MS  = 2 * 60 * 60 * 1000;  // 2 h
const QUEUED_STALL_MS      = 30 * 60 * 1000;       // 30 min

export async function POST() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const now = new Date();
  const processingCutoff = new Date(now.getTime() - PROCESSING_STALL_MS);
  const queuedCutoff     = new Date(now.getTime() - QUEUED_STALL_MS);

  // ── CaptionJob ────────────────────────────────────────────────────────────
  const [captionProcessing, captionQueued] = await Promise.all([
    prisma.captionJob.updateMany({
      where: { status: "PROCESSING", updatedAt: { lt: processingCutoff } },
      data:  { status: "FAILED", errorMsg: "Job bloqué en PROCESSING — webhook RunPod jamais reçu (sweep automatique)" },
    }),
    prisma.captionJob.updateMany({
      where: { status: "QUEUED", updatedAt: { lt: queuedCutoff } },
      data:  { status: "FAILED", errorMsg: "Job bloqué en QUEUED — upload ou submit jamais finalisé (sweep automatique)" },
    }),
  ]);

  // ── TranscriptionJob ──────────────────────────────────────────────────────
  const [transcriptionProcessing, transcriptionQueued] = await Promise.all([
    prisma.transcriptionJob.updateMany({
      where: { status: "PROCESSING", updatedAt: { lt: processingCutoff } },
      data:  { status: "FAILED", errorMsg: "Job bloqué en PROCESSING — webhook RunPod jamais reçu (sweep automatique)" },
    }),
    prisma.transcriptionJob.updateMany({
      where: { status: "QUEUED", updatedAt: { lt: queuedCutoff } },
      data:  { status: "FAILED", errorMsg: "Job bloqué en QUEUED — upload ou submit jamais finalisé (sweep automatique)" },
    }),
  ]);

  // ── DerushJob ─────────────────────────────────────────────────────────────
  const [derushProcessing, derushQueued] = await Promise.all([
    prisma.derushJob.updateMany({
      where: { status: "PROCESSING", updatedAt: { lt: processingCutoff } },
      data:  { status: "FAILED", errorMsg: "Job bloqué en PROCESSING — webhook RunPod jamais reçu (sweep automatique)" },
    }),
    prisma.derushJob.updateMany({
      where: { status: "QUEUED", updatedAt: { lt: queuedCutoff } },
      data:  { status: "FAILED", errorMsg: "Job bloqué en QUEUED — sweep automatique" },
    }),
  ]);

  const summary = {
    captions: {
      processing: captionProcessing.count,
      queued:     captionQueued.count,
    },
    transcription: {
      processing: transcriptionProcessing.count,
      queued:     transcriptionQueued.count,
    },
    derush: {
      processing: derushProcessing.count,
      queued:     derushQueued.count,
    },
    total:
      captionProcessing.count + captionQueued.count +
      transcriptionProcessing.count + transcriptionQueued.count +
      derushProcessing.count + derushQueued.count,
  };

  console.info("[admin/jobs/sweep] Sweep terminé par", session.user.email, "—", JSON.stringify(summary));

  return NextResponse.json({ ok: true, swept: summary });
}
