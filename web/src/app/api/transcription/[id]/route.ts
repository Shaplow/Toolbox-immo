/**
 * GET /api/transcription/[id]
 *
 * Retourne le statut d'un TranscriptionJob.
 * Si le job est PROCESSING et a un runpodJobId, interroge RunPod et met à jour la DB.
 *
 * Réponse :
 *   {
 *     id, status, inputFilename, model, language,
 *     enableDiarization, hasDiarization,
 *     segmentCount?, duration?, createdAt, errorMsg?
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { deleteFromR2, r2Configured } from "@/lib/r2";
import { resolveRunpodJobPhase, isPodJobId } from "@/lib/runpod";
import { notifyUser } from "@/lib/sseStore";
import { isSourceReleasable, releaseJobSource } from "@/lib/upload/releaseJobSource";
import { isAutoPipelineJob } from "@/lib/transcription/staleRules";
import { CANCELLED_ERROR_MSG } from "@/lib/transcription/batches";
import { applyTranscriptionOutcome } from "@/lib/services/transcription/applyOutcome";
import { expireStaleTranscriptionJobs } from "@/lib/services/transcription/expireStale";
import { sanitizeLanguage, sanitizeLanguages } from "@/lib/transcriptionLanguages";

const RUNPOD_API_KEY     = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;
const HF_TOKEN           = process.env.HF_TOKEN;

/**
 * Jobs PROCESSING without resolution for longer than this are considered stalled.
 *
 * 6 h et non 2 h : une transcription de gros rush enchaîne l'extraction audio
 * (ffmpeg lit ~70 % du fichier depuis R2) puis Whisper. À 8 Mo/s, un rush de
 * 100 Go dépasse largement 2 h — le job était donc marqué FAILED alors que le
 * worker travaillait encore, ET sa source R2 était nettoyée sous ses pieds
 * (cf. plus bas dans ce fichier). Doit rester cohérent avec
 * PROCESSING_STALL_MS du sweep et STALE_JOB_HOURS de podOrchestrator.
 */
const STALL_MS = 6 * 60 * 60 * 1000; // 6 hours

const ALLOWED_MODELS = new Set([
  "turbo", "large-v3", "large-v3-turbo", "medium", "small", "base", "tiny",
]);

function sanitizeModel(value: unknown): string {
  const sanitizedValue = String(value ?? "turbo").trim().toLowerCase();
  return ALLOWED_MODELS.has(sanitizedValue) ? sanitizedValue : "turbo";
}

function toBoolean(value: unknown, defaultValue = false): boolean {
  if (value == null) return defaultValue;
  const sanitizedValue = String(value).trim().toLowerCase();
  return sanitizedValue === "true" || sanitizedValue === "1" || sanitizedValue === "yes";
}

type RunpodOutput = {
  output_key?: string;
  segment_count?: number;
  duration?: number;
  language?: string;
  has_diarization?: boolean;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

  // ─── Terminal states — retourner directement ──────────────────────────────
  if (job.status === "COMPLETED" || job.status === "FAILED") {
    return NextResponse.json(formatJob(job));
  }
  // ─── Pre-submit stall (QUEUED / PROCESSING without runpodJobId) ──────────
  // Règles : lib/transcription/staleRules.ts ; traitement (guérison d'un upload
  // fini sans confirmation, remise en attente d'un envoi interrompu, FAILED
  // sinon) : lib/services/transcription/expireStale.ts. Une vidéo PRÊTE n'expire
  // plus pendant qu'on prépare un lot.
  if ((job.status === "QUEUED" || job.status === "PROCESSING") && !job.runpodJobId) {
    const summary = await expireStaleTranscriptionJobs([job]);
    const changed =
      summary.healed + summary.requeued +
      summary.failed.upload_abandoned + summary.failed.never_launched + summary.failed.dispatch_interrupted;
    if (changed === 0) return NextResponse.json(formatJob(job));
    console.warn(`[transcription/status] job ${job.id} expiré`, summary);
    const current = await prisma.transcriptionJob.findUniqueOrThrow({ where: { id: job.id } });
    return NextResponse.json(formatJob(current));
  }
  // ─── Si PROCESSING avec runpodJobId, déléguer à resolveRunpodJobPhase ─────
  // L'issue est appliquée par applyTranscriptionOutcome, comme pour le webhook :
  // une seule transition, source libérée avec ses gardes (jamais la vidéo d'un
  // render ou d'une version montée), SSE et chaîne aval (traduction, etc.).
  if (job.status === "PROCESSING" && job.runpodJobId && RUNPOD_API_KEY && RUNPOD_ENDPOINT_ID) {
    const resolved = await resolveRunpodJobPhase<RunpodOutput>(
      RUNPOD_ENDPOINT_ID,
      RUNPOD_API_KEY,
      job.runpodJobId,
      job.updatedAt,
      STALL_MS
    );

    if (resolved.phase === "completed") {
      await applyTranscriptionOutcome(job, { kind: "completed", output: resolved.output ?? {} });
      const current = await prisma.transcriptionJob.findUniqueOrThrow({ where: { id: job.id } });
      return NextResponse.json(formatJob(current));
    }

    if (resolved.phase === "failed" || resolved.phase === "stalled") {
      const errorMsg =
        resolved.phase === "stalled"
          ? "Job bloqué : pas de réponse depuis plus de 6 heures"
          : (resolved as { phase: "failed"; error: string }).error;
      const applied = await applyTranscriptionOutcome(job, { kind: "failed", errorMsg });
      if (applied && resolved.phase === "stalled") {
        console.warn(`[transcription/status] job ${job.id} stalled (runpodJobId=${job.runpodJobId}) — marked FAILED`);
      }
      const current = await prisma.transcriptionJob.findUniqueOrThrow({ where: { id: job.id } });
      return NextResponse.json(formatJob(current));
    }

    if (resolved.phase === "unreachable") {
      return NextResponse.json({ ...formatJob(job), runpodUnreachable: true });
    }
    return NextResponse.json({
      ...formatJob(job),
      runpodQueueStatus: resolved.runpodStatus ?? null,
      isOnPod: isPodJobId(job.runpodJobId),
    });
    // in_progress — fall through
  }

  return NextResponse.json(formatJob(job));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
  if (job.status !== "QUEUED") {
    return NextResponse.json(
      { error: "Seuls les jobs en attente peuvent être modifiés." },
      { status: 409 }
    );
  }

  let body: {
    model?: unknown;
    language?: unknown;
    languages?: unknown;
    enable_diarization?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  // PATCH partiel : seuls les champs présents dans le corps changent. L'UI
  // enregistre chaque réglage au fil de l'eau (la case « intervenants » seule,
  // ou la langue seule) ; un champ omis ne doit jamais être réinitialisé —
  // `enable_diarization` absent repassait à false, `model` absent à « turbo »,
  // et un job multi-langue repassait en mono (bug data-loss d'origine).
  const has = (field: string) => Object.prototype.hasOwnProperty.call(body, field);
  const data: Prisma.TranscriptionJobUpdateManyMutationInput = { errorMsg: null };

  if (has("model")) data.model = sanitizeModel(body.model);
  if (has("enable_diarization")) data.enableDiarization = toBoolean(body.enable_diarization);

  const languages = has("languages") ? sanitizeLanguages(body.languages) : null;
  if (languages !== null) data.languages = languages;
  if (languages && languages.length > 0) {
    data.language = languages[0];
  } else if (has("language")) {
    data.language = sanitizeLanguage(body.language, job.language);
  }

  if (data.enableDiarization && !HF_TOKEN) {
    return NextResponse.json(
      { error: "La diarisation n'est pas disponible sur ce serveur (HF_TOKEN non configuré)." },
      { status: 503 }
    );
  }

  const patchResult = await prisma.transcriptionJob.updateMany({
    where: { id: job.id, status: "QUEUED" },
    data,
  });

  if (patchResult.count === 0) {
    // Job transitioned away from QUEUED between the status check and the update
    return NextResponse.json(
      { error: "Seuls les jobs en attente peuvent être modifiés." },
      { status: 409 }
    );
  }

  const updated = await prisma.transcriptionJob.findUniqueOrThrow({ where: { id: job.id } });
  return NextResponse.json(formatJob(updated));
}

/**
 * DELETE /api/transcription/[id]
 *
 * Annule un job de transcription qui est encore QUEUED ou PROCESSING.
 *
 * - Upload jamais confirmé (QUEUED, `uploadedAt` nul, hors pipeline auto) : la
 *   ligne est SUPPRIMÉE — c'est un upload annulé ou échoué côté navigateur, pas
 *   une transcription ; la garder gonflerait les « échecs » du lot à chaque
 *   réessai. Réponse `{ id, deleted: true }`.
 * - Sinon : FAILED « Annulé », source libérée via releaseJobSource — dont les
 *   gardes protègent la vidéo d'un render OU d'une version montée (l'ancien code
 *   ne testait que `renderId` et effaçait la vidéo de la version).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
  if (job.status === "COMPLETED" || job.status === "FAILED") {
    return NextResponse.json({ error: "Ce job ne peut plus être annulé." }, { status: 409 });
  }

  if (job.status === "QUEUED" && !job.uploadedAt && !isAutoPipelineJob(job)) {
    const removed = await prisma.transcriptionJob.deleteMany({
      where: { id: job.id, status: "QUEUED", uploadedAt: null },
    });
    if (removed.count > 0) {
      // Upload multipart abandonné : ses parties sont libérées par /upload-abort
      // (client) et par le nettoyage des multiparts orphelins.
      if (job.inputKey && isSourceReleasable("transcription", job) && r2Configured()) {
        deleteFromR2(job.inputKey).catch((err) =>
          console.warn(`[transcription/cancel] R2 cleanup failed for key=${job.inputKey}:`, err)
        );
      }
      return NextResponse.json({ id: job.id, deleted: true });
    }
  }

  const cancelled = await prisma.transcriptionJob.updateMany({
    where: { id: job.id, status: { in: ["QUEUED", "PROCESSING"] } },
    data: { status: "FAILED", errorMsg: CANCELLED_ERROR_MSG },
  });
  if (cancelled.count === 0) {
    return NextResponse.json({ error: "Ce job ne peut plus être annulé." }, { status: 409 });
  }
  await releaseJobSource(prisma, "transcription", job).catch((err) =>
    console.warn(`[transcription/cancel] libération source échouée job=${job.id}:`, err)
  );
  notifyUser(job.userId, { jobType: "transcription", jobId: job.id, status: "FAILED", errorMsg: CANCELLED_ERROR_MSG });

  const updated = await prisma.transcriptionJob.findUniqueOrThrow({ where: { id: job.id } });
  return NextResponse.json(formatJob(updated));
}

function formatJob(job: {
  id: string;
  status: string;
  inputFilename: string | null;
  model: string;
  language: string;
  languages?: string[];
  enableDiarization: boolean;
  hasDiarization: boolean;
  segmentCount: number | null;
  duration: number | null;
  createdAt: Date;
  errorMsg: string | null;
  outputJsonKey?: string | null;
  batchId?: string | null;
  uploadedAt?: Date | null;
}) {
  return {
    id: job.id,
    status: job.status,
    inputFilename: job.inputFilename,
    model: job.model,
    language: job.language,
    languages: job.languages ?? [],
    enableDiarization: job.enableDiarization,
    hasDiarization: job.hasDiarization,
    segmentCount: job.segmentCount,
    duration: job.duration,
    createdAt: job.createdAt,
    errorMsg: job.errorMsg,
    batchId: job.batchId ?? null,
    uploadedAt: job.uploadedAt ?? null,
    hasOutput: !!job.outputJsonKey,
  };
}
