/**
 * expireStale — traite les TranscriptionJob immobiles avant leur envoi à RunPod
 * (règles pures : lib/transcription/staleRules.ts).
 *
 * Partagé par GET /api/transcription/[id] (un job) et le sweep admin (tous).
 * Chaque écriture est gardée sur l'état lu (statut, absence de runpodJobId,
 * `updatedAt`) : un job qui a bougé entre-temps (submit, webhook, heartbeat)
 * n'est pas touché.
 *
 * - Upload jamais confirmé : on vérifie la source avant de conclure. Présente,
 *   le job est « guéri » (`uploadedAt` posé) — cas d'un PUT unique fini sans
 *   /upload-complete (onglet fermé), ou d'un job antérieur à `uploadedAt`.
 *   Absente : FAILED. HEAD en erreur : on ne conclut rien.
 * - Vidéo prête jamais lancée (7 j) : FAILED, source libérée.
 * - Envoi RunPod interrompu (redémarrage du serveur pendant l'envoi) : la vidéo
 *   d'un dépôt standalone est remise en attente avec un message — sinon un
 *   déploiement pendant le lancement d'un lot obligerait à tout re-uploader.
 *   Job du pipeline auto : FAILED, comme avant.
 */

import type { TranscriptionJob } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mapWithConcurrencySettled } from "@/lib/concurrency";
import { notifyUser } from "@/lib/sseStore";
import {
  DISPATCH_REQUEUED_MESSAGE,
  STALE_ERROR_MESSAGES,
  classifyPreSubmitJob,
  type StaleReason,
} from "@/lib/transcription/staleRules";
import { applyTranscriptionOutcome } from "@/lib/services/transcription/applyOutcome";
import {
  isDispatchPending,
  transcriptionEngineIsLocal,
  transcriptionSourceExists,
} from "@/lib/services/transcription/submitTranscription";

/** HEAD R2 simultanés (guérison des uploads non confirmés). */
const HEAD_CONCURRENCY = 4;

export type StaleJob = Pick<
  TranscriptionJob,
  | "id"
  | "userId"
  | "status"
  | "runpodJobId"
  | "inputKey"
  | "outputJsonKey"
  | "uploadedAt"
  | "updatedAt"
  | "renderId"
  | "publicationVersionId"
>;

/** Champs Prisma à sélectionner pour `expireStaleTranscriptionJobs`. */
export const STALE_JOB_SELECT = {
  id: true,
  userId: true,
  status: true,
  runpodJobId: true,
  inputKey: true,
  outputJsonKey: true,
  uploadedAt: true,
  updatedAt: true,
  renderId: true,
  publicationVersionId: true,
} as const;

export type ExpireSummary = {
  /** Passés FAILED, par raison. */
  failed: Record<StaleReason, number>;
  /** Envois interrompus remis en attente. */
  requeued: number;
  /** Uploads non confirmés dont la source est bien là. */
  healed: number;
};

type Action = "failed" | "requeued" | "healed" | null;

async function expireOne(
  job: StaleJob,
  now: Date,
  opts: { uploadStallMs?: number; localEngine: boolean },
): Promise<{
  action: Action;
  reason: StaleReason | null;
}> {
  const verdict = classifyPreSubmitJob(job, now, opts);
  if (!verdict.stale) return { action: null, reason: null };
  // Encore en file dans ce process (lot lancé, RunPod lent) : pas interrompu.
  if (verdict.reason === "dispatch_interrupted" && isDispatchPending(job.id)) {
    return { action: null, reason: null };
  }
  const guard = { id: job.id, status: job.status, runpodJobId: null, updatedAt: job.updatedAt };

  if (verdict.reason === "upload_abandoned" && job.inputKey) {
    let present: boolean;
    try {
      present = await transcriptionSourceExists(job.inputKey);
    } catch {
      return { action: null, reason: null }; // R2 muet : on ne conclut rien.
    }
    if (present) {
      const healed = await prisma.transcriptionJob.updateMany({ where: guard, data: { uploadedAt: now } });
      return { action: healed.count > 0 ? "healed" : null, reason: null };
    }
  }

  if (verdict.reason === "dispatch_interrupted" && verdict.requeue) {
    const requeued = await prisma.transcriptionJob.updateMany({
      where: guard,
      data: { status: "QUEUED", errorMsg: DISPATCH_REQUEUED_MESSAGE },
    });
    if (requeued.count === 0) return { action: null, reason: null };
    notifyUser(job.userId, {
      jobType: "transcription",
      jobId: job.id,
      status: "QUEUED",
      errorMsg: DISPATCH_REQUEUED_MESSAGE,
    });
    return { action: "requeued", reason: verdict.reason };
  }

  const applied = await applyTranscriptionOutcome(
    job,
    { kind: "failed", errorMsg: STALE_ERROR_MESSAGES[verdict.reason] },
    { where: guard },
  );
  return { action: applied ? "failed" : null, reason: verdict.reason };
}

export async function expireStaleTranscriptionJobs(
  jobs: StaleJob[],
  opts: { now?: Date; uploadStallMs?: number } = {},
): Promise<ExpireSummary> {
  const now = opts.now ?? new Date();
  const summary: ExpireSummary = {
    failed: { upload_abandoned: 0, never_launched: 0, dispatch_interrupted: 0 },
    requeued: 0,
    healed: 0,
  };
  const localEngine = transcriptionEngineIsLocal();
  const outcomes = await mapWithConcurrencySettled(jobs, HEAD_CONCURRENCY, (job) =>
    expireOne(job, now, { uploadStallMs: opts.uploadStallMs, localEngine }),
  );
  outcomes.forEach((outcome, index) => {
    if (!outcome.ok) {
      console.error(`[transcription/expire] job=${jobs[index].id}:`, outcome.error);
      return;
    }
    const { action, reason } = outcome.value;
    if (action === "failed" && reason) summary.failed[reason] += 1;
    else if (action === "requeued") summary.requeued += 1;
    else if (action === "healed") summary.healed += 1;
  });
  return summary;
}
