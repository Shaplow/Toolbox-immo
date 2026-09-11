/**
 * mediaAutocutServer — helpers autocut qui touchent la base et RunPod.
 *
 * Séparé de `@/lib/mediaAutocut` (pur, importé par des composants client) : ce
 * module importe prisma et ne doit jamais atterrir dans un bundle navigateur.
 *
 * Deux responsabilités :
 *   1. failAutocutBatch — le seul endroit qui met un batch en échec, en écrivant
 *      le VRAI message RunPod sur le batch ET sur ses jobs. Avant, le webhook
 *      posait la constante « Échec global du job RunPod » sur les jobs et gardait
 *      le vrai message sur MediaAutocutBatch.errorMsg, champ jamais lu par l'UI.
 *   2. applyAutocutBatchResults / reconcileAutocutJobs — appliquer un output de
 *      pack, récupérer celui d'un batch dont le webhook s'est perdu, hériter les
 *      messages et nettoyer les zombies.
 *
 * Pattern de référence : web/src/lib/coverAuto.ts (failCoverFramePack +
 * reconcileDispatchedCoverPacks).
 */

import "server-only";

import { prisma } from "@/lib/prisma";
import { notifyAll } from "@/lib/sseStore";
import { resolveRunpodJobPhase } from "@/lib/runpod";
import {
  AUTOCUT_ACTIVE_STATUSES,
  AUTOCUT_ERROR_MAX,
  type AutocutJobResult,
  type MediaAutocutBatchOutput,
} from "@/lib/mediaAutocut";

// ─── Mise en échec d'un batch ────────────────────────────────────────────────

/** Normalise n'importe quelle erreur en message court, préfixé métier, ≤ 500 car. */
export function autocutFailureMessage(raw: unknown, prefix = "Pack RunPod"): string {
  let text: string;
  if (raw instanceof Error) text = raw.message;
  else if (typeof raw === "string") text = raw;
  else if (raw == null) text = "erreur inconnue";
  else {
    try {
      text = JSON.stringify(raw);
    } catch {
      text = String(raw);
    }
  }
  text = text.trim() || "erreur inconnue";
  const message = text.toLowerCase().startsWith(prefix.toLowerCase()) ? text : `${prefix} — ${text}`;
  return message.slice(0, AUTOCUT_ERROR_MAX);
}

/**
 * Bascule un batch ET tous ses jobs non terminaux en `failed`, avec LE MÊME
 * message réel. Remplace les trois sites qui écrivaient une constante générique.
 *
 * Deux détails qui comptent :
 *   - `updateMany` sur le batch (pas `update`) : « Réinitialiser » peut l'avoir
 *     supprimé entre-temps, un P2025 ferait échouer tout le webhook.
 *   - le filtre inclut `"pending"` : le dispatch RunPod est asynchrone
 *     (autocut-packs répond 202 puis soumet en fond), donc un webhook rapide peut
 *     arriver avant que les jobs passent `processing`. L'ancien filtre
 *     `status: "processing"` seul les laissait zombies pour toujours.
 */
export async function failAutocutBatch(
  batchId: string,
  raw: unknown,
  opts?: { prefix?: string; notify?: boolean },
): Promise<{ jobsFailed: number; message: string }> {
  const message = autocutFailureMessage(raw, opts?.prefix);

  const jobsFailed = await prisma.$transaction(async (tx) => {
    await tx.mediaAutocutBatch.updateMany({
      where: { id: batchId },
      data: { status: "failed", errorMsg: message },
    });
    const r = await tx.mediaAutocutJob.updateMany({
      where: { batchId, status: { in: AUTOCUT_ACTIVE_STATUSES } },
      data: { status: "failed", errorMsg: message },
    });
    return r.count;
  });

  // Émis APRÈS commit (cf. bug-hunter #10 sur le webhook) — broadcast car le
  // modèle ne tracke pas l'admin déclencheur.
  if (opts?.notify !== false) {
    notifyAll({ jobType: "media-autocut", jobId: batchId, status: "FAILED", errorMsg: message });
  }

  return { jobsFailed, message };
}

// ─── Application des résultats d'un pack ─────────────────────────────────────

export interface ApplyAutocutResultsOutcome {
  batchStatus: "done" | "partial" | "failed";
  doneCount: number;
  failCount: number;
}

/**
 * Applique les résultats d'un pack sur ses jobs et met le batch à jour.
 *
 * Extrait du webhook pour être rejouable par la réconciliation : quand un webhook
 * se perd, on récupère l'output via l'API RunPod et on le rejoue ici plutôt que
 * de jeter des analyses qui ont réellement tourné (et été facturées).
 *
 * `updateMany` plutôt que `update` : un job peut avoir disparu entre-temps
 * (asset supprimé → cascade), et un P2025 ferait perdre tout le pack.
 */
export async function applyAutocutBatchResults(
  batchId: string,
  results: AutocutJobResult[],
): Promise<ApplyAutocutResultsOutcome> {
  const outcome = await prisma.$transaction(async (tx) => {
    let doneCount = 0;
    let failCount = 0;

    for (const result of results) {
      if (!result.job_id) continue;

      // `reviewStatus: "pending_review"` agit comme compare-and-swap : cette
      // fonction est rejouable (réconciliation d'un webhook perdu, sweep manuel
      // qui croise le cron), et sans ce garde une seconde application écraserait
      // le travail de l'admin — remise à "pending_review" d'un job déjà accepté,
      // écrasement des confirmedStart/End qu'il venait d'ajuster.
      if (result.error) {
        const r = await tx.mediaAutocutJob.updateMany({
          where: { id: result.job_id, reviewStatus: "pending_review" },
          data: { status: "failed", errorMsg: result.error.slice(0, AUTOCUT_ERROR_MAX) },
        });
        if (r.count > 0) failCount += 1;
      } else {
        const r = await tx.mediaAutocutJob.updateMany({
          where: { id: result.job_id, reviewStatus: "pending_review" },
          data: {
            status: "done",
            reviewStatus: "pending_review",
            errorMsg: null,
            proposedStart: result.proposed_start ?? null,
            proposedEnd: result.proposed_end ?? null,
            transcriptJson: result.transcript_json ?? null,
            language: result.language ?? null,
            // Pré-remplir les confirmed avec les proposed pour simplifier la review
            confirmedStart: result.proposed_start ?? null,
            confirmedEnd: result.proposed_end ?? null,
          },
        });
        if (r.count > 0) doneCount += 1;
      }
    }

    // Le worker peut renvoyer moins d'entrées que d'assets (budget de pack épuisé,
    // pack interrompu) et un job_id peut ne pas matcher. Sans ce filet, ces jobs
    // restent `pending`/`processing` à vie et gonflent les compteurs.
    const orphans = await tx.mediaAutocutJob.updateMany({
      where: { batchId, status: { in: AUTOCUT_ACTIVE_STATUSES } },
      data: {
        status: "failed",
        errorMsg:
          "Aucun résultat renvoyé par le worker pour ce fichier (pack terminé sans ce job). À relancer.",
      },
    });
    failCount += orphans.count;

    const batchStatus: ApplyAutocutResultsOutcome["batchStatus"] =
      failCount === 0 ? "done" : doneCount === 0 ? "failed" : "partial";

    await tx.mediaAutocutBatch.updateMany({
      where: { id: batchId },
      data: { status: batchStatus, doneCount, failCount },
    });

    return { batchStatus, doneCount, failCount };
  });

  console.info(
    `[mediaAutocut] batch=${batchId} ${outcome.batchStatus} — done=${outcome.doneCount} failed=${outcome.failCount}`,
  );
  return outcome;
}

// ─── Réconciliation / purge ──────────────────────────────────────────────────

export interface AutocutReconcileCutoffs {
  /** now − PROCESSING_STALL_MS (30 min) */
  processingCutoff: Date;
  /** now − QUEUED_STALL_MS (10 min) */
  queuedCutoff: Date;
  /** now − 7 j — au-delà, un échec est supprimé plutôt qu'affiché. */
  failedRetentionCutoff: Date;
}

export interface AutocutReconcileResult {
  /** batches dont l'output RunPod a été récupéré et rejoué (webhook perdu). */
  recovered: number;
  /** batches passés failed depuis l'API RunPod (statut terminal ou stall). */
  batchesFailed: number;
  /** jobs ayant hérité de l'errorMsg de leur batch déjà failed. */
  inherited: number;
  processing: number;
  pending: number;
  purged: number;
}

/** Fenêtre au-delà de laquelle un batch sans nouvelles est considéré mort. */
const AUTOCUT_RUNPOD_STALL_MS = 30 * 60 * 1000;
/** Rétention des échecs avant purge automatique. */
export const AUTOCUT_FAILED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Répare et nettoie les MediaAutocutJob laissés en plan.
 *
 * Appelée depuis /api/admin/jobs/sweep (bouton admin) ET depuis le cron
 * /api/cron/pod-reconcile (toutes les ~15 min) — c'est ce dernier qui rend la
 * purge réellement automatique, le sweep n'étant déclenché qu'à la main.
 *
 * Ne lève jamais : chaque étape est indépendante et le sweep global ne doit pas
 * tomber parce qu'un batch est introuvable.
 */
export async function reconcileAutocutJobs(
  cutoffs: AutocutReconcileCutoffs,
): Promise<AutocutReconcileResult> {
  const out: AutocutReconcileResult = {
    recovered: 0,
    batchesFailed: 0,
    inherited: 0,
    processing: 0,
    pending: 0,
    purged: 0,
  };

  // ── 1. Récupérer le vrai résultat quand le webhook s'est perdu ─────────────
  // Même pattern que reconcileDispatchedCoverPacks, mais on peut faire mieux :
  // l'output autocut est auto-suffisant, donc un batch COMPLETED dont le webhook
  // a été perdu est rejoué intégralement au lieu d'être jeté.
  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  const apiKey = process.env.RUNPOD_API_KEY;
  if (endpointId && apiKey) {
    const stuck = await prisma.mediaAutocutBatch.findMany({
      where: { status: "processing", runpodId: { not: null } },
      select: { id: true, runpodId: true, updatedAt: true },
      take: 50,
    });

    for (const batch of stuck) {
      try {
        const phase = await resolveRunpodJobPhase<MediaAutocutBatchOutput>(
          endpointId,
          apiKey,
          batch.runpodId!,
          batch.updatedAt,
          AUTOCUT_RUNPOD_STALL_MS,
        );
        if (phase.phase === "in_progress" || phase.phase === "unreachable") continue;

        if (phase.phase === "completed" && phase.output?.results) {
          await applyAutocutBatchResults(batch.id, phase.output.results);
          out.recovered += 1;
        } else if (phase.phase === "completed") {
          // COMPLETED sans results : le worker a rendu un output inexploitable.
          await failAutocutBatch(batch.id, phase.output?.error ?? "output RunPod sans résultats");
          out.batchesFailed += 1;
        } else if (phase.phase === "failed") {
          await failAutocutBatch(batch.id, phase.error);
          out.batchesFailed += 1;
        } else {
          await failAutocutBatch(batch.id, "le pack d'analyse n'a plus donné signe de vie");
          out.batchesFailed += 1;
        }
      } catch (err) {
        console.warn(`[mediaAutocut] réconciliation batch=${batch.id} échouée:`, err);
      }
    }
  }

  // ── 2. Héritage : jobs vivants d'un batch déjà failed ─────────────────────
  const failedBatches = await prisma.mediaAutocutBatch.findMany({
    where: { status: "failed", jobs: { some: { status: { in: AUTOCUT_ACTIVE_STATUSES } } } },
    select: { id: true, errorMsg: true },
    take: 500,
  });
  for (const batch of failedBatches) {
    const r = await prisma.mediaAutocutJob.updateMany({
      where: { batchId: batch.id, status: { in: AUTOCUT_ACTIVE_STATUSES } },
      data: {
        status: "failed",
        errorMsg: (batch.errorMsg ?? "Pack RunPod en échec").slice(0, AUTOCUT_ERROR_MAX),
      },
    });
    out.inherited += r.count;
  }

  // ── 3. Zombies hors batch failed ──────────────────────────────────────────
  const [processing, pending] = await Promise.all([
    prisma.mediaAutocutJob.updateMany({
      where: { status: "processing", updatedAt: { lt: cutoffs.processingCutoff } },
      data: {
        status: "failed",
        errorMsg: "Analyse bloquée en processing — webhook RunPod jamais reçu (sweep automatique)",
      },
    }),
    prisma.mediaAutocutJob.updateMany({
      where: { status: "pending", updatedAt: { lt: cutoffs.queuedCutoff } },
      data: {
        status: "failed",
        errorMsg: "Analyse bloquée en pending — soumission RunPod jamais finalisée (sweep automatique)",
      },
    }),
  ]);
  out.processing = processing.count;
  out.pending = pending.count;

  // ── 4. Purge des vieux échecs ─────────────────────────────────────────────
  // Les jobs appliqués (coupe effective) et les applies en vol sont préservés.
  const purged = await prisma.mediaAutocutJob.deleteMany({
    where: {
      status: "failed",
      reviewStatus: { not: "applied" },
      editJobId: null,
      updatedAt: { lt: cutoffs.failedRetentionCutoff },
    },
  });
  out.purged = purged.count;

  if (out.purged > 0) {
    await prisma.mediaAutocutBatch.deleteMany({ where: { jobs: { none: {} } } }).catch(() => {});
  }

  return out;
}
