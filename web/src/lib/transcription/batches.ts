/**
 * batches — logique pure des lots de l'outil standalone /transcriptions.
 *
 * Un « lot » regroupe les fichiers déposés d'un coup : ils partagent un
 * `batchId` (UUID généré par le navigateur au dépôt). Les jobs sans batchId
 * (pipeline auto, jobs antérieurs aux lots) forment chacun un groupe d'un seul
 * job, clé = leur id.
 *
 * Module sans dépendance serveur ni React : partagé par le SSR de la page, les
 * routes `/api/transcription/batches/*` et le client, et testé unitairement.
 */

import { parisDayKey, shortDateFr, timeFr } from "@/lib/date/formatFr";

export const TRANSCRIPTION_STATUSES = ["QUEUED", "PROCESSING", "COMPLETED", "FAILED"] as const;
export type TranscriptionStatus = (typeof TRANSCRIPTION_STATUSES)[number];

export function isTranscriptionStatus(value: unknown): value is TranscriptionStatus {
  return typeof value === "string" && (TRANSCRIPTION_STATUSES as readonly string[]).includes(value);
}

/** Job tel que la liste et les lots le manipulent (dates en ISO). */
export type TranscriptionJobSummary = {
  id: string;
  status: TranscriptionStatus;
  inputFilename: string | null;
  model: string;
  language: string;
  /** Mode multi-langue : codes ISO (≥ 2). Vide en mono. */
  languages: string[];
  enableDiarization: boolean;
  hasDiarization: boolean;
  segmentCount: number | null;
  duration: number | null;
  createdAt: string;
  errorMsg: string | null;
  batchId: string | null;
  /** Upload du média source confirmé. Null tant qu'il est en cours. */
  uploadedAt: string | null;
  /**
   * Job du pipeline auto (render ou version montée) : sa source appartient à la
   * publication. L'outil ne propose pas de l'annuler (ce serait casser la chaîne).
   */
  isAuto: boolean;
};

/** Champs Prisma à sélectionner pour construire un `TranscriptionJobSummary`. */
export const TRANSCRIPTION_JOB_SUMMARY_SELECT = {
  id: true,
  status: true,
  inputFilename: true,
  model: true,
  language: true,
  languages: true,
  enableDiarization: true,
  hasDiarization: true,
  segmentCount: true,
  duration: true,
  createdAt: true,
  errorMsg: true,
  batchId: true,
  uploadedAt: true,
  renderId: true,
  publicationVersionId: true,
} as const;

type TranscriptionJobRow = Omit<TranscriptionJobSummary, "status" | "createdAt" | "uploadedAt" | "isAuto"> & {
  status: string;
  createdAt: Date;
  uploadedAt: Date | null;
  renderId: string | null;
  publicationVersionId: string | null;
};

export function toTranscriptionJobSummary(row: TranscriptionJobRow): TranscriptionJobSummary {
  const { renderId, publicationVersionId, ...rest } = row;
  return {
    ...rest,
    // `status` est un String en base (pas un enum). Une valeur inconnue ne doit
    // pas casser l'affichage : elle est traitée comme un échec.
    status: isTranscriptionStatus(row.status) ? row.status : "FAILED",
    createdAt: row.createdAt.toISOString(),
    uploadedAt: row.uploadedAt ? row.uploadedAt.toISOString() : null,
    isAuto: Boolean(renderId || publicationVersionId),
  };
}

// ─── Identifiant de lot ───────────────────────────────────────────────────────

const BATCH_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Un batchId est un UUID (généré par `crypto.randomUUID()` côté navigateur).
 * Toujours lu avec `userId` côté serveur : un identifiant forgé ne peut
 * regrouper que les propres jobs de l'utilisateur.
 */
export function isValidBatchId(value: unknown): value is string {
  return typeof value === "string" && BATCH_ID_RE.test(value);
}

/**
 * Nouvel identifiant de lot (navigateur). `crypto.randomUUID` n'existe qu'en
 * contexte sécurisé (HTTPS, localhost) : repli sur `getRandomValues` pour un
 * accès en HTTP sur le réseau local.
 */
export function newBatchId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ─── Groupement ───────────────────────────────────────────────────────────────

export type TranscriptionBatchGroup = {
  /** batchId, ou id du job pour un job hors lot. */
  key: string;
  batchId: string | null;
  /** Création du premier job du lot (libellé « Lot du … »). */
  createdAt: string;
  /** Création du job le plus récent (tri des groupes). */
  lastActivityAt: string;
  /** Ordre de dépôt : createdAt croissant, puis id. */
  jobs: TranscriptionJobSummary[];
};

function compareAsc(a: TranscriptionJobSummary, b: TranscriptionJobSummary): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Groupe les jobs par lot, groupes les plus récents d'abord. */
export function groupJobsIntoBatches(jobs: TranscriptionJobSummary[]): TranscriptionBatchGroup[] {
  const byKey = new Map<string, TranscriptionJobSummary[]>();
  for (const job of jobs) {
    const key = job.batchId ?? job.id;
    const list = byKey.get(key);
    if (list) list.push(job);
    else byKey.set(key, [job]);
  }

  const groups: TranscriptionBatchGroup[] = [];
  for (const [key, list] of byKey) {
    const sorted = [...list].sort(compareAsc);
    groups.push({
      key,
      batchId: sorted[0].batchId,
      createdAt: sorted[0].createdAt,
      lastActivityAt: sorted[sorted.length - 1].createdAt,
      jobs: sorted,
    });
  }

  return groups.sort((a, b) => {
    if (a.lastActivityAt !== b.lastActivityAt) return a.lastActivityAt > b.lastActivityAt ? -1 : 1;
    return a.key > b.key ? -1 : a.key < b.key ? 1 : 0;
  });
}

/**
 * Fusionne deux listes de jobs par id (la seconde l'emporte), triées du plus
 * récent au plus ancien. Sert à intégrer un rafraîchissement de la première
 * page sans perdre les pages plus anciennes déjà chargées.
 */
export function mergeJobs(
  current: TranscriptionJobSummary[],
  incoming: TranscriptionJobSummary[],
): TranscriptionJobSummary[] {
  const byId = new Map<string, TranscriptionJobSummary>();
  for (const job of current) byId.set(job.id, job);
  for (const job of incoming) byId.set(job.id, job);
  return [...byId.values()].sort((a, b) => -compareAsc(a, b));
}

// ─── Synthèse d'un lot ────────────────────────────────────────────────────────

export type BatchSummary = {
  total: number;
  /** QUEUED dont l'upload est confirmé : lançables. */
  ready: number;
  /** QUEUED sans upload confirmé (en cours, interrompu, ou antérieur aux lots). */
  awaitingUpload: number;
  processing: number;
  completed: number;
  failed: number;
  readyJobIds: string[];
  /** Tous les QUEUED : cibles du réglage « intervenants » du lot. */
  queuedJobIds: string[];
  completedJobIds: string[];
  /** Répartition du réglage « intervenants » parmi les QUEUED. */
  diarizationOn: number;
  diarizationOff: number;
  /** Au moins un job QUEUED ou PROCESSING. */
  isActive: boolean;
};

export function summarizeBatch(jobs: TranscriptionJobSummary[]): BatchSummary {
  const summary: BatchSummary = {
    total: jobs.length,
    ready: 0,
    awaitingUpload: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    readyJobIds: [],
    queuedJobIds: [],
    completedJobIds: [],
    diarizationOn: 0,
    diarizationOff: 0,
    isActive: false,
  };
  for (const job of jobs) {
    switch (job.status) {
      case "QUEUED":
        summary.queuedJobIds.push(job.id);
        if (job.enableDiarization) summary.diarizationOn += 1;
        else summary.diarizationOff += 1;
        if (job.uploadedAt) {
          summary.ready += 1;
          summary.readyJobIds.push(job.id);
        } else {
          summary.awaitingUpload += 1;
        }
        break;
      case "PROCESSING":
        summary.processing += 1;
        break;
      case "COMPLETED":
        summary.completed += 1;
        summary.completedJobIds.push(job.id);
        break;
      case "FAILED":
        summary.failed += 1;
        break;
    }
  }
  summary.isActive = summary.queuedJobIds.length > 0 || summary.processing > 0;
  return summary;
}

/** État d'une case à cocher de groupe à partir des cochés / non cochés. */
export function triState(on: number, off: number): boolean | "indeterminate" {
  if (on > 0 && off > 0) return "indeterminate";
  return on > 0;
}

// ─── Affichage ────────────────────────────────────────────────────────────────

/** « Lot du 4 oct. · 14:32 » (fuseau Europe/Paris, comme le reste de l'app). */
export function batchLabel(createdAtIso: string): string {
  return `Lot du ${shortDateFr(createdAtIso)} · ${timeFr(createdAtIso)}`;
}

export type JobBadgeVariant = "default" | "success" | "danger" | "info" | "warning";

/** Message d'erreur posé par une annulation volontaire (DELETE). */
export const CANCELLED_ERROR_MSG = "Annulé";

/** Libellé et ton du statut d'un job côté serveur (hors upload en cours). */
export function jobStatusDisplay(job: Pick<TranscriptionJobSummary, "status" | "uploadedAt" | "errorMsg">): {
  label: string;
  variant: JobBadgeVariant;
} {
  switch (job.status) {
    case "QUEUED":
      if (!job.uploadedAt) return { label: "Envoi incomplet", variant: "warning" };
      // Remise en attente avec un motif (envoi au moteur interrompu ou refusé).
      return job.errorMsg ? { label: "À relancer", variant: "warning" } : { label: "Prête", variant: "default" };
    case "PROCESSING":
      return { label: "En cours", variant: "info" };
    case "COMPLETED":
      return { label: "Terminée", variant: "success" };
    case "FAILED":
      return job.errorMsg === CANCELLED_ERROR_MSG
        ? { label: "Annulée", variant: "default" }
        : { label: "Échec", variant: "danger" };
  }
}

// ─── Archive ZIP ──────────────────────────────────────────────────────────────

const MAX_STEM_LENGTH = 120;

/**
 * Le nom vient du client (inputFilename, `?stem=`) : il est tronqué AVANT tout
 * traitement, pour que le coût reste borné quelle que soit sa longueur.
 */
const MAX_RAW_NAME_LENGTH = 4 * MAX_STEM_LENGTH;

/** Noms que Windows refuse comme nom de fichier, quelle que soit l'extension. */
const WINDOWS_RESERVED_STEM = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * Retire points et espaces en tête et en queue, en temps linéaire. Une regex
 * `[\s.]+$` revient en arrière sur chaque suite de points : quadratique, et un
 * nom de 80 000 points figeait le process (ReDoS).
 */
function trimDotsAndSpaces(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && (value[start] === "." || value[start] === " ")) start += 1;
  while (end > start && (value[end - 1] === "." || value[end - 1] === " ")) end -= 1;
  return value.slice(start, end);
}

/**
 * Nom de fichier sûr, accents conservés : retire les séparateurs de chemin et
 * les caractères interdits par Windows/macOS, qui casseraient l'extraction d'un
 * ZIP ou créeraient des sous-dossiers.
 */
export function sanitizeFileStem(raw: string | null | undefined, fallback: string): string {
  const collapsed = (raw ?? "")
    .slice(0, MAX_RAW_NAME_LENGTH)
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ");
  const cleaned = trimDotsAndSpaces(trimDotsAndSpaces(collapsed).slice(0, MAX_STEM_LENGTH));
  if (!cleaned) return fallback;
  return WINDOWS_RESERVED_STEM.test(cleaned) ? `_${cleaned}` : cleaned;
}

/** Nom de base (sans extension) d'une sortie à partir du nom de la vidéo source. */
export function sanitizeZipStem(filename: string | null | undefined, fallback: string): string {
  const name = filename ?? "";
  // Extension = après le dernier point, s'il n'est suivi d'aucun séparateur
  // de chemin (lastIndexOf : linéaire, sans regex).
  const lastDot = name.lastIndexOf(".");
  const lastSeparator = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  const stem = lastDot > lastSeparator && lastDot < name.length - 1 ? name.slice(0, lastDot) : name;
  return sanitizeFileStem(stem, fallback);
}

/**
 * En-tête Content-Disposition d'un téléchargement, noms accentués compris :
 * `filename` ASCII en repli + `filename*` UTF-8 (RFC 5987), que les navigateurs
 * actuels préfèrent.
 */
export function attachmentDisposition(filename: string): string {
  const ascii = filename
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Noms d'entrées ZIP uniques, dans l'ordre d'entrée. Deux vidéos homonymes
 * (`IMG_0001.MOV` ×2) donnent `IMG_0001.srt` puis `IMG_0001 (2).srt`. La
 * comparaison ignore la casse : les systèmes de fichiers de macOS et Windows
 * aussi.
 */
export function buildZipEntryNames(filenames: (string | null)[], ext: string): string[] {
  const used = new Set<string>();
  return filenames.map((filename, index) => {
    const stem = sanitizeZipStem(filename, `transcription-${index + 1}`);
    let candidate = `${stem}.${ext}`;
    let n = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${stem} (${n}).${ext}`;
      n += 1;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export const BATCH_DOWNLOAD_FORMATS = ["srt", "json"] as const;
export type BatchDownloadFormat = (typeof BATCH_DOWNLOAD_FORMATS)[number];

export function isBatchDownloadFormat(value: unknown): value is BatchDownloadFormat {
  return typeof value === "string" && (BATCH_DOWNLOAD_FORMATS as readonly string[]).includes(value);
}

/** Nom ASCII de l'archive : `transcriptions-2026-10-04-1a2b3c4d-srt.zip` (jour à Paris). */
export function batchArchiveName(batchId: string, createdAt: Date, format: BatchDownloadFormat): string {
  return `transcriptions-${parisDayKey(createdAt)}-${batchId.slice(0, 8)}-${format}.zip`;
}
