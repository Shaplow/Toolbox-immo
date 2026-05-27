/**
 * Helpers de visibilité, d'édition et d'upload pour les PublicationSlots par rôle.
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
import type { UserRole } from "@/types/roles";

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
  /** ID du Vidéaste assigné au shoot (null si non assigné). Optionnel pour back-compat. */
  assigneeVideasteId?: string | null;
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
  if (role === "VIDEASTE") return slot.assigneeVideasteId === user.id;

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

// ---------------------------------------------------------------------------
// Commentaires
// ---------------------------------------------------------------------------

/**
 * Permission de commenter sur une publication.
 *
 * Règle : équivalente à canSeePublication — si l'utilisateur peut voir le
 * slot, il peut y poster un commentaire.
 *
 * - ADMIN  → toujours true.
 * - MONTEUR → true si le slot lui est assigné.
 * - CM     → true si le slot lui est assigné.
 * - USER   → false.
 */
export function canCommentOnPublication(
  user: { id: string; role: UserRole },
  slot: {
    assigneeMonteurId: string | null;
    assigneeCmId: string | null;
    assigneeVideasteId?: string | null;
  }
): boolean {
  if (user.role === "ADMIN") return true;
  if (user.role === "MONTEUR") return slot.assigneeMonteurId === user.id;
  if (user.role === "CM") return slot.assigneeCmId === user.id;
  if (user.role === "VIDEASTE") return slot.assigneeVideasteId === user.id;
  return false;
}

/**
 * Variante assert.
 */
export function assertCanCommentOnPublication(
  user: { id: string; role: UserRole },
  slot: {
    id: string;
    assigneeMonteurId: string | null;
    assigneeCmId: string | null;
    assigneeVideasteId?: string | null;
  }
): void {
  if (!canCommentOnPublication(user, slot)) {
    throw new Error(
      `Accès refusé : le rôle "${user.role}" ne peut pas commenter la publication "${slot.id}".`
    );
  }
}

// ---------------------------------------------------------------------------
// Publication
// ---------------------------------------------------------------------------

/**
 * Permission de marquer une publication comme publiée (status=PUBLISHED + URL IG).
 *
 * - ADMIN → toujours true.
 * - CM    → true seulement si le slot lui est assigné (assigneeCmId).
 * - MONTEUR / USER → false. Un MONTEUR produit le contenu mais ne publie pas.
 */
export function canMarkPublished(
  user: { id: string; role: UserRole },
  slot: { assigneeCmId: string | null }
): boolean {
  if (user.role === "ADMIN") return true;
  if (user.role === "CM") return slot.assigneeCmId === user.id;
  return false;
}

/**
 * Variante assert.
 */
export function assertCanMarkPublished(
  user: { id: string; role: UserRole },
  slot: { id: string; assigneeCmId: string | null }
): void {
  if (!canMarkPublished(user, slot)) {
    throw new Error(
      `Accès refusé : le rôle "${user.role}" ne peut pas marquer la publication "${slot.id}" comme publiée.`
    );
  }
}

// ---------------------------------------------------------------------------
// Commentaire — edition / suppression
// ---------------------------------------------------------------------------

/**
 * Permission d'éditer ou supprimer un commentaire spécifique.
 *
 * - ADMIN          → toujours true (modération globale).
 * - Auteur du commentaire → true (peut éditer/supprimer son propre commentaire).
 * - Autres rôles   → false.
 */
export function canEditComment(
  user: { id: string; role: UserRole },
  comment: { authorId: string }
): boolean {
  if (user.role === "ADMIN") return true;
  return comment.authorId === user.id;
}

/**
 * Variante assert.
 */
export function assertCanEditComment(
  user: { id: string; role: UserRole },
  comment: { id: string; authorId: string }
): void {
  if (!canEditComment(user, comment)) {
    throw new Error(
      `Accès refusé : l'utilisateur "${user.id}" (rôle "${user.role}") ne peut pas modifier le commentaire "${comment.id}".`
    );
  }
}

// ---------------------------------------------------------------------------
// Rushes
// ---------------------------------------------------------------------------

/**
 * Permission d'uploader des rushes sur un slot.
 *
 * - ADMIN    → toujours true.
 * - VIDEASTE → true si assigné au slot (c'est sa mission principale : filmer + uploader).
 * - CM       → true si assigné (fallback historique pour les slots sans vidéaste).
 * - MONTEUR / EXTERNAL_GENERATOR → false.
 */
export function canUploadRushes(
  user: { id: string; role: UserRole },
  slot: { assigneeCmId: string | null; assigneeVideasteId?: string | null }
): boolean {
  if (user.role === "ADMIN") return true;
  if (user.role === "VIDEASTE") return slot.assigneeVideasteId === user.id;
  if (user.role === "CM") return slot.assigneeCmId === user.id;
  return false;
}

/**
 * Permission de supprimer un rush spécifique.
 *
 * - ADMIN   → toujours true.
 * - Auteur du rush → true (peut supprimer son propre upload).
 * - Autres  → false.
 */
export function canDeleteRushes(
  user: { id: string; role: UserRole },
  rush: { uploadedByUserId: string }
): boolean {
  if (user.role === "ADMIN") return true;
  return rush.uploadedByUserId === user.id;
}

// ---------------------------------------------------------------------------
// Versions (montage)
// ---------------------------------------------------------------------------

/**
 * Permission d'uploader une version (montage) sur un slot.
 *
 * - ADMIN   → toujours true.
 * - MONTEUR → true si le slot lui est assigné.
 * - CM / USER → false.
 */
export function canUploadVersion(
  user: { id: string; role: UserRole },
  slot: { assigneeMonteurId: string | null }
): boolean {
  if (user.role === "ADMIN") return true;
  if (user.role === "MONTEUR") return slot.assigneeMonteurId === user.id;
  return false;
}

/**
 * Permission de promouvoir une version en version courante.
 *
 * ADMIN seul — action à fort impact (change la version de référence publiée).
 */
export function canPromoteVersion(user: { role: UserRole }): boolean {
  return user.role === "ADMIN";
}

/**
 * Permission de supprimer (soft-delete) une version spécifique.
 *
 * - ADMIN   → toujours true.
 * - Auteur de la version → true.
 * - Autres  → false.
 */
export function canDeleteVersion(
  user: { id: string; role: UserRole },
  version: { uploadedByUserId: string }
): boolean {
  if (user.role === "ADMIN") return true;
  return version.uploadedByUserId === user.id;
}

/**
 * Permission de restaurer une version soft-deleted.
 *
 * ADMIN seul — même logique que canPromoteVersion.
 */
export function canRestoreVersion(user: { role: UserRole }): boolean {
  return user.role === "ADMIN";
}

// ---------------------------------------------------------------------------
// Brief
// ---------------------------------------------------------------------------

/**
 * Permission d'éditer le brief d'un slot (description + pièces jointes).
 *
 * - ADMIN → toujours true.
 * - CM    → true si le slot lui est assigné (le CM rédige le brief).
 * - MONTEUR / USER → false.
 */
export function canEditBrief(
  user: { id: string; role: UserRole },
  slot: { assigneeCmId: string | null }
): boolean {
  if (user.role === "ADMIN") return true;
  if (user.role === "CM") return slot.assigneeCmId === user.id;
  return false;
}
