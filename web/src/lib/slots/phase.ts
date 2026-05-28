/**
 * Phase humaine d'un PublicationSlot.
 *
 * Regroupe les 17 statuts pipeline en 6 phases lisibles pour l'UX :
 *
 *   À planifier   → DRAFT, PLANNED
 *   À shooter     → RUSHES_EXPECTED
 *   En production → RUSHES_RECEIVED, IN_EDIT, EDIT_REVIEW, EDIT_APPROVED, CAPTIONS_PENDING
 *   À publier     → READY_FOR_CM, AWAITING_CLIENT, CLIENT_REVISION, SCHEDULED
 *   Publié        → PUBLISHED
 *   Terminé       → CANCELLED, REJECTED, ARCHIVED, BLOCKED
 *
 * La granularité technique (où en est le render, la cover, les sous-titres, etc.)
 * est portée par PipelineDots — pas par cette phase.
 *
 * Les statuts legacy (TO_DO, IN_PROGRESS, READY, CHECKING, DONE) sont mappés
 * raisonnablement pour ne pas casser les slots créés avant le backfill Phase 1.2.
 */

import type { SlotStatus } from "@/types/calendar";

export type PublicationPhase =
  | "planned"
  | "shooting"
  | "production"
  | "publishing"
  | "published"
  | "terminated";

const STATUS_TO_PHASE: Record<SlotStatus, PublicationPhase> = {
  // ── Nouveaux statuts pipeline ─────────────────────────────────────────────
  DRAFT: "planned",
  PLANNED: "planned",
  RUSHES_EXPECTED: "shooting",
  RUSHES_RECEIVED: "production",
  IN_EDIT: "production",
  EDIT_REVIEW: "production",
  EDIT_APPROVED: "production",
  CAPTIONS_PENDING: "production",
  READY_FOR_CM: "publishing",
  AWAITING_CLIENT: "publishing",
  CLIENT_REVISION: "publishing",
  SCHEDULED: "publishing",
  PUBLISHED: "published",
  CANCELLED: "terminated",
  REJECTED: "terminated",
  ARCHIVED: "terminated",
  BLOCKED: "terminated",

  // ── Legacy aliases ────────────────────────────────────────────────────────
  TO_DO: "planned",
  IN_PROGRESS: "production",
  READY: "publishing",
  CHECKING: "publishing",
  DONE: "published",
};

export function getPublicationPhase(status: SlotStatus): PublicationPhase {
  return STATUS_TO_PHASE[status] ?? "planned";
}

// ── Labels ────────────────────────────────────────────────────────────────────

export const PHASE_LABELS: Record<PublicationPhase, string> = {
  planned: "À planifier",
  shooting: "À shooter",
  production: "En production",
  publishing: "À publier",
  published: "Publié",
  terminated: "Terminé",
};

// ── Couleurs (Tailwind classes) ───────────────────────────────────────────────

/**
 * Badge complet (background + texte + border) pour cartes/chips.
 * Cohérent avec la palette utilisée dans STATUS_COLORS — gris/jaune/orange/
 * indigo/vert + gris pour terminated (état terminal "froid").
 */
export const PHASE_COLORS: Record<PublicationPhase, string> = {
  planned: "bg-gray-100 text-gray-700 border-gray-200",
  shooting: "bg-yellow-100 text-yellow-800 border-yellow-200",
  production: "bg-orange-100 text-orange-800 border-orange-200",
  publishing: "bg-indigo-100 text-indigo-700 border-indigo-200",
  published: "bg-green-100 text-green-700 border-green-200",
  terminated: "bg-gray-100 text-gray-500 border-gray-200",
};

/**
 * Dot couleur pour usages compacts (calendrier mensuel, mini-cards, etc.).
 */
export const PHASE_DOT: Record<PublicationPhase, string> = {
  planned: "bg-gray-400",
  shooting: "bg-yellow-500",
  production: "bg-orange-500",
  publishing: "bg-indigo-500",
  published: "bg-green-500",
  terminated: "bg-gray-300",
};
