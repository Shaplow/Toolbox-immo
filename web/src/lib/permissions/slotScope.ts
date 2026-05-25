/**
 * Helpers de scoping Prisma pour les requêtes PublicationSlot par rôle.
 *
 * Ce module est le complément SQL de `publications.ts` :
 * - `publications.ts`  → vérifications booléennes sur un slot déjà chargé (canSeePublication, etc.)
 * - `slotScope.ts`     → clauses WHERE à injecter dans les requêtes Prisma pour filtrer en base
 *
 * Garantie de cohérence :
 *   whereClauseForUser(role, userId) produit exactement le même scope que
 *   canSeePublication({ role, id: userId }, slot) appliqué à chaque slot d'une liste.
 *
 * @module slotScope
 */

import type { Prisma } from "@prisma/client";
import type { UserRole } from "@/types/roles";

// ---------------------------------------------------------------------------
// whereClauseForUser
// ---------------------------------------------------------------------------

/**
 * Retourne le WHERE Prisma pour scoper les requêtes PublicationSlot selon le rôle.
 *
 * - ADMIN   → `{}` — aucune restriction, voit tous les slots.
 * - MONTEUR → `{ assigneeMonteurId: userId }` — voit uniquement les slots qui lui sont assignés.
 * - CM      → `{ assigneeCmId: userId }` — voit uniquement les slots qui lui sont assignés.
 * - USER    → `{ id: "__never__" }` — n'a accès à aucun slot (valeur impossible en production).
 *
 * Usage :
 * ```ts
 * const scope = whereClauseForUser(session.user.role, session.user.id);
 * const slots = await prisma.publicationSlot.findMany({
 *   where: { ...scope, ...otherFilters },
 * });
 * ```
 */
export function whereClauseForUser(
  role: UserRole,
  userId: string
): Prisma.PublicationSlotWhereInput {
  switch (role) {
    case "ADMIN":
      return {};

    case "MONTEUR":
      return { assigneeMonteurId: userId };

    case "CM":
      return { assigneeCmId: userId };

    case "USER":
    default:
      // USER n'a pas accès à la pipeline éditoriale.
      // On retourne une clause qui ne peut jamais matcher un cuid valide.
      return { id: "__never__" };
  }
}

// ---------------------------------------------------------------------------
// canUserAccessSlot
// ---------------------------------------------------------------------------

/**
 * Vérifie si un utilisateur peut accéder à un slot précis selon son rôle.
 *
 * Utilisé dans les routes single-resource (GET/PATCH/DELETE /api/calendar/slots/[id])
 * après avoir chargé le slot depuis la base. Cohérent avec whereClauseForUser :
 * un slot qui passerait le WHERE de la liste passera également ce test.
 *
 * - ADMIN   → toujours true.
 * - MONTEUR → true si `slot.assigneeMonteurId === userId`.
 * - CM      → true si `slot.assigneeCmId === userId`.
 * - USER    → toujours false.
 */
export function canUserAccessSlot(
  slot: { assigneeMonteurId: string | null; assigneeCmId: string | null },
  role: UserRole,
  userId: string
): boolean {
  switch (role) {
    case "ADMIN":
      return true;

    case "MONTEUR":
      return slot.assigneeMonteurId === userId;

    case "CM":
      return slot.assigneeCmId === userId;

    case "USER":
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// ALLOWED_PATCH_FIELDS_BY_ROLE
// ---------------------------------------------------------------------------

/**
 * Liste blanche des champs qu'un utilisateur peut modifier via PATCH
 * selon son rôle.
 *
 * Le handler PATCH doit filtrer le body reçu via ces listes avant d'appeler
 * prisma.update, afin d'éviter qu'un rôle non autorisé ne modifie un champ
 * sensible (ex : un MONTEUR qui raserait assigneeMonteurId casserait tout le
 * scoping multi-rôle).
 *
 * - ADMIN   → accès complet à tous les champs métier du slot.
 * - MONTEUR → peut uniquement mettre à jour le statut et les notes.
 * - CM      → peut uniquement mettre à jour le statut et les notes.
 * - USER    → aucun champ modifiable.
 *
 * Note : `assigneeMonteurId` et `assigneeCmId` ne figurent pas dans les listes
 * MONTEUR et CM — seul un ADMIN peut réassigner.
 */
export const ALLOWED_PATCH_FIELDS_BY_ROLE: Record<UserRole, readonly string[]> =
  {
    ADMIN: [
      "status",
      "title",
      "caption",
      "notes",
      "templateId",
      "scheduledAt",
      "contentType",
      "fields",
      "fieldSchema",
      "assigneeMonteurId",
      "assigneeCmId",
      "recipeId",
      "currentVersionId",
      "isAuto",
    ],
    MONTEUR: ["status", "notes"],
    CM: ["status", "notes"],
    USER: [],
  } as const;
