/**
 * Phase humaine d'un PublicationSlot.
 *
 * Regroupe les 17 statuts pipeline en 8 phases lisibles pour l'UX :
 *
 *   À planifier   → DRAFT, PLANNED
 *   À shooter     → RUSHES_EXPECTED
 *   En production → RUSHES_RECEIVED, IN_EDIT, EDIT_APPROVED, CAPTIONS_PENDING
 *   À valider     → EDIT_REVIEW (Phase 2.3 — owner ADMIN)
 *   À finaliser   → READY_FOR_CM, AWAITING_CLIENT, CLIENT_REVISION
 *                    (Le CM doit encore préparer cover, description, et obtenir
 *                     la validation client si requise. Distincte de "À publier"
 *                     qui doit rester strictement réservé à SCHEDULED.)
 *   À publier     → SCHEDULED (tout est validé, attente du créneau de publication)
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
  | "admin_review"
  | "cm_review"
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
  // Phase 2.3 — EDIT_REVIEW est sa propre phase ("À valider", owner ADMIN).
  // Sans ça, le badge "En production" masquait l'attente d'une action admin.
  EDIT_REVIEW: "admin_review",
  EDIT_APPROVED: "production",
  CAPTIONS_PENDING: "production",
  // "À finaliser" : il reste cover, description et/ou validation client avant
  // que le slot soit réellement prêt à publier. Auparavant ces statuts étaient
  // mappés sur "publishing" → badge "À publier" prématuré et trompeur.
  READY_FOR_CM: "cm_review",
  AWAITING_CLIENT: "cm_review",
  CLIENT_REVISION: "cm_review",
  // "À publier" est strictement réservé à SCHEDULED — tout est validé, on
  // attend juste le créneau de publication Instagram.
  SCHEDULED: "publishing",
  PUBLISHED: "published",
  CANCELLED: "terminated",
  REJECTED: "terminated",
  ARCHIVED: "terminated",
  BLOCKED: "terminated",

  // ── Legacy aliases ────────────────────────────────────────────────────────
  TO_DO: "planned",
  IN_PROGRESS: "production",
  READY: "cm_review",
  CHECKING: "cm_review",
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
  admin_review: "À valider",
  cm_review: "À finaliser",
  publishing: "À publier",
  published: "Publié",
  terminated: "Terminé",
};

// ── Couleurs (Tailwind classes) ───────────────────────────────────────────────

/**
 * Badge complet (background + texte + border) pour cartes/chips.
 * Cohérent avec la palette utilisée dans STATUS_COLORS — gris/jaune/stone/
 * amber/indigo/teal/vert + gris pour terminated (état terminal "froid").
 *
 * cm_review (indigo) : territoire du CM, cohérent avec OWNER_BADGE_CLS.CM.
 * publishing (teal)  : signal "imminent / programmé", aligné sur la couleur
 *                       du statut SCHEDULED dans STATUS_COLORS.
 * production (stone) : beige neutre chaud — repeint depuis orange dans le
 *                       cadre de la refonte DS (chantier ui-boost). Évite
 *                       le clash avec la brand color orange #FF5A1F.
 */
export const PHASE_COLORS: Record<PublicationPhase, string> = {
  planned: "bg-gray-100 text-gray-700 border-gray-200",
  shooting: "bg-yellow-100 text-yellow-800 border-yellow-200",
  production: "bg-stone-100 text-stone-700 border-stone-200",
  // amber = orange/jaune "attention requise" admin
  admin_review: "bg-amber-100 text-amber-800 border-amber-300",
  cm_review: "bg-indigo-100 text-indigo-700 border-indigo-200",
  publishing: "bg-teal-100 text-teal-700 border-teal-200",
  published: "bg-green-100 text-green-700 border-green-200",
  terminated: "bg-gray-100 text-gray-500 border-gray-200",
};

/**
 * Dot couleur pour usages compacts (calendrier mensuel, mini-cards, etc.).
 */
export const PHASE_DOT: Record<PublicationPhase, string> = {
  planned: "bg-gray-400",
  shooting: "bg-yellow-500",
  production: "bg-stone-500",
  admin_review: "bg-amber-500",
  cm_review: "bg-indigo-500",
  publishing: "bg-teal-500",
  published: "bg-green-500",
  terminated: "bg-gray-300",
};
