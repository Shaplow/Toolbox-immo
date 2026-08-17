/**
 * Helpers de scoping Prisma pour les requêtes Entity (fiches/métaobjets) par
 * rôle — plan simplification Phase 5. Généralise `eventScope.ts` (ShootEvent)
 * avec le switch `EntityType.visibility` :
 *
 * - `visibility="admin"` (ex-Property « Bien », types data purs) :
 *   liste/fiche/CRUD strictement ADMIN. Les monteurs/CM/vidéastes ne voient
 *   jamais ces fiches — leurs valeurs continuent d'alimenter le prefill de
 *   génération et `descriptionSourceFieldKey` via le slot.
 * - `visibility="team"` (ex-ShootEvent « Tournage ») : scoping par rôle,
 *   mêmes règles que l'ancien eventScope :
 *     ADMIN    → tout.
 *     VIDEASTE → les fiches dont il est le vidéaste assigné.
 *     MONTEUR  → défaut monteur OU un reel rattaché qui lui est assigné.
 *     CM       → symétrique (défaut CM OU reel CM assigné).
 *     EXTERNAL → rien.
 *
 * Garde-fou (validé à la création du type) : un type `team` DOIT avoir
 * `hasAssignees=true`, sinon son scope serait vide pour toute l'équipe.
 *
 * @module entityScope
 */

import type { Prisma } from "@prisma/client";
import type { UserRole } from "@/types/roles";

// ---------------------------------------------------------------------------
// whereClauseForUserEntity
// ---------------------------------------------------------------------------

/**
 * WHERE Prisma pour scoper les requêtes Entity selon le rôle.
 * Couvre les DEUX visibilités : les fiches `admin` ne matchent que pour ADMIN,
 * les fiches `team` suivent les règles d'assignation.
 *
 * ```ts
 * const scope = whereClauseForUserEntity(role, userId);
 * const entities = await prisma.entity.findMany({ where: { ...scope } });
 * ```
 */
export function whereClauseForUserEntity(
  role: UserRole,
  userId: string,
): Prisma.EntityWhereInput {
  switch (role) {
    case "ADMIN":
      return {};

    case "VIDEASTE":
      return { type: { visibility: "team" }, assigneeVideasteId: userId };

    case "MONTEUR":
      return {
        type: { visibility: "team" },
        OR: [
          { defaultAssigneeMonteurId: userId },
          { shootSlots: { some: { assigneeMonteurId: userId } } },
        ],
      };

    case "CM":
      return {
        type: { visibility: "team" },
        OR: [
          { defaultAssigneeCmId: userId },
          { shootSlots: { some: { assigneeCmId: userId } } },
        ],
      };

    case "EXTERNAL_GENERATOR":
    default:
      return { id: "__never__" };
  }
}

// ---------------------------------------------------------------------------
// canUserAccessEntity
// ---------------------------------------------------------------------------

/**
 * Forme minimale d'une fiche chargée pour le check d'accès single-resource.
 * `type.visibility` et `shootSlots` (assignés) doivent être inclus.
 */
export interface AccessibleEntity {
  type: { visibility: string };
  assigneeVideasteId: string | null;
  defaultAssigneeMonteurId: string | null;
  defaultAssigneeCmId: string | null;
  shootSlots: Array<{
    assigneeMonteurId: string | null;
    assigneeCmId: string | null;
  }>;
}

/**
 * Vrai si l'utilisateur peut accéder à une fiche précise (cohérent avec
 * `whereClauseForUserEntity`). 404 anti-énumération côté routes sinon.
 */
export function canUserAccessEntity(
  entity: AccessibleEntity,
  role: UserRole,
  userId: string,
): boolean {
  if (role === "ADMIN") return true;
  if (entity.type.visibility !== "team") return false;

  switch (role) {
    case "VIDEASTE":
      return entity.assigneeVideasteId === userId;

    case "MONTEUR":
      return (
        entity.defaultAssigneeMonteurId === userId ||
        entity.shootSlots.some((s) => s.assigneeMonteurId === userId)
      );

    case "CM":
      return (
        entity.defaultAssigneeCmId === userId ||
        entity.shootSlots.some((s) => s.assigneeCmId === userId)
      );

    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Capacités par rôle
// ---------------------------------------------------------------------------

/** Seul un ADMIN crée une fiche (quel que soit le type). */
export function canCreateEntity(role: UserRole): boolean {
  return role === "ADMIN";
}

/**
 * Attacher un reel/une mission à une fiche : ADMIN, MONTEUR et VIDEASTE
 * (fiches team uniquement — l'appelant doit AUSSI avoir accès à la fiche via
 * `canUserAccessEntity`, vérifié séparément côté service).
 */
export function canAttachSlotToEntity(role: UserRole): boolean {
  return role === "ADMIN" || role === "MONTEUR" || role === "VIDEASTE";
}

/** Uploader/supprimer des rushs sur une fiche : ADMIN ou le vidéaste assigné. */
export function canUploadEntityRushes(
  entity: { assigneeVideasteId: string | null },
  role: UserRole,
  userId: string,
): boolean {
  if (role === "ADMIN") return true;
  return role === "VIDEASTE" && entity.assigneeVideasteId === userId;
}

// ---------------------------------------------------------------------------
// ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE
// ---------------------------------------------------------------------------

/**
 * Liste blanche des champs modifiables via PATCH /api/entities/[id] par rôle.
 * Seul l'ADMIN touche aux champs structurants (label, fields custom, date,
 * assignés, compte, fiche liée…).
 */
export const ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE: Record<UserRole, readonly string[]> = {
  ADMIN: [
    "label",
    "fields",
    "isArchived",
    "accountId",
    "relatedEntityId",
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
