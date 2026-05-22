/**
 * Constantes de rôles utilisateur pour la Toolbox Immo.
 *
 * User.role est stocké comme String en base (pas d'enum Postgres).
 * Les valeurs ci-dessous sont les seules valeurs légitimes.
 *
 * ADMIN   — Studio / superviseur : accès complet, configure tout.
 * MONTEUR — Reçoit des publications à produire, upload rushes/montages.
 * CM      — Community Manager : prépare légende/cover, publie sur Instagram.
 * USER    — Utilisateur standard, accès défini par permissions individuelles.
 */
export type UserRole = "ADMIN" | "MONTEUR" | "CM" | "USER";

export const USER_ROLES = {
  ADMIN: "ADMIN",
  MONTEUR: "MONTEUR",
  CM: "CM",
  USER: "USER",
} as const satisfies Record<UserRole, UserRole>;

// ---------------------------------------------------------------------------
// Statuts de publication
// ---------------------------------------------------------------------------

/**
 * Les 15 statuts possibles d'un PublicationSlot dans la pipeline éditoriale.
 *
 * Cycle nominal :
 *   DRAFT → PLANNED → RUSHES_EXPECTED → RUSHES_RECEIVED → IN_EDIT
 *     → EDIT_REVIEW → EDIT_APPROVED → CAPTIONS_PENDING → READY_FOR_CM
 *     → SCHEDULED → PUBLISHED
 *
 * Sorties de cycle :
 *   REJECTED, CANCELLED, BLOCKED, ARCHIVED
 */
export type SlotStatus =
  | "DRAFT"
  | "PLANNED"
  | "RUSHES_EXPECTED"
  | "RUSHES_RECEIVED"
  | "IN_EDIT"
  | "EDIT_REVIEW"
  | "EDIT_APPROVED"
  | "CAPTIONS_PENDING"
  | "READY_FOR_CM"
  | "SCHEDULED"
  | "PUBLISHED"
  | "REJECTED"
  | "CANCELLED"
  | "BLOCKED"
  | "ARCHIVED";

export const SLOT_STATUSES = {
  DRAFT: "DRAFT",
  PLANNED: "PLANNED",
  RUSHES_EXPECTED: "RUSHES_EXPECTED",
  RUSHES_RECEIVED: "RUSHES_RECEIVED",
  IN_EDIT: "IN_EDIT",
  EDIT_REVIEW: "EDIT_REVIEW",
  EDIT_APPROVED: "EDIT_APPROVED",
  CAPTIONS_PENDING: "CAPTIONS_PENDING",
  READY_FOR_CM: "READY_FOR_CM",
  SCHEDULED: "SCHEDULED",
  PUBLISHED: "PUBLISHED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
  BLOCKED: "BLOCKED",
  ARCHIVED: "ARCHIVED",
} as const satisfies Record<SlotStatus, SlotStatus>;
