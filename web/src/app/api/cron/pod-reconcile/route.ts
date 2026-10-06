/**
 * GET /api/cron/pod-reconcile
 *
 * Déclenche une vérification de l'état du pod : stale counter detection +
 * arrêt automatique si idle depuis IDLE_MINUTES.
 *
 * Ce cron est la seule source proactive de réconciliation du pod — sans lui,
 * si un webhook est perdu (réseau, redémarrage app, NEXTAUTH_URL invalide),
 * activeJobCount reste bloqué à > 0 et le pod tourne indéfiniment.
 *
 * Fréquence recommandée : toutes les 15 minutes (ou IDLE_MINUTES + 5 min).
 *
 * Protection : Authorization: Bearer <CRON_SECRET>.
 * Configurer le cron (crontab, supervisor, externe) pour appeler :
 *   GET /api/cron/pod-reconcile
 *   Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { maybeStopIdlePod } from "@/lib/podOrchestrator";
import { prisma } from "@/lib/prisma";
import { timingSafeEqualStrings } from "@/lib/utils";
import { reconcileDispatchedCoverPacks } from "@/lib/coverAuto";
import { AUTOCUT_FAILED_RETENTION_MS, reconcileAutocutJobs } from "@/lib/mediaAutocutServer";
import { READY_JOB_TTL_MS, SWEEP_UPLOAD_STALL_MS } from "@/lib/transcription/staleRules";
import { STALE_JOB_SELECT, expireStaleTranscriptionJobs } from "@/lib/services/transcription/expireStale";

/** Transcriptions immobiles traitées par passage (le reste au passage suivant). */
const TRANSCRIPTION_EXPIRE_BATCH = 200;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET non configuré" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!timingSafeEqualStrings(token, cronSecret)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  // Snapshot avant réconciliation
  const before = await prisma.podState.findUnique({ where: { id: "singleton" } });

  // maybeStopIdlePod: détecte stale counter (> 4h) + arrête le pod si idle.
  // Toutes les décisions sont loggées dans la console du serveur.
  await maybeStopIdlePod();

  // Snapshot après réconciliation
  const after = await prisma.podState.findUnique({ where: { id: "singleton" } });

  // Packs cover dont le job RunPod est parti mais dont le webhook n'est jamais
  // revenu (worker tué, réseau, NEXTAUTH_URL invalide). C'est le seul rattrapage :
  // le GET /api/cover-packs, poll toutes les 3 s, ne doit pas interroger RunPod.
  const covers = await reconcileDispatchedCoverPacks();

  // Même logique pour les packs d'analyse auto (autocut) : un webhook perdu dont
  // le job RunPod a réussi est rejoué (les analyses sont récupérées au lieu d'être
  // jetées), un job zombie est passé en échec avec un message lisible, et les
  // vieux échecs sont purgés. Le sweep admin appelle le même helper, mais il est
  // manuel : c'est ici que la purge devient automatique.
  const now = new Date();
  const autocut = await reconcileAutocutJobs({
    processingCutoff: new Date(now.getTime() - 30 * 60 * 1000),
    queuedCutoff: new Date(now.getTime() - 10 * 60 * 1000),
    failedRetentionCutoff: new Date(now.getTime() - AUTOCUT_FAILED_RETENTION_MS),
  }).catch((err) => {
    console.warn("[cron/pod-reconcile] réconciliation autocut échouée:", err);
    return null;
  });

  // Transcriptions immobiles avant leur envoi à RunPod : upload abandonné
  // (vérifié par HEAD, guéri si le fichier est là), vidéo prête jamais lancée
  // depuis 7 jours (stockage libéré), envoi interrompu par un redémarrage (remis
  // en attente). Mêmes règles que le sweep admin et GET /api/transcription/[id] ;
  // sans ce passage, ce ménage n'arrivait que sur un clic admin.
  const transcriptions = await prisma.transcriptionJob
    .findMany({
      where: {
        status: { in: ["QUEUED", "PROCESSING"] },
        runpodJobId: null,
        updatedAt: { lt: new Date(now.getTime() - SWEEP_UPLOAD_STALL_MS) },
        // Vidéos prêtes pas encore expirables (< 7 j) : exclues, sinon elles
        // occuperaient toute la fenêtre de 200 à chaque passage et les jobs
        // réellement périmés ne seraient jamais atteints.
        NOT: {
          status: "QUEUED",
          uploadedAt: { not: null },
          renderId: null,
          publicationVersionId: null,
          updatedAt: { gte: new Date(now.getTime() - READY_JOB_TTL_MS) },
        },
      },
      orderBy: { updatedAt: "asc" },
      take: TRANSCRIPTION_EXPIRE_BATCH,
      select: STALE_JOB_SELECT,
    })
    .then((jobs) => expireStaleTranscriptionJobs(jobs, { now, uploadStallMs: SWEEP_UPLOAD_STALL_MS }))
    .catch((err) => {
      console.warn("[cron/pod-reconcile] expiration transcriptions échouée:", err);
      return null;
    });

  return NextResponse.json({
    ok: true,
    covers,
    autocut,
    transcriptions,
    before: before
      ? { status: before.status, activeJobCount: before.activeJobCount, podId: before.podId }
      : null,
    after: after
      ? { status: after.status, activeJobCount: after.activeJobCount, podId: after.podId }
      : null,
  });
}
