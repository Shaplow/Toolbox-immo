/**
 * applyOutcome — issue d'un job de transcription (terminé / échoué), appliquée
 * UNE seule fois, quel que soit le chemin qui la découvre.
 *
 * ## Le problème résolu
 *
 * Deux chemins découvrent qu'un job RunPod est fini : le webhook, et le polling
 * de GET /api/transcription/[id]. Le polling faisait sa propre transition, sans
 * les effets du webhook :
 * - pas de SSE, pas de traduction auto (un job multi-langue découvert par
 *   polling perdait sa traduction : le webhook arrivé ensuite s'arrêtait au
 *   contrôle d'idempotence), pas de captions / description du pipeline auto ;
 * - et une suppression R2 SANS garde de la source — qui, pour un job du
 *   pipeline auto, est la vidéo du render ou de la version montée.
 *
 * Ici, la transition est un `updateMany` gardé sur le statut : seul l'appelant
 * qui la réalise déclenche les effets (libération gardée de la source,
 * notification, chaîne aval). Les autres reçoivent `false`.
 */

import type { Prisma, TranscriptionJob } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/sseStore";
import { releaseJobSource } from "@/lib/upload/releaseJobSource";
import { triggerAutoCaptionForTranscription } from "@/lib/triggerAutoCaptionFromTranscription";
import { triggerAutoDescriptionForTranscription } from "@/lib/triggerAutoDescriptionFromTranscription";
import { triggerAutoTranslationForTranscription } from "@/lib/triggerAutoTranslationFromTranscription";

export type TranscriptionOutput = {
  output_key?: string;
  segment_count?: number;
  duration?: number;
  has_diarization?: boolean;
};

export type TranscriptionOutcome =
  | { kind: "completed"; output: TranscriptionOutput }
  | { kind: "failed"; errorMsg: string };

type OutcomeJob = Pick<
  TranscriptionJob,
  "id" | "userId" | "inputKey" | "outputJsonKey" | "renderId" | "publicationVersionId"
>;

/** États non terminaux : un job du pipeline auto peut finir sans être passé PROCESSING. */
const OPEN_STATUSES = ["QUEUED", "PROCESSING"];

async function releaseSource(job: OutcomeJob): Promise<void> {
  // Gardes du helper : jamais la vidéo d'un render ou d'une version montée.
  await releaseJobSource(prisma, "transcription", job).catch((err) =>
    console.warn(`[transcription/outcome] libération source échouée job=${job.id}:`, err),
  );
}

/**
 * @returns true si cet appel a réalisé la transition (et déclenché les effets),
 *   false si le job était déjà terminal.
 */
export async function applyTranscriptionOutcome(
  job: OutcomeJob,
  outcome: TranscriptionOutcome,
  opts: {
    /** Garde supplémentaire (ex. expiration : l'état lu ne doit pas avoir bougé). */
    where?: Prisma.TranscriptionJobWhereInput;
  } = {},
): Promise<boolean> {
  const base: Prisma.TranscriptionJobWhereInput = { id: job.id, status: { in: OPEN_STATUSES } };
  const where: Prisma.TranscriptionJobWhereInput = opts.where ? { AND: [base, opts.where] } : base;

  if (outcome.kind === "failed") {
    const res = await prisma.transcriptionJob.updateMany({
      where,
      data: { status: "FAILED", errorMsg: outcome.errorMsg },
    });
    if (res.count === 0) return false;
    await releaseSource(job);
    notifyUser(job.userId, { jobType: "transcription", jobId: job.id, status: "FAILED", errorMsg: outcome.errorMsg });
    return true;
  }

  const { output } = outcome;
  const res = await prisma.transcriptionJob.updateMany({
    where,
    data: {
      status: "COMPLETED",
      outputJsonKey: output.output_key ?? job.outputJsonKey,
      segmentCount: output.segment_count ?? null,
      duration: output.duration ?? null,
      hasDiarization: output.has_diarization ?? false,
    },
  });
  if (res.count === 0) return false;

  await releaseSource(job);
  notifyUser(job.userId, {
    jobType: "transcription",
    jobId: job.id,
    status: "COMPLETED",
    segmentCount: output.segment_count ?? null,
    duration: output.duration ?? null,
    hasDiarization: output.has_diarization ?? false,
  });

  // Mode multi-langue : traduction inverse auto (no-op en mono). AVANT les
  // captions auto, pour qu'elles voient les segments déjà traduits.
  void (async () => {
    try {
      await triggerAutoTranslationForTranscription(job.id);
    } catch (err) {
      console.error(`[transcription/outcome] triggerAutoTranslation threw: ${String(err)}`);
    }
    if (job.renderId) {
      try {
        await triggerAutoCaptionForTranscription(job.id);
      } catch (err) {
        console.error(`[transcription/outcome] triggerAutoCaption threw: ${String(err)}`);
      }
    }
  })();

  // Description IA automatique : pipeline auto seulement (render ou version).
  if (job.renderId || job.publicationVersionId) {
    void triggerAutoDescriptionForTranscription(job.id).catch((err) =>
      console.error(`[transcription/outcome] triggerAutoDescription threw: ${String(err)}`),
    );
  }

  return true;
}
