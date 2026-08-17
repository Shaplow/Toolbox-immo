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
 * V2.5 : la correspondance statut → phase vit dans SLOT_STATUS_META
 * (lib/slots/statusLabels.ts) — ce module ne garde que le type, les labels et
 * les couleurs de phase.
 */

import type { SlotStatus } from "@/types/calendar";
import { SLOT_STATUS_META } from "@/lib/slots/statusLabels";

export type PublicationPhase =
  | "planned"
  | "shooting"
  | "production"
  | "admin_review"
  | "cm_review"
  | "publishing"
  | "published"
  | "terminated";

export function getPublicationPhase(status: SlotStatus): PublicationPhase {
  return SLOT_STATUS_META[status]?.phase ?? "planned";
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

/** Badge label compact (1 mot) pour la SlotCard du calendrier. */
export const PHASE_BADGE_LABELS: Record<PublicationPhase, string> = {
  planned: "Planifié",
  shooting: "Shoot",
  production: "Production",
  admin_review: "Validation",
  cm_review: "Finalisation",
  publishing: "Publication",
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
  shooting: "bg-warning-100 text-warning-700 border-warning-200",
  production: "bg-stone-100 text-stone-700 border-stone-200",
  // amber = orange/jaune "attention requise" admin
  admin_review: "bg-warning-100 text-warning-700 border-warning-200",
  cm_review: "bg-info-100 text-info-700 border-info-200",
  publishing: "bg-info-100 text-info-700 border-info-200",
  published: "bg-green-100 text-green-700 border-green-200",
  terminated: "bg-gray-100 text-gray-500 border-gray-200",
};

/**
 * Dot couleur pour usages compacts (calendrier mensuel, mini-cards, etc.).
 */
export const PHASE_DOT: Record<PublicationPhase, string> = {
  planned: "bg-gray-400",
  shooting: "bg-warning-600",
  production: "bg-stone-500",
  admin_review: "bg-warning-600",
  cm_review: "bg-info-600",
  publishing: "bg-info-600",
  published: "bg-green-500",
  terminated: "bg-gray-300",
};
