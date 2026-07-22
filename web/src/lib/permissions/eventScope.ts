/**
 * Helpers de scoping Prisma pour les requêtes ShootEvent par rôle.
 *
 * Miroir de `slotScope.ts` (côté PublicationSlot) pour les événements de
 * tournage. Un événement porte un vidéaste (le shooter) + des défauts monteur/CM
 * propagés aux reels attachés.
 *
 * Scope par rôle :
 * - ADMIN    → tous les événements.
 * - VIDEASTE → les événements dont il est le vidéaste assigné (ses shoots).
 * - MONTEUR  → les événements dont il est le monteur par défaut OU qui portent
 *              au moins un reel qui lui est assigné (il reçoit les rushs → découpe).
 * - CM       → symétrique du monteur (défaut CM OU reel CM assigné).
 * - EXTERNAL → aucun.
 *
 * @module eventScope
 */

import type { Prisma } from "@prisma/client";
import type { UserRole } from "@/types/roles";

// ---------------------------------------------------------------------------
// whereClauseForUserEvent
// ---------------------------------------------------------------------------

/**
 * WHERE Prisma pour scoper les requêtes ShootEvent selon le rôle.
 *
 * ```ts
 * const scope = whereClauseForUserEvent(role, userId);
 * const events = await prisma.shootEvent.findMany({ where: { ...scope } });
 * ```
 */
export function whereClauseForUserEvent(
  role: UserRole,
  userId: string,
): Prisma.ShootEventWhereInput {
  switch (role) {
    case "ADMIN":
      return {};

    case "VIDEASTE":
      return { assigneeVideasteId: userId };

    case "MONTEUR":
      return {
        OR: [
          { defaultAssigneeMonteurId: userId },
          { slots: { some: { assigneeMonteurId: userId } } },
        ],
      };

    case "CM":
      return {
        OR: [
          { defaultAssigneeCmId: userId },
          { slots: { some: { assigneeCmId: userId } } },
        ],
      };

    case "EXTERNAL_GENERATOR":
    default:
      return { id: "__never__" };
  }
}

// ---------------------------------------------------------------------------
// canUserAccessEvent
// ---------------------------------------------------------------------------

/**
 * Forme minimale d'un événement chargé pour le check d'accès single-resource.
 * `slots` doit être inclus (assignés) pour couvrir le cas MONTEUR/CM via reel.
 */
export interface AccessibleEvent {
  assigneeVideasteId: string | null;
  defaultAssigneeMonteurId: string | null;
  defaultAssigneeCmId: string | null;
  slots: Array<{
    assigneeMonteurId: string | null;
    assigneeCmId: string | null;
  }>;
}

/**
 * Vrai si l'utilisateur peut accéder à un événement précis (cohérent avec
 * `whereClauseForUserEvent`). Utilisé dans les routes GET/PATCH/DELETE
 * /api/shoot-events/[id] après chargement (404 anti-énumération sinon).
 */
export function canUserAccessEvent(
  event: AccessibleEvent,
  role: UserRole,
  userId: string,
): boolean {
  switch (role) {
    case "ADMIN":
      return true;

    case "VIDEASTE":
      return event.assigneeVideasteId === userId;

    case "MONTEUR":
      return (
        event.defaultAssigneeMonteurId === userId ||
        event.slots.some((s) => s.assigneeMonteurId === userId)
      );

    case "CM":
      return (
        event.defaultAssigneeCmId === userId ||
        event.slots.some((s) => s.assigneeCmId === userId)
      );

    case "EXTERNAL_GENERATOR":
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Capacités par rôle
// ---------------------------------------------------------------------------

/**
 * Seul un ADMIN crée un événement (le calendrier de tournages est orchestré par
 * l'admin/client). L'impersonation ne donne pas ce droit.
 */
export function canCreateEvent(role: UserRole): boolean {
  return role === "ADMIN";
}

/**
 * Attacher un reel à un événement : ADMIN, MONTEUR (découpe les rushs) et
 * VIDEASTE (déclare les reels prévus). Le monteur/vidéaste doit AUSSI avoir
 * accès à l'événement (`canUserAccessEvent`) — vérifié séparément côté service.
 */
export function canAttachReelToEvent(role: UserRole): boolean {
  return role === "ADMIN" || role === "MONTEUR" || role === "VIDEASTE";
}

/**
 * Uploader/supprimer des rushs sur un événement : ADMIN ou le vidéaste assigné.
 */
export function canUploadEventRushes(
  event: { assigneeVideasteId: string | null },
  role: UserRole,
  userId: string,
): boolean {
  if (role === "ADMIN") return true;
  return role === "VIDEASTE" && event.assigneeVideasteId === userId;
}

// ---------------------------------------------------------------------------
// ALLOWED_EVENT_PATCH_FIELDS_BY_ROLE
// ---------------------------------------------------------------------------

/**
 * Liste blanche des champs modifiables via PATCH /api/shoot-events/[id] par
 * rôle. Seul l'ADMIN touche aux champs structurants (date, assignés, compte…).
 */
export const ALLOWED_EVENT_PATCH_FIELDS_BY_ROLE: Record<UserRole, readonly string[]> = {
  ADMIN: [
    "title",
    "propertyId",
    "scheduledAt",
    "endAt",
    "status",
    "assigneeVideasteId",
    "defaultAssigneeMonteurId",
    "defaultAssigneeCmId",
    "notes",
    "brief",
  ],
  // Le vidéaste peut annuler/mettre à jour le statut (ex : shoot reporté) et
  // écrire des notes de terrain.
  VIDEASTE: ["status", "notes"],
  MONTEUR: ["notes"],
  CM: ["notes"],
  EXTERNAL_GENERATOR: [],
} as const;
