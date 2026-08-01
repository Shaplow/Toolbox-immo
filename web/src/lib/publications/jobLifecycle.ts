/**
 * jobLifecycle.ts — Helpers V6 pour le concept "job actif" + invalidation stale.
 *
 * Avant V6 :
 *   - `latestCaptionJob = slot.captionJobs[0]` (createdAt desc) → masquait
 *     un COMPLETED précédent dès qu'un retry PROCESSING arrivait.
 *   - Aucun cascade d'invalidation : promote V2 laissait les CaptionJob/Cover/
 *     Description V1 silencieusement actifs.
 *
 * Désormais (V6) :
 *   - `slot.activeCaptionJobId` (FK @unique) matérialise le job courant.
 *   - `job.staleSince` marque l'obsolescence sans supprimer le job.
 *   - Ces helpers font la résolution + cascade.
 */

import type { CaptionJob, CoverFramePack, DescriptionJob, PrismaClient, TranscriptionJob } from "@prisma/client";
import { Prisma } from "@prisma/client";

/**
 * Type union accepté pour les helpers qui peuvent tourner en transaction.
 * Permet d'appeler ces helpers depuis un callback `$transaction(async (tx) => ...)`
 * ou directement avec `prisma`. Sans ça, on a un risque de fenêtre commit↔helper
 * où des webhooks parallèles peuvent corrompre l'état (cf. bug-hunter P1.1).
 */
type PrismaTxOrClient = PrismaClient | Prisma.TransactionClient;

// ── Types utilitaires ──────────────────────────────────────────────────────

type WithStale = { id: string; status: string; staleSince: Date | null };

interface SlotWithActiveJobs {
  activeCaptionJob?: WithStale | null;
  captionJobs?: WithStale[];
  activeCoverPack?: WithStale | null;
  coverFramePacks?: WithStale[];
  activeTranscriptionJob?: WithStale | null;
  transcriptionJobs?: WithStale[];
}

/**
 * Choisit le job COMPLETED non-stale le plus récent dans une liste.
 * Si aucun COMPLETED non-stale → retourne le plus récent quand même
 * (peut être PROCESSING / FAILED / stale).
 */
function fallbackLatest<T extends WithStale>(jobs: T[]): T | null {
  if (!jobs?.length) return null;
  const completedFresh = jobs.find((j) => j.status === "COMPLETED" && !j.staleSince);
  if (completedFresh) return completedFresh;
  return jobs[0] ?? null;
}

// ── Résolution "job actif" pour la fiche ───────────────────────────────────

/**
 * Retourne le caption job affiché dans la fiche.
 * Priorité : `slot.activeCaptionJob` (explicit) → fallback latest COMPLETED
 * non-stale → fallback latest tout court.
 */
export function resolveActiveCaptionJob<T extends WithStale>(slot: {
  activeCaptionJob?: T | null;
  captionJobs?: T[];
}): T | null {
  if (slot.activeCaptionJob) return slot.activeCaptionJob;
  return fallbackLatest(slot.captionJobs ?? []);
}

/**
 * Retourne le cover pack affiché dans la fiche. Cover a un état SELECTED
 * qui est sémantiquement "active" — on prend ça en priorité aussi.
 */
export function resolveActiveCoverPack<T extends WithStale>(slot: {
  activeCoverPack?: T | null;
  coverFramePacks?: T[];
}): T | null {
  if (slot.activeCoverPack) return slot.activeCoverPack;
  const packs = slot.coverFramePacks ?? [];
  if (!packs.length) return null;
  // SELECTED non-stale d'abord
  const selectedFresh = packs.find(
    (p) => p.status === "SELECTED" && !p.staleSince,
  );
  if (selectedFresh) return selectedFresh;
  return fallbackLatest(packs);
}

/**
 * Retourne la transcription "courante" du slot — pour AFFICHER son état.
 * Peut renvoyer un job périmé : c'est voulu, la fiche doit pouvoir dire
 * « obsolète » plutôt que de faire disparaître l'information.
 */
export function resolveActiveTranscription<T extends WithStale>(slot: {
  activeTranscriptionJob?: T | null;
  transcriptionJobs?: T[];
}): T | null {
  if (slot.activeTranscriptionJob) return slot.activeTranscriptionJob;
  return fallbackLatest(slot.transcriptionJobs ?? []);
}

/**
 * Retourne la transcription RÉUTILISABLE telle quelle — pour incruster des
 * sous-titres sans re-transcrire.
 *
 * Contrairement à `resolveActiveTranscription`, exige `staleSince == null` :
 * une transcription périmée décrit une AUTRE vidéo (montage re-rendu, version
 * promue). La réutiliser ré-incrusterait le texte de l'ancienne vidéo, décalé,
 * sans le moindre signal. Renvoyer `null` ici force une nouvelle transcription.
 */
export function resolveReusableTranscription<T extends WithStale>(slot: {
  activeTranscriptionJob?: T | null;
  transcriptionJobs?: T[];
}): T | null {
  const active = resolveActiveTranscription(slot);
  if (!active || active.staleSince) return null;
  return active;
}

/**
 * Retourne la description IA générée la plus récente non-stale (pour
 * historique). La description "courante" affichée vit dans slot.description.
 */
export function resolveActiveDescriptionJob<T extends WithStale>(slot: {
  descriptionJobs?: T[];
}): T | null {
  return fallbackLatest(slot.descriptionJobs ?? []);
}

// ── Cascade d'invalidation ─────────────────────────────────────────────────

export type StaleReason = "version_promoted" | "render_replaced" | "pattern_changed" | "caption_offset_changed";

interface MarkStaleResult {
  captionJobsMarkedCount: number;
  descriptionJobsMarkedCount: number;
  coverPacksMarkedCount: number;
  transcriptionJobsMarkedCount: number;
}

/**
 * Marque comme stale tous les jobs aval rattachés à un slot et reset les
 * pointeurs `active*Id` à null. Idempotent : un job déjà stale n'est pas
 * re-marqué (préserve `staleSince` original pour l'audit).
 *
 * À appeler après promote de version, replacement de render, ou changement
 * de pattern source qui invalide la chaîne actuelle.
 */
export async function markJobsStaleForSlot(
  prisma: PrismaTxOrClient,
  slotId: string,
  reason: StaleReason,
): Promise<MarkStaleResult> {
  const now = new Date();
  const [captions, descriptions, covers, transcriptions] = await Promise.all([
    prisma.captionJob.updateMany({
      where: { slotId, staleSince: null },
      data: { staleSince: now, staleReason: reason },
    }),
    prisma.descriptionJob.updateMany({
      where: { slotId, staleSince: null },
      data: { staleSince: now, staleReason: reason },
    }),
    prisma.coverFramePack.updateMany({
      where: {
        OR: [
          { render: { publicationSlotId: slotId } },
          { publicationVersion: { slotId } },
        ],
        staleSince: null,
      },
      data: { staleSince: now, staleReason: reason },
    }),
    prisma.transcriptionJob.updateMany({
      where: {
        OR: [
          { slotId },
          { render: { publicationSlotId: slotId } },
          { publicationVersion: { slotId } },
        ],
        staleSince: null,
      },
      data: { staleSince: now, staleReason: reason },
    }),
  ]);

  // Reset des pointeurs active* à null (l'admin re-promeut explicitement).
  await prisma.publicationSlot.update({
    where: { id: slotId },
    data: {
      activeCaptionJobId: null,
      activeCoverPackId: null,
      activeTranscriptionJobId: null,
    },
  });

  return {
    captionJobsMarkedCount: captions.count,
    descriptionJobsMarkedCount: descriptions.count,
    coverPacksMarkedCount: covers.count,
    transcriptionJobsMarkedCount: transcriptions.count,
  };
}

// ── Promotion explicite ────────────────────────────────────────────────────

/**
 * Promeut un caption job comme "actif" pour son slot. Vérifie que le job
 * appartient bien au slot avant de set le pointeur.
 */
export async function promoteCaptionJob(
  prisma: PrismaClient,
  slotId: string,
  captionJobId: string,
): Promise<void> {
  const job = await prisma.captionJob.findUnique({
    where: { id: captionJobId },
    select: { slotId: true },
  });
  if (!job || job.slotId !== slotId) {
    throw new Error("CaptionJob non rattaché à ce slot — promote refusé.");
  }
  await prisma.publicationSlot.update({
    where: { id: slotId },
    data: { activeCaptionJobId: captionJobId },
  });
}

/**
 * Promeut un cover pack comme "actif" pour son slot.
 */
export async function promoteCoverPack(
  prisma: PrismaClient,
  slotId: string,
  coverPackId: string,
): Promise<void> {
  const pack = await prisma.coverFramePack.findUnique({
    where: { id: coverPackId },
    select: {
      render: { select: { publicationSlotId: true } },
      publicationVersion: { select: { slotId: true } },
    },
  });
  const linkedSlotId =
    pack?.render?.publicationSlotId ?? pack?.publicationVersion?.slotId ?? null;
  if (linkedSlotId !== slotId) {
    throw new Error("CoverFramePack non rattaché à ce slot — promote refusé.");
  }
  await prisma.publicationSlot.update({
    where: { id: slotId },
    data: { activeCoverPackId: coverPackId },
  });
}

/**
 * Promeut une transcription comme "active" pour son slot.
 */
export async function promoteTranscriptionJob(
  prisma: PrismaClient,
  slotId: string,
  transcriptionJobId: string,
): Promise<void> {
  const job = await prisma.transcriptionJob.findUnique({
    where: { id: transcriptionJobId },
    select: {
      slotId: true,
      render: { select: { publicationSlotId: true } },
      publicationVersion: { select: { slotId: true } },
    },
  });
  const linkedSlotId =
    job?.slotId ??
    job?.render?.publicationSlotId ??
    job?.publicationVersion?.slotId ??
    null;
  if (linkedSlotId !== slotId) {
    throw new Error("TranscriptionJob non rattaché à ce slot — promote refusé.");
  }
  await prisma.publicationSlot.update({
    where: { id: slotId },
    data: { activeTranscriptionJobId: transcriptionJobId },
  });
}

// ── Auto-promotion à la création (utile webhooks) ──────────────────────────

/**
 * Quand un job termine en COMPLETED et que slot.activeXxxJobId est null,
 * auto-promeut ce job comme actif. Évite à l'admin de devoir cliquer
 * "Promouvoir" pour chaque job qui termine sans concurrence.
 *
 * À appeler depuis les webhooks RunPod après status update COMPLETED.
 */
export async function autoPromoteIfNoActive(
  prisma: PrismaClient,
  slotId: string,
  jobType: "caption" | "cover" | "transcription",
  jobId: string,
): Promise<boolean> {
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      activeCaptionJobId: true,
      activeCoverPackId: true,
      activeTranscriptionJobId: true,
    },
  });
  if (!slot) return false;
  const currentActive =
    jobType === "caption"
      ? slot.activeCaptionJobId
      : jobType === "cover"
        ? slot.activeCoverPackId
        : slot.activeTranscriptionJobId;
  if (currentActive) return false; // déjà un job actif, ne pas écraser

  const field =
    jobType === "caption"
      ? { activeCaptionJobId: jobId }
      : jobType === "cover"
        ? { activeCoverPackId: jobId }
        : { activeTranscriptionJobId: jobId };

  await prisma.publicationSlot.update({
    where: { id: slotId },
    data: field,
  });
  return true;
}

// ── Exports types ──────────────────────────────────────────────────────────

export type { CaptionJob, CoverFramePack, DescriptionJob, TranscriptionJob };
