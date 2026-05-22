/**
 * Helpers de visibilité et d'édition des PublicationSlots par rôle.
 *
 * Ces fonctions sont "dead code" en Phase 1.1 — elles seront consommées
 * par les routes API et les composants de worklist en Phase 1.2.
 *
 * Convention de nommage :
 *   canXxx(user, slot?) → boolean  (vérification douce)
 *   assertCanXxx(...)   → void     (throw si non autorisé)
 *
 * NOTE : PublicationSlotForPermission reflète les champs que Phase 1.2
 * ajoutera au modèle Prisma (assigneeMonteurId, assigneeCmId). Le type
 * est défini ici pour que les helpers compilent et soient testables
 * indépendamment du schéma Prisma en cours de migration.
 */

import type { AppUserIdentity } from "@/lib/userContext";

// ---------------------------------------------------------------------------
// Type minimal pour les vérifications de permission
// ---------------------------------------------------------------------------

/**
 * Sous-ensemble de PublicationSlot requis par les helpers de permission.
 * Phase 1.2 mappera les champs Prisma réels vers cette interface.
 */
export type PublicationSlotForPermission = {
  id: string;
  /** ID du Monteur assigné à ce slot (null si non assigné). */
  assigneeMonteurId: string | null;
  /** ID du CM assigné à ce slot (null si non assigné). */
  assigneeCmId: string | null;
};

// ---------------------------------------------------------------------------
// Visibilité
// ---------------------------------------------------------------------------

/**
 * Détermine si un utilisateur peut voir une publication donnée.
 *
 * - ADMIN  → toujours true (vision globale).
 * - MONTEUR → true seulement si le slot lui est assigné (assigneeMonteurId).
 * - CM     → true seulement si le slot lui est assigné (assigneeCmId).
 * - USER   → false (les USER n'ont pas accès à la pipeline éditoriale).
 */
export function canSeePublication(
  user: AppUserIdentity,
  slot: PublicationSlotForPermission
): boolean {
  const role = user.role;

  if (role === "ADMIN") return true;
  if (role === "MONTEUR") return slot.assigneeMonteurId === user.id;
  if (role === "CM") return slot.assigneeCmId === user.id;

  // USER et tout rôle inconnu
  return false;
}

/**
 * Variante assert.
 */
export function assertCanSeePublication(
  user: AppUserIdentity,
  slot: PublicationSlotForPermission
): void {
  if (!canSeePublication(user, slot)) {
    throw new Error(
      `Accès refusé : le rôle "${user.role}" ne peut pas voir la publication "${slot.id}".`
    );
  }
}

// ---------------------------------------------------------------------------
// Assignation
// ---------------------------------------------------------------------------

/**
 * Seul un ADMIN peut assigner un Monteur à un slot.
 */
export function canAssignMonteur(user: AppUserIdentity): boolean {
  return user.role === "ADMIN";
}

/**
 * Variante assert.
 */
export function assertCanAssignMonteur(user: AppUserIdentity): void {
  if (!canAssignMonteur(user)) {
    throw new Error(
      `Accès refusé : seul un ADMIN peut assigner un monteur (rôle actuel : "${user.role}").`
    );
  }
}

/**
 * Seul un ADMIN peut assigner un CM à un slot.
 */
export function canAssignCm(user: AppUserIdentity): boolean {
  return user.role === "ADMIN";
}

/**
 * Variante assert.
 */
export function assertCanAssignCm(user: AppUserIdentity): void {
  if (!canAssignCm(user)) {
    throw new Error(
      `Accès refusé : seul un ADMIN peut assigner un CM (rôle actuel : "${user.role}").`
    );
  }
}

// ---------------------------------------------------------------------------
// Edition
// ---------------------------------------------------------------------------

/**
 * Détermine si un utilisateur peut modifier le contenu d'une publication
 * (upload rushes, déposer un montage, mettre à jour les champs de production).
 *
 * - ADMIN   → toujours true.
 * - MONTEUR → true seulement si assigné à ce slot.
 * - CM / USER → false.
 */
export function canEditPublicationVersion(
  user: AppUserIdentity,
  slot: PublicationSlotForPermission
): boolean {
  const role = user.role;

  if (role === "ADMIN") return true;
  if (role === "MONTEUR") return slot.assigneeMonteurId === user.id;

  return false;
}

/**
 * Variante assert.
 */
export function assertCanEditPublicationVersion(
  user: AppUserIdentity,
  slot: PublicationSlotForPermission
): void {
  if (!canEditPublicationVersion(user, slot)) {
    throw new Error(
      `Accès refusé : le rôle "${user.role}" ne peut pas modifier la publication "${slot.id}".`
    );
  }
}
