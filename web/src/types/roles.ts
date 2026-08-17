/**
 * Constantes de rôles utilisateur pour la Toolbox Immo.
 *
 * User.role est stocké comme String en base (pas d'enum Postgres).
 * Les valeurs ci-dessous sont les seules valeurs légitimes.
 *
 * ADMIN              — Studio / superviseur : accès complet, configure tout.
 * VIDEASTE           — Filmeur : reçoit les missions de shoot et upload les rushs.
 * MONTEUR            — Reçoit les rushs livrés, monte les versions vidéo.
 * CM                 — Community Manager : prépare légende/cover, publie sur Instagram.
 * EXTERNAL_GENERATOR — Client externe : accès limité (templates + covers) défini par
 *                      permissions individuelles. Remplace l'ancien rôle "USER"
 *                      depuis le renommage Vague 0.
 */
export type UserRole = "ADMIN" | "VIDEASTE" | "MONTEUR" | "CM" | "EXTERNAL_GENERATOR";

export const USER_ROLES = {
  ADMIN: "ADMIN",
  VIDEASTE: "VIDEASTE",
  MONTEUR: "MONTEUR",
  CM: "CM",
  EXTERNAL_GENERATOR: "EXTERNAL_GENERATOR",
} as const satisfies Record<UserRole, UserRole>;

// ---------------------------------------------------------------------------
// Statuts de publication
// ---------------------------------------------------------------------------

/**
 * Les 17 statuts possibles d'un PublicationSlot dans la pipeline éditoriale.
 *
 * Cycle nominal :
 *   DRAFT → PLANNED → RUSHES_EXPECTED → RUSHES_RECEIVED → IN_EDIT
 *     → EDIT_REVIEW → EDIT_APPROVED → CAPTIONS_PENDING → READY_FOR_CM
 *     [→ AWAITING_CLIENT → (CLIENT_REVISION ↻) ] → SCHEDULED → PUBLISHED
 *
 * Validation client externe (W2) :
 *   AWAITING_CLIENT   — lien magique envoyé au client, en attente de réponse
 *   CLIENT_REVISION   — client a refusé avec commentaire (allowsClientRevision=true)
 *                       → MONTEUR/CM corrige puis ADMIN renvoie pour validation
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
  | "READY_FOR_CM"
  | "AWAITING_CLIENT"
  | "CLIENT_REVISION"
  | "SCHEDULED"
  | "PUBLISHED"
  | "CANCELLED"
  | "BLOCKED"
  | "ARCHIVED"
  // Écrit par le pipeline auto_template (render/captions en cours) — pas un
  // legacy : conservé au resserrage V2.5 (22 → 16 statuts, backfill
  // 20260817200000).
  | "IN_PROGRESS";

export const SLOT_STATUSES = {
  DRAFT: "DRAFT",
  PLANNED: "PLANNED",
  RUSHES_EXPECTED: "RUSHES_EXPECTED",
  RUSHES_RECEIVED: "RUSHES_RECEIVED",
  IN_EDIT: "IN_EDIT",
  EDIT_REVIEW: "EDIT_REVIEW",
  EDIT_APPROVED: "EDIT_APPROVED",
  READY_FOR_CM: "READY_FOR_CM",
  AWAITING_CLIENT: "AWAITING_CLIENT",
  CLIENT_REVISION: "CLIENT_REVISION",
  SCHEDULED: "SCHEDULED",
  PUBLISHED: "PUBLISHED",
  CANCELLED: "CANCELLED",
  BLOCKED: "BLOCKED",
  ARCHIVED: "ARCHIVED",
  IN_PROGRESS: "IN_PROGRESS",
} as const satisfies Record<SlotStatus, SlotStatus>;

// ---------------------------------------------------------------------------
// Statuts terminaux / actifs
// ---------------------------------------------------------------------------

/**
 * Statuts terminaux du pipeline éditorial : un slot dans l'un de ces statuts
 * est considéré comme "terminé" et n'apparaît pas dans la worklist active.
 *
 */
export const TERMINAL_STATUSES = [
  "PUBLISHED",
  "ARCHIVED",
  "CANCELLED",
] as const satisfies string[];

export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];
