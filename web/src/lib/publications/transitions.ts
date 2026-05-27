/**
 * Matrice de transitions de statut et helpers associés.
 *
 * - STATUS_TRANSITIONS : transitions autorisées par statut pour les rôles non-ADMIN.
 * - canTransition      : valide une transition (avec bypass ADMIN et tolérance legacy).
 * - AutoTransitionTrigger : déclencheurs d'auto-transition suite à une action métier.
 * - computeAutoTransition : calcule la cible d'une auto-transition.
 * - applyAutoTransition   : applique l'auto-transition et log l'activité dans Prisma.
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
