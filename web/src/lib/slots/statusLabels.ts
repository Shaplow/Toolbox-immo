/**
 * Centralized labels, colors, and groups for PublicationSlot statuses.
 *
 * Both the legacy values (TO_DO, IN_PROGRESS, READY, CHECKING, DONE) and the
 * new granular pipeline values coexist here so that existing DB rows keep
 * rendering correctly until Phase 1.2 backfills the stored statuses.
 *
 * DO NOT remove the legacy entries until the backfill migration has run.
 */

import type { SlotStatus } from "@/types/roles";

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

// Glossaire FR — labels harmonisés au feminin (« la publication ») dans le
// cadre du refactor UX global. Court et actif (« À valider » plutôt que
// « Montage à valider ») pour scanner d'un coup d'œil sur Inbox/SlotCard.
export const STATUS_LABELS: Record<SlotStatus, string> = {
  // ── New pipeline statuses ──────────────────────────────────────────────
  DRAFT: "Brouillon",
  PLANNED: "Planifiée",
  RUSHES_EXPECTED: "Rushes attendus",
  RUSHES_RECEIVED: "Rushes reçus",
  IN_EDIT: "En montage",
  EDIT_REVIEW: "À valider",
  EDIT_APPROVED: "Validée",
  CAPTIONS_PENDING: "Sous-titres en cours",
  READY_FOR_CM: "Prête à publier",
  AWAITING_CLIENT: "Validation client",
  CLIENT_REVISION: "Modifications à appliquer",
  SCHEDULED: "Programmée",
  PUBLISHED: "Publiée",
  REJECTED: "Rejetée",
  CANCELLED: "Annulée",
  BLOCKED: "Bloquée",
  ARCHIVED: "Archivée",

  // ── Legacy aliases (mapped until DB backfill — Phase 1.2) ─────────────
  TO_DO: "À faire",
  IN_PROGRESS: "En cours",
  READY: "Prête",
  CHECKING: "Vérification",
  DONE: "Publiée",
};

// ---------------------------------------------------------------------------
// Colors (Tailwind utility classes)
// ---------------------------------------------------------------------------

// Doctrine : monochrome par défaut + accent sémantique chirurgical sur les
// statuts critiques uniquement (publié, refusé, bloqué, attente client,
// programmé). Tous les statuts d'étapes neutres restent en gris.
export const STATUS_COLORS: Record<SlotStatus, string> = {
  // ── Statuts neutres (étapes du pipeline) ──────────────────────────────
  DRAFT:            "bg-gray-100 text-gray-600 border-gray-200",
  PLANNED:          "bg-gray-100 text-gray-700 border-gray-200",
  RUSHES_EXPECTED:  "bg-gray-100 text-gray-700 border-gray-200",
  RUSHES_RECEIVED:  "bg-gray-100 text-gray-700 border-gray-200",
  IN_EDIT:          "bg-gray-100 text-gray-700 border-gray-200",
  EDIT_REVIEW:      "bg-gray-100 text-gray-700 border-gray-200",
  EDIT_APPROVED:    "bg-gray-100 text-gray-700 border-gray-200",
  CAPTIONS_PENDING: "bg-gray-100 text-gray-700 border-gray-200",
  READY_FOR_CM:     "bg-gray-100 text-gray-700 border-gray-200",
  CANCELLED:        "bg-gray-50 text-gray-500 border-gray-200",
  ARCHIVED:         "bg-gray-50 text-gray-400 border-gray-200",

  // ── Statuts critiques (accent sémantique chirurgical, V4 palette Coastal Studio) ──
  AWAITING_CLIENT:  "bg-warning-50 text-warning-700 border-warning-200",
  CLIENT_REVISION:  "bg-warning-50 text-warning-700 border-warning-200",
  SCHEDULED:        "bg-info-50 text-info-700 border-info-200",
  PUBLISHED:        "bg-success-50 text-success-700 border-success-200",
  REJECTED:         "bg-danger-50 text-danger-700 border-danger-200",
  BLOCKED:          "bg-danger-50 text-danger-700 border-danger-200",

  // ── Legacy aliases ─────────────────────────────────────────────────────
  TO_DO:            "bg-gray-100 text-gray-700 border-gray-200",
  IN_PROGRESS:      "bg-gray-100 text-gray-700 border-gray-200",
  READY:            "bg-gray-100 text-gray-700 border-gray-200",
  CHECKING:         "bg-gray-100 text-gray-700 border-gray-200",
  DONE:             "bg-success-50 text-success-700 border-success-200",
};

// ---------------------------------------------------------------------------
// Dot colors (used in SlotCard indicator)
// ---------------------------------------------------------------------------

export const STATUS_DOT: Record<SlotStatus, string> = {
  // V4 sweep : palette arc-en-ciel (yellow/orange/amber/blue/purple/indigo/
  // fuchsia/teal/green) → palette Coastal Studio (peach/sky/sage/rose) avec
  // semantique stable :
  // - peach   = attente humaine (vidéaste/monteur action attendue)
  // - sky     = pipeline en cours (montage/captions/programmé)
  // - rose    = attention/urgence (refus/blocage/AWAITING_CLIENT)
  // - sage    = success terminal (publié)
  // - gray    = neutre (draft/cancelled/archived)
  DRAFT: "bg-gray-400",
  PLANNED: "bg-info-600",
  RUSHES_EXPECTED: "bg-warning-600",
  RUSHES_RECEIVED: "bg-warning-600",
  IN_EDIT: "bg-info-600",
  EDIT_REVIEW: "bg-warning-600",
  EDIT_APPROVED: "bg-info-600",
  CAPTIONS_PENDING: "bg-info-600",
  READY_FOR_CM: "bg-info-700",
  AWAITING_CLIENT: "bg-danger-600",
  CLIENT_REVISION: "bg-danger-600",
  SCHEDULED: "bg-info-700",
  PUBLISHED: "bg-success-600",
  REJECTED: "bg-danger-700",
  CANCELLED: "bg-gray-300",
  BLOCKED: "bg-danger-700",
  ARCHIVED: "bg-gray-300",

  // ── Legacy aliases ─────────────────────────────────────────────────────
  TO_DO: "bg-gray-400",
  IN_PROGRESS: "bg-info-600",
  READY: "bg-info-600",
  CHECKING: "bg-warning-600",
  DONE: "bg-success-600",
};

// ---------------------------------------------------------------------------
// Owner — rôle responsable de la prochaine action pour un statut donné.
// ---------------------------------------------------------------------------
//
// Utile pour afficher "à qui le slot attend une action" sans logique éparpillée
// dans les composants. `null` quand aucun rôle n'a d'action attendue (terminaux).
//
// VIDEASTE  : doit fournir les rushes
// MONTEUR   : doit monter / exporter / appliquer revisions
// CM        : doit valider montage / écrire caption / programmer / suivre client
// ADMIN     : par défaut au début (brouillon/planifié) et pour les états bloqués

export type SlotOwnerRole = "VIDEASTE" | "MONTEUR" | "CM" | "ADMIN" | null;

export const STATUS_OWNER: Record<SlotStatus, SlotOwnerRole> = {
  // ── New pipeline statuses ──────────────────────────────────────────────
  DRAFT: "ADMIN",
  PLANNED: "ADMIN",
  RUSHES_EXPECTED: "VIDEASTE",
  RUSHES_RECEIVED: "MONTEUR",
  IN_EDIT: "MONTEUR",
  EDIT_REVIEW: "ADMIN",
  EDIT_APPROVED: "MONTEUR",
  CAPTIONS_PENDING: "MONTEUR",
  READY_FOR_CM: "CM",
  AWAITING_CLIENT: "CM",
  CLIENT_REVISION: "MONTEUR",
  SCHEDULED: "CM",
  PUBLISHED: null,
  REJECTED: "ADMIN",
  CANCELLED: null,
  BLOCKED: "ADMIN",
  ARCHIVED: null,

  // ── Legacy aliases ─────────────────────────────────────────────────────
  TO_DO: "ADMIN",
  IN_PROGRESS: "MONTEUR",
  READY: "CM",
  CHECKING: "CM",
  DONE: null,
};

/**
 * Owner contextuel : enrichit STATUS_OWNER avec l'état d'assignation.
 *
 * Cas particulier — statuts "phase amont" (PLANNED, TO_DO legacy) :
 * STATUS_OWNER les marque ADMIN par défaut, mais quand un vidéaste est
 * assigné, l'action attendue est concrètement le shoot, donc l'owner
 * effectif est le vidéaste. Sans cette résolution, le badge SlotCard
 * affichait "Admin" / "À toi (admin)" sur des slots où tout le monde
 * (sauf l'admin) attendait le vidéaste — trompeur côté UX et exclusif
 * côté logique (le vidéaste assigné ne voyait pas le slot comme "le
 * sien" dans le filtre `onlyMine`).
 *
 * DRAFT reste ADMIN même avec un vidéaste assigné : un brouillon n'est
 * pas considéré comme "à shooter" tant que l'admin n'a pas confirmé
 * (passage à PLANNED).
 */
export function resolveSlotOwner(slot: {
  status: SlotStatus | string;
  assigneeVideasteId?: string | null;
}): SlotOwnerRole {
  const base = STATUS_OWNER[slot.status as SlotStatus] ?? null;
  if (
    (slot.status === "PLANNED" || slot.status === "TO_DO") &&
    slot.assigneeVideasteId
  ) {
    return "VIDEASTE";
  }
  return base;
}

/** Libellé court pour le badge owner (FR). */
export const OWNER_LABEL: Record<NonNullable<SlotOwnerRole>, string> = {
  VIDEASTE: "Vidéaste",
  MONTEUR: "Monteur",
  CM: "CM",
  ADMIN: "Admin",
};

/** Couleur du badge owner — V4 palette Coastal Studio (1 ton par rôle). */
export const OWNER_BADGE_CLS: Record<NonNullable<SlotOwnerRole>, string> = {
  VIDEASTE: "bg-warning-50 text-warning-700 border-warning-200",
  MONTEUR:  "bg-info-50 text-info-700 border-info-200",
  CM:       "bg-success-50 text-success-700 border-success-200",
  ADMIN:    "bg-danger-50 text-danger-700 border-danger-200",
};

/**
 * Phrase d'action à afficher au rôle owner ("Tu dois…").
 * Pour les autres rôles, on affiche `OWNER_LABEL` à la place.
 */
export const NEXT_ACTION: Record<SlotStatus, string | null> = {
  DRAFT: "Compléter le brouillon",
  PLANNED: "Confirmer la production",
  RUSHES_EXPECTED: "Uploader les rushes",
  RUSHES_RECEIVED: "Démarrer le montage",
  IN_EDIT: "Continuer le montage",
  EDIT_REVIEW: "Valider le montage",
  EDIT_APPROVED: "Exporter le final",
  CAPTIONS_PENDING: "Générer les sous-titres",
  READY_FOR_CM: "Écrire la légende",
  AWAITING_CLIENT: "Relancer le client",
  CLIENT_REVISION: "Appliquer les revisions",
  SCHEDULED: "Surveiller la publication",
  PUBLISHED: null,
  REJECTED: "Décider de la suite",
  CANCELLED: null,
  BLOCKED: "Débloquer",
  ARCHIVED: null,

  // ── Legacy aliases ─────────────────────────────────────────────────────
  TO_DO: "Lancer la production",
  IN_PROGRESS: "Continuer le montage",
  READY: "Valider le montage",
  CHECKING: "Valider le montage",
  DONE: null,
};

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export const STATUS_GROUP: Record<SlotStatus, "todo" | "in_progress" | "done" | "blocked"> = {
  // ── New pipeline statuses ──────────────────────────────────────────────
  DRAFT: "todo",
  PLANNED: "todo",
  RUSHES_EXPECTED: "in_progress",
  RUSHES_RECEIVED: "in_progress",
  IN_EDIT: "in_progress",
  EDIT_REVIEW: "in_progress",
  EDIT_APPROVED: "in_progress",
  CAPTIONS_PENDING: "in_progress",
  READY_FOR_CM: "in_progress",
  AWAITING_CLIENT: "in_progress",
  CLIENT_REVISION: "in_progress",
  SCHEDULED: "in_progress",
  PUBLISHED: "done",
  REJECTED: "blocked",
  CANCELLED: "blocked",
  BLOCKED: "blocked",
  ARCHIVED: "done",

  // ── Legacy aliases ─────────────────────────────────────────────────────
  TO_DO: "todo",
  IN_PROGRESS: "in_progress",
  READY: "in_progress",
  CHECKING: "in_progress",
  DONE: "done",
};
