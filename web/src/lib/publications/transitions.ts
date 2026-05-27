/**
 * Matrice de transitions de statut et helpers associés.
 *
 * - STATUS_TRANSITIONS : transitions autorisées par statut pour les rôles non-ADMIN.
 * - canTransition      : valide une transition (avec bypass ADMIN et tolérance legacy).
 * - AutoTransitionTrigger : déclencheurs d'auto-transition suite à une action métier
 *                           (uploads MONTEUR : rushes, versions).
 * - computeAutoTransition : calcule la cible d'une auto-transition (uploads).
 * - applyAutoTransition   : applique l'auto-transition upload et log l'activité.
 * - computeAutoTransitionTarget : calcule la cible quand un job RunPod termine
 *                                  (render, captions). Lit l'état complet du slot.
 * - applyAutoTransitionFromPipeline : applique la transition pipeline + log.
 */

import type { SlotStatus, UserRole } from "@/types/roles";
import type { PrismaClient } from "@prisma/client";
import { logActivity } from "@/lib/publications/activity";

// ─── Statuts legacy toujours présents en base (Phase 1.3 backfill) ────────────

export const LEGACY_STATUSES = ["TO_DO", "IN_PROGRESS", "READY", "CHECKING", "DONE"] as const;

// ─── Matrice de transitions ────────────────────────────────────────────────────

/**
 * Pour chaque statut source, liste des statuts cibles autorisés pour les rôles
 * non-ADMIN. Les ADMIN bypasse totalement cette matrice.
 *
 * Statuts terminaux (CANCELLED, ARCHIVED, BLOCKED) : tableau vide car la
 * récupération passe toujours par un ADMIN.
 */
export const STATUS_TRANSITIONS: Record<SlotStatus, SlotStatus[]> = {
  DRAFT: ["PLANNED", "CANCELLED", "BLOCKED"],
  PLANNED: ["RUSHES_EXPECTED", "IN_EDIT", "CANCELLED", "BLOCKED"],
  RUSHES_EXPECTED: ["RUSHES_RECEIVED", "BLOCKED", "CANCELLED"],
  RUSHES_RECEIVED: ["IN_EDIT", "CANCELLED"],
  IN_EDIT: ["EDIT_REVIEW", "BLOCKED", "CANCELLED"],
  EDIT_REVIEW: ["EDIT_APPROVED", "IN_EDIT", "CANCELLED"],
  EDIT_APPROVED: ["CAPTIONS_PENDING", "READY_FOR_CM", "SCHEDULED", "CANCELLED"],
  CAPTIONS_PENDING: ["READY_FOR_CM", "EDIT_APPROVED", "CANCELLED"],
  READY_FOR_CM: ["SCHEDULED", "PUBLISHED", "CANCELLED"],
  SCHEDULED: ["PUBLISHED", "READY_FOR_CM", "CANCELLED"],
  PUBLISHED: ["ARCHIVED"],
  REJECTED: ["IN_EDIT", "CANCELLED"],
  BLOCKED: [],  // récupération ADMIN uniquement
  CANCELLED: [],
  ARCHIVED: [],
};

// ─── canTransition ─────────────────────────────────────────────────────────────

/**
 * Vérifie si la transition `from` → `to` est autorisée pour le rôle donné.
 *
 * - ADMIN : bypass total (toujours true).
 * - Statuts legacy en `from` : tolérés (true) jusqu'au backfill Phase 1.3.
 * - Autres rôles : vérifie la matrice STATUS_TRANSITIONS.
 */
export function canTransition(from: string, to: string, role: UserRole): boolean {
  if (role === "ADMIN") return true;
  // USER n'a aucun accès à la pipeline éditoriale.
  if (role === "EXTERNAL_GENERATOR") return false;
  if ((LEGACY_STATUSES as readonly string[]).includes(from)) return true;
  const allowed = STATUS_TRANSITIONS[from as SlotStatus];
  return Array.isArray(allowed) && allowed.includes(to as SlotStatus);
}

// ─── AutoTransitionTrigger ─────────────────────────────────────────────────────

/**
 * Déclencheurs d'auto-transition suite à une action métier.
 *
 * - RUSHES_UPLOADED_FIRST    : premier rush uploadé sur ce slot.
 * - VERSION_UPLOADED_FIRST   : première version uploadée (montage initial).
 * - VERSION_UPLOADED_AGAIN   : version uploadée alors que le slot est EDIT_APPROVED.
 * - VERSION_PROMOTED         : version promue en version courante.
 */
export type AutoTransitionTrigger =
  | "RUSHES_UPLOADED_FIRST"
  | "VERSION_UPLOADED_FIRST"
  | "VERSION_UPLOADED_AGAIN"
  | "VERSION_PROMOTED";

// ─── computeAutoTransition ────────────────────────────────────────────────────

/**
 * Calcule le statut cible d'une auto-transition selon l'état courant du slot
 * et le déclencheur. Retourne null si aucune transition ne s'applique.
 */
export function computeAutoTransition(
  currentStatus: string,
  trigger: AutoTransitionTrigger
): string | null {
  if (
    trigger === "RUSHES_UPLOADED_FIRST" &&
    ["DRAFT", "PLANNED", "RUSHES_EXPECTED"].includes(currentStatus)
  ) {
    return "RUSHES_RECEIVED";
  }
  if (
    trigger === "VERSION_UPLOADED_FIRST" &&
    ["RUSHES_RECEIVED", "IN_EDIT"].includes(currentStatus)
  ) {
    return "EDIT_REVIEW";
  }
  if (trigger === "VERSION_UPLOADED_AGAIN" && currentStatus === "EDIT_APPROVED") {
    return "EDIT_REVIEW";
  }
  if (trigger === "VERSION_PROMOTED") {
    return "EDIT_APPROVED";
  }
  return null;
}

// ─── applyAutoTransition ──────────────────────────────────────────────────────

/**
 * Applique une auto-transition sur un slot Prisma si elle est applicable.
 *
 * - Calcule le statut cible via computeAutoTransition.
 * - Si null, ne fait rien.
 * - Sinon, update PublicationSlot.status + logActivity STATUS_CHANGED.
 *
 * Doit être appelé à l'intérieur d'une transaction Prisma (le tx est passé
 * comme paramètre pour que l'update soit atomique avec l'action parente).
 *
 * @returns Le nouveau statut si une transition a eu lieu, null sinon.
 */
export async function applyAutoTransition(
  prisma: PrismaClient,
  slotId: string,
  currentStatus: string,
  trigger: AutoTransitionTrigger,
  actorId: string | null
): Promise<string | null> {
  const targetStatus = computeAutoTransition(currentStatus, trigger);
  if (!targetStatus) return null;

  await prisma.publicationSlot.update({
    where: { id: slotId },
    data: { status: targetStatus },
  });

  await logActivity(prisma, {
    slotId,
    actorId,
    type: "STATUS_CHANGED",
    payload: { from: currentStatus, to: targetStatus, trigger },
  });

  return targetStatus;
}

// ─── Pipeline auto-transitions (jobs RunPod) ──────────────────────────────────

/**
 * Trigger côté pipeline RunPod (jobs asynchrones).
 *
 * - RENDER_COMPLETED   : webhook /api/webhooks/runpod/renders a passé Render.status=DONE.
 * - CAPTIONS_COMPLETED : webhook /api/webhooks/runpod/captions a passé CaptionJob.status=COMPLETED.
 */
export type PipelineTrigger = "RENDER_COMPLETED" | "CAPTIONS_COMPLETED";

// ── Inputs minimaux pour la décision (pour tests unit purs sans mock Prisma) ──

interface SlotForAutoTransition {
  status: string;
  pattern: { source: string; needsCaptions: boolean } | null;
  render: { status: string } | null;
  latestCaptionJobStatus: string | null;
}

/**
 * Logique pure (testable sans DB) : calcule le statut cible d'un slot
 * auto_template selon l'état réel de ses jobs.
 *
 * Règles validées avec le user (cf. plan §2) :
 *  - Si pattern.source !== "auto_template" → null (les autres flows gèrent eux-mêmes)
 *  - Si slot.status !== "TO_DO" → null (idempotence : ne touche pas un slot déjà avancé manuellement)
 *  - Si render.status !== "DONE" → null (rien à faire)
 *  - Si needsCaptions === false → "READY_FOR_CM"
 *  - Si needsCaptions === true && latestCaption === "COMPLETED" → "READY_FOR_CM"
 *  - Sinon (captions pending) → null (on attend)
 */
export function computeAutoTransitionTargetPure(
  slot: SlotForAutoTransition,
): SlotStatus | null {
  // Idempotence : on ne touche que les slots en TO_DO (statut initial).
  if (slot.status !== "TO_DO") return null;
  // Seul auto_template a une logique de transition automatique côté pipeline.
  if (!slot.pattern || slot.pattern.source !== "auto_template") return null;
  // Si le render n'est pas DONE, on n'avance pas.
  if (slot.render?.status !== "DONE") return null;
  // Si pas besoin de captions → READY_FOR_CM dès que render DONE.
  if (!slot.pattern.needsCaptions) return "READY_FOR_CM";
  // Besoin de captions : on attend que le job soit COMPLETED.
  if (slot.latestCaptionJobStatus === "COMPLETED") return "READY_FOR_CM";
  return null;
}

/**
 * Variante async qui charge le slot via Prisma et applique la logique pure.
 * Utilisée depuis les webhooks RunPod (renders, captions).
 *
 * @returns Le statut cible si une transition s'applique, null sinon.
 */
export async function computeAutoTransitionTarget(
  prisma: PrismaClient,
  slotId: string,
): Promise<SlotStatus | null> {
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      status: true,
      pattern: { select: { source: true, needsCaptions: true } },
      render: { select: { status: true } },
      captionJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true },
      },
    },
  });
  if (!slot) return null;

  return computeAutoTransitionTargetPure({
    status: slot.status,
    pattern: slot.pattern,
    render: slot.render,
    latestCaptionJobStatus: slot.captionJobs[0]?.status ?? null,
  });
}

/**
 * Applique l'auto-transition pipeline si la logique le permet.
 * Best-effort : log un warning et continue si l'update échoue (le webhook
 * ne doit pas être bloqué par une transition qui rate).
 *
 * @returns Le nouveau statut si une transition a eu lieu, null sinon.
 */
export async function applyAutoTransitionFromPipeline(
  prisma: PrismaClient,
  slotId: string,
  trigger: PipelineTrigger,
): Promise<SlotStatus | null> {
  try {
    const target = await computeAutoTransitionTarget(prisma, slotId);
    if (!target) return null;

    // Re-lire le status courant pour le payload activity (la cible a été
    // calculée mais on ne l'a pas en local).
    const current = await prisma.publicationSlot.findUnique({
      where: { id: slotId },
      select: { status: true },
    });
    if (!current) return null;

    await prisma.publicationSlot.update({
      where: { id: slotId },
      data: { status: target },
    });

    await logActivity(prisma, {
      slotId,
      actorId: null, // déclenché par un webhook serveur, pas un utilisateur
      type: "STATUS_CHANGED",
      payload: { from: current.status, to: target, trigger },
    });

    return target;
  } catch (err) {
    console.warn(
      `[applyAutoTransitionFromPipeline] échec pour slot=${slotId} trigger=${trigger}:`,
      err,
    );
    return null;
  }
}
