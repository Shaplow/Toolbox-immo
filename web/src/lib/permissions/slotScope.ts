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
import { SLOT_STATUSES, type SlotStatus } from "@/types/roles";

// ---------------------------------------------------------------------------
// isValidSlotStatus
// ---------------------------------------------------------------------------

/**
 * Statuts legacy conservés en cohabitation jusqu'au backfill Phase 1.3.
 * Ces valeurs sont présentes en base depuis l'ancienne pipeline et ne sont pas
 * encore migrées. Elles doivent rester acceptées en PATCH le temps du backfill.
 *
 * @see feedback_publication_strategy_decisions.md Q12
 */
const LEGACY_SLOT_STATUSES = ["TO_DO", "IN_PROGRESS", "READY", "CHECKING", "DONE"] as const;

/**
 * Valide qu'une valeur est un statut de slot acceptable.
 *
 * Accepte à la fois :
 *  - les 15 statuts du nouveau pipeline (`SLOT_STATUSES` dans `@/types/roles`)
 *  - les 5 statuts legacy (`LEGACY_SLOT_STATUSES`) encore présents en base
 *
 * Note de sécurité : utilise `Object.hasOwn` (pas `in`) pour éviter que des
 * propriétés héritées de `Object.prototype` (ex. "toString", "constructor")
 * ne passent la validation.
 */
export function isValidSlotStatus(s: unknown): boolean {
  if (typeof s !== "string") return false;
  return (
    Object.hasOwn(SLOT_STATUSES, s as SlotStatus) ||
    (LEGACY_SLOT_STATUSES as readonly string[]).includes(s)
  );
}

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

    case "VIDEASTE":
      return { assigneeVideasteId: userId };

    case "EXTERNAL_GENERATOR":
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
  slot: {
    assigneeMonteurId: string | null;
    assigneeCmId: string | null;
    assigneeVideasteId?: string | null;
  },
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

    case "VIDEASTE":
      return slot.assigneeVideasteId === userId;

    case "EXTERNAL_GENERATOR":
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
 * - MONTEUR → peut mettre à jour le statut, les notes internes et la description.
 * - CM      → peut mettre à jour le statut, les notes internes et la description.
 * - USER    → aucun champ modifiable.
 *
 * Note : `assigneeMonteurId` et `assigneeCmId` ne figurent pas dans les listes
 * MONTEUR et CM — seul un ADMIN peut réassigner.
 *
 * Note : `description` est le champ dédié à la description de publication (R14).
 * Il est distinct de `notes` qui reste pour les annotations internes libres.
 */
export const ALLOWED_PATCH_FIELDS_BY_ROLE: Record<UserRole, readonly string[]> =
  {
    ADMIN: [
      "status",
      "title",
      "notes",
      "description",
      "templateId",
      "scheduledAt",
      "fields",
      "fieldSchema",
      "assigneeMonteurId",
      "assigneeCmId",
      "assigneeVideasteId",
      "patternId",
      "currentVersionId",
      "isAuto",
      // W2 — override per-slot de la config validation client
      "needsClientValidationOverride",
      "allowsClientRevisionOverride",
      // Phase 2.3 — override per-slot de la validation admin du montage
      "needsAdminValidationOverride",
      // Cohérence Workflows Phase 4 — overrides per-slot des autres needs*
      "needsCaptionsOverride",
      "needsDescriptionOverride",
      "needsRushesOverride",
      "needsBriefOverride",
      // Slots one-off Phase 5 — overrides des ressources (preset/prompt)
      "coverModeOverride",
      "coverPresetIdOverride",
      "captionPresetIdOverride",
      "descriptionPromptIdOverride",
    ],
    MONTEUR: ["status", "notes", "description"],
    // CM édite la légende IG (champ `description` depuis la fusion Phase 2.1)
    // en plus de notes.
    CM: ["status", "title", "notes", "description"],
    // VIDEASTE : peut changer le statut (ex: shoot annulé) et écrire des notes
    // (compte-rendu sur place). Ne touche pas aux assignations ni au planning.
    VIDEASTE: ["status", "notes"],
    EXTERNAL_GENERATOR: [],
  } as const;
