/**
 * workspaceModel — vue « lots » de /transcriptions : fusion des jobs serveur et
 * des uploads en cours dans le navigateur.
 *
 * Un fichier déposé vit d'abord comme un upload local (en attente, préparation,
 * envoi), puis comme un job serveur (prepare → jobId) dont l'upload finit par
 * être confirmé (`uploadedAt`). Ce module décide, ligne par ligne, quelle
 * source fait foi et ce que le lot peut faire. Pur et testé unitairement.
 */

import {
  groupJobsIntoBatches,
  jobStatusDisplay,
  triState,
  type JobBadgeVariant,
  type TranscriptionJobSummary,
} from "@/lib/transcription/batches";

export type UploadPhase =
  | "pending"
  | "preparing"
  | "uploading"
  | "finalizing"
  | "done"
  | "error"
  | "cancelled";

const ACTIVE_PHASES: ReadonlySet<UploadPhase> = new Set(["pending", "preparing", "uploading", "finalizing"]);

export function isUploadActive(upload: TranscriptionUpload | null | undefined): boolean {
  return !!upload && ACTIVE_PHASES.has(upload.phase);
}

export type TranscriptionUpload = {
  /** Identifiant local (le job serveur n'existe qu'après le prepare). */
  key: string;
  batchId: string;
  fileName: string;
  size: number;
  phase: UploadPhase;
  /** 0 → 1. */
  progress: number;
  jobId: string | null;
  error: string | null;
  /** Instant du dépôt (ISO) : ordre des lots qui n'ont encore aucun job serveur. */
  droppedAt: string;
  /** Rang dans le dépôt : ordre des lignes pas encore préparées. */
  order: number;
};

export type BatchRow = {
  key: string;
  job: TranscriptionJobSummary | null;
  upload: TranscriptionUpload | null;
};

export type WorkspaceBatch = {
  key: string;
  batchId: string | null;
  /** Création du lot (premier job, ou dépôt si aucun job encore). */
  createdAt: string;
  rows: BatchRow[];
};

/**
 * Lots à afficher, du plus récent au plus ancien. Un dépôt dont aucun fichier
 * n'est encore préparé forme déjà son lot (lignes « En attente »).
 */
export function buildWorkspaceBatches(
  jobs: TranscriptionJobSummary[],
  uploads: TranscriptionUpload[],
): WorkspaceBatch[] {
  const uploadsByJobId = new Map<string, TranscriptionUpload>();
  const uploadsByBatch = new Map<string, TranscriptionUpload[]>();
  for (const upload of uploads) {
    if (upload.jobId) uploadsByJobId.set(upload.jobId, upload);
    const list = uploadsByBatch.get(upload.batchId);
    if (list) list.push(upload);
    else uploadsByBatch.set(upload.batchId, [upload]);
  }

  const jobIds = new Set(jobs.map((job) => job.id));
  const batches: Array<WorkspaceBatch & { sortKey: string }> = [];
  const seenBatchIds = new Set<string>();

  for (const group of groupJobsIntoBatches(jobs)) {
    const rows: BatchRow[] = group.jobs.map((job) => ({
      key: job.id,
      job,
      upload: uploadsByJobId.get(job.id) ?? null,
    }));
    const batchUploads = group.batchId ? uploadsByBatch.get(group.batchId) ?? [] : [];
    rows.push(...uploadOnlyRows(batchUploads, jobIds));
    const lastDrop = latestDrop(batchUploads);
    if (group.batchId) seenBatchIds.add(group.batchId);
    batches.push({
      key: group.key,
      batchId: group.batchId,
      createdAt: group.createdAt,
      rows,
      sortKey: lastDrop && lastDrop > group.lastActivityAt ? lastDrop : group.lastActivityAt,
    });
  }

  for (const [batchId, batchUploads] of uploadsByBatch) {
    if (seenBatchIds.has(batchId)) continue;
    const rows = uploadOnlyRows(batchUploads, jobIds);
    if (rows.length === 0) continue;
    const firstDrop = batchUploads.reduce((min, u) => (u.droppedAt < min ? u.droppedAt : min), batchUploads[0].droppedAt);
    batches.push({ key: batchId, batchId, createdAt: firstDrop, rows, sortKey: latestDrop(batchUploads) ?? firstDrop });
  }

  return batches
    .sort((a, b) => (a.sortKey !== b.sortKey ? (a.sortKey > b.sortKey ? -1 : 1) : a.key > b.key ? -1 : 1))
    .map((batch) => ({ key: batch.key, batchId: batch.batchId, createdAt: batch.createdAt, rows: batch.rows }));
}

function latestDrop(uploads: TranscriptionUpload[]): string | null {
  return uploads.reduce<string | null>((max, u) => (max === null || u.droppedAt > max ? u.droppedAt : max), null);
}

/**
 * Uploads sans job serveur visible : pas encore préparés, préparation échouée,
 * ou job créé mais pas encore remonté par le rafraîchissement. Un upload annulé
 * avant d'avoir créé de job disparaît.
 */
function uploadOnlyRows(uploads: TranscriptionUpload[], jobIds: Set<string>): BatchRow[] {
  return uploads
    .filter((upload) => !(upload.jobId && jobIds.has(upload.jobId)))
    .filter((upload) => !(upload.phase === "cancelled" && !upload.jobId))
    .sort((a, b) => a.order - b.order)
    .map((upload) => ({ key: upload.key, job: null, upload }));
}

// ─── Ligne ────────────────────────────────────────────────────────────────────

export type RowDisplay = {
  label: string;
  variant: JobBadgeVariant;
  /** Progression d'upload (0 → 1) à afficher, sinon null. */
  progress: number | null;
  /** Message d'erreur à afficher sous le nom, sinon null. */
  error: string | null;
};

const UPLOAD_LABELS: Record<Exclude<UploadPhase, "done" | "error" | "cancelled">, string> = {
  pending: "En attente d'envoi",
  preparing: "Préparation…",
  uploading: "Envoi",
  finalizing: "Finalisation…",
};

export function rowDisplay(row: BatchRow): RowDisplay {
  const { job, upload } = row;

  if (upload && isUploadActive(upload)) {
    const phase = upload.phase as keyof typeof UPLOAD_LABELS;
    return {
      label: phase === "uploading" ? `Envoi ${Math.round(upload.progress * 100)} %` : UPLOAD_LABELS[phase],
      variant: "info",
      progress: phase === "uploading" ? upload.progress : null,
      error: null,
    };
  }
  if (upload?.phase === "error") {
    return { label: "Échec de l'envoi", variant: "danger", progress: null, error: upload.error };
  }
  if (!job) {
    // Upload terminé dont le job n'est pas encore remonté par le rafraîchissement.
    return upload?.phase === "done"
      ? { label: "Prête", variant: "default", progress: null, error: null }
      : { label: "Annulée", variant: "default", progress: null, error: null };
  }
  if (job.status === "QUEUED" && upload?.phase === "done") {
    // Confirmé côté serveur ; `uploadedAt` arrivera au prochain rafraîchissement.
    return { label: "Prête", variant: "default", progress: null, error: null };
  }
  const display = jobStatusDisplay(job);
  // Motif affiché pour un échec, et pour une vidéo remise en attente (« À relancer »).
  const showError =
    (job.status === "FAILED" && display.variant === "danger") || (job.status === "QUEUED" && job.uploadedAt)
      ? job.errorMsg
      : null;
  return { ...display, progress: null, error: showError };
}

/** Le job peut-il être lancé depuis sa ligne ? (le serveur revérifie l'upload) */
export function canLaunchRow(row: BatchRow): boolean {
  return row.job?.status === "QUEUED" && !isUploadActive(row.upload) && row.upload?.phase !== "error";
}

/** Une vidéo prête : comptée par « Lancer les N prêtes ». */
export function isRowReady(row: BatchRow): boolean {
  return (
    row.job?.status === "QUEUED" &&
    !isUploadActive(row.upload) &&
    (row.job.uploadedAt !== null || row.upload?.phase === "done")
  );
}

// ─── Lot ──────────────────────────────────────────────────────────────────────

export type WorkspaceBatchSummary = {
  total: number;
  uploading: number;
  ready: number;
  processing: number;
  completed: number;
  failed: number;
  /** Annulées volontairement (ni terminées ni en échec). */
  cancelled: number;
  /** Envois échoués dans ce navigateur (réessayables en un clic). */
  uploadErrors: number;
  /** État de la case « Identifier les intervenants » du lot. */
  diarization: boolean | "indeterminate";
  /** Des vidéos sont encore réglables (pas encore lancées). */
  configurable: boolean;
  isActive: boolean;
};

/**
 * Compteurs d'un lot. Les fichiers pas encore préparés n'ont pas de job : ils
 * suivent le réglage du lot (`pendingDiarization`), appliqué à leur prepare.
 */
export function summarizeWorkspaceBatch(batch: WorkspaceBatch, pendingDiarization: boolean): WorkspaceBatchSummary {
  const summary: WorkspaceBatchSummary = {
    total: 0,
    uploading: 0,
    ready: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    uploadErrors: 0,
    diarization: false,
    configurable: false,
    isActive: false,
  };
  let diarizationOn = 0;
  let diarizationOff = 0;

  for (const row of batch.rows) {
    const { job, upload } = row;
    if (!job && upload?.phase === "cancelled") continue;
    summary.total += 1;

    if (isUploadActive(upload)) summary.uploading += 1;
    if (upload?.phase === "error") summary.uploadErrors += 1;
    if (isRowReady(row)) summary.ready += 1;

    if (job) {
      if (job.status === "QUEUED") {
        if (job.enableDiarization) diarizationOn += 1;
        else diarizationOff += 1;
      } else if (job.status === "PROCESSING") {
        summary.processing += 1;
      } else if (job.status === "COMPLETED") {
        summary.completed += 1;
      } else if (job.status === "FAILED") {
        if (jobStatusDisplay(job).variant === "danger") summary.failed += 1;
        else summary.cancelled += 1;
      }
    } else if (isUploadActive(upload)) {
      if (pendingDiarization) diarizationOn += 1;
      else diarizationOff += 1;
    } else if (upload?.phase === "error") {
      summary.failed += 1;
    }
  }

  summary.diarization = triState(diarizationOn, diarizationOff);
  summary.configurable = diarizationOn + diarizationOff > 0;
  summary.isActive = summary.uploading > 0 || summary.configurable || summary.processing > 0;
  return summary;
}
