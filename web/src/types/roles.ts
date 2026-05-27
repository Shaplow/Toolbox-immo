/**
 * Constantes de rôles utilisateur pour la Toolbox Immo.
 *
 * User.role est stocké comme String en base (pas d'enum Postgres).
 * Les valeurs ci-dessous sont les seules valeurs légitimes.
 *
 * ADMIN              — Studio / superviseur : accès complet, configure tout.
 * MONTEUR            — Reçoit des publications à produire, upload rushes/montages.
 * CM                 — Community Manager : prépare légende/cover, publie sur Instagram.
 * EXTERNAL_GENERATOR — Client externe : accès limité (templates + covers) défini par
 *                      permissions individuelles. Remplace l'ancien rôle "USER"
 *                      depuis le renommage Vague 0 (2026-05-27).
 */
export type UserRole = "ADMIN" | "MONTEUR" | "CM" | "EXTERNAL_GENERATOR";

export const USER_ROLES = {
  ADMIN: "ADMIN",
  MONTEUR: "MONTEUR",
  CM: "CM",
  EXTERNAL_GENERATOR: "EXTERNAL_GENERATOR",
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

// ---------------------------------------------------------------------------
// Statuts terminaux / actifs
// ---------------------------------------------------------------------------

/**
 * Statuts terminaux du pipeline éditorial : un slot dans l'un de ces statuts
 * est considéré comme "terminé" et n'apparaît pas dans la worklist active.
 *
 * Inclut également "DONE" — statut legacy terminal, coexistant avec
 * "PUBLISHED" le temps du backfill Phase 1.3.
 *
 * @see slotScope.ts pour les statuts legacy non-terminaux (TO_DO, IN_PROGRESS, etc.)
 */
export const TERMINAL_STATUSES = [
  "PUBLISHED",
  "ARCHIVED",
  "CANCELLED",
  "REJECTED",
  "DONE", // statut legacy terminal
] as const satisfies string[];

export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];
