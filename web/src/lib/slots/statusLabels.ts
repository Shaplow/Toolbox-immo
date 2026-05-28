/**
 * Centralized labels, colors, and groups for PublicationSlot statuses.
 *
 * Both the legacy values (TO_DO, IN_PROGRESS, READY, CHECKING, DONE) and the
 * new granular pipeline values coexist here so that existing DB rows keep
 * rendering correctly until Phase 1.2 backfills the stored statuses.
 *
 * DO NOT remove the legacy entries until the backfill migration has run.
 */

import type { SlotStatus } from "@/types/calendar";

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const STATUS_LABELS: Record<SlotStatus, string> = {
  // ── New pipeline statuses ──────────────────────────────────────────────
  DRAFT: "Brouillon",
  PLANNED: "Planifié",
  RUSHES_EXPECTED: "Rushes attendus",
  RUSHES_RECEIVED: "Rushes reçus",
  IN_EDIT: "En montage",
  EDIT_REVIEW: "Montage à valider",
  EDIT_APPROVED: "Montage validé",
  CAPTIONS_PENDING: "Sous-titres à faire",
  READY_FOR_CM: "Prêt pour CM",
  AWAITING_CLIENT: "Validation client en attente",
  CLIENT_REVISION: "Modifications client demandées",
  SCHEDULED: "Programmé",
  PUBLISHED: "Publié",
  REJECTED: "Refusé",
  CANCELLED: "Annulé",
  BLOCKED: "Bloqué",
  ARCHIVED: "Archivé",

  // ── Legacy aliases (mapped until DB backfill — Phase 1.2) ─────────────
  TO_DO: "À faire",
  IN_PROGRESS: "En cours",
  READY: "Prêt",
  CHECKING: "Vérification",
  DONE: "Publié",
};

// ---------------------------------------------------------------------------
// Colors (Tailwind utility classes)
// ---------------------------------------------------------------------------

export const STATUS_COLORS: Record<SlotStatus, string> = {
  // ── New pipeline statuses ──────────────────────────────────────────────
  DRAFT: "bg-gray-100 text-gray-600 border-gray-200",
  PLANNED: "bg-sky-100 text-sky-700 border-sky-200",
  RUSHES_EXPECTED: "bg-yellow-100 text-yellow-700 border-yellow-200",
  RUSHES_RECEIVED: "bg-yellow-100 text-yellow-800 border-yellow-300",
  IN_EDIT: "bg-orange-100 text-orange-700 border-orange-200",
  EDIT_REVIEW: "bg-amber-100 text-amber-700 border-amber-200",
  EDIT_APPROVED: "bg-blue-100 text-blue-700 border-blue-200",
  CAPTIONS_PENDING: "bg-purple-100 text-purple-700 border-purple-200",
  READY_FOR_CM: "bg-indigo-100 text-indigo-700 border-indigo-200",
  AWAITING_CLIENT: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200",
  CLIENT_REVISION: "bg-rose-100 text-rose-700 border-rose-200",
  SCHEDULED: "bg-teal-100 text-teal-700 border-teal-200",
  PUBLISHED: "bg-green-100 text-green-700 border-green-200",
  REJECTED: "bg-red-100 text-red-700 border-red-200",
  CANCELLED: "bg-gray-100 text-gray-500 border-gray-200",
  BLOCKED: "bg-red-100 text-red-800 border-red-300",
  ARCHIVED: "bg-gray-100 text-gray-400 border-gray-200",

  // ── Legacy aliases ─────────────────────────────────────────────────────
  TO_DO: "bg-red-100 text-red-700 border-red-200",
  IN_PROGRESS: "bg-orange-100 text-orange-700 border-orange-200",
  READY: "bg-blue-100 text-blue-700 border-blue-200",
  CHECKING: "bg-amber-100 text-amber-700 border-amber-200",
  DONE: "bg-green-100 text-green-700 border-green-200",
};

// ---------------------------------------------------------------------------
// Dot colors (used in SlotCard indicator)
// ---------------------------------------------------------------------------

export const STATUS_DOT: Record<SlotStatus, string> = {
  // ── New pipeline statuses ──────────────────────────────────────────────
  DRAFT: "bg-gray-400",
  PLANNED: "bg-sky-500",
  RUSHES_EXPECTED: "bg-yellow-500",
  RUSHES_RECEIVED: "bg-yellow-600",
  IN_EDIT: "bg-orange-500",
  EDIT_REVIEW: "bg-amber-400",
  EDIT_APPROVED: "bg-blue-500",
  CAPTIONS_PENDING: "bg-purple-500",
  READY_FOR_CM: "bg-indigo-500",
  AWAITING_CLIENT: "bg-fuchsia-500",
  CLIENT_REVISION: "bg-rose-500",
  SCHEDULED: "bg-teal-500",
  PUBLISHED: "bg-green-500",
  REJECTED: "bg-red-500",
  CANCELLED: "bg-gray-300",
  BLOCKED: "bg-red-700",
  ARCHIVED: "bg-gray-300",

  // ── Legacy aliases ─────────────────────────────────────────────────────
  TO_DO: "bg-red-500",
  IN_PROGRESS: "bg-orange-500",
  READY: "bg-blue-500",
  CHECKING: "bg-amber-400",
  DONE: "bg-green-500",
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
  EDIT_REVIEW: "CM",
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

/** Libellé court pour le badge owner (FR). */
export const OWNER_LABEL: Record<NonNullable<SlotOwnerRole>, string> = {
  VIDEASTE: "Vidéaste",
  MONTEUR: "Monteur",
  CM: "CM",
  ADMIN: "Admin",
};

/** Couleur du badge owner — tokenisé pour rester cohérent avec les rôles. */
export const OWNER_BADGE_CLS: Record<NonNullable<SlotOwnerRole>, string> = {
  VIDEASTE: "bg-amber-50 text-amber-700 border-amber-200",
  MONTEUR: "bg-orange-50 text-orange-700 border-orange-200",
  CM: "bg-indigo-50 text-indigo-700 border-indigo-200",
  ADMIN: "bg-violet-50 text-violet-700 border-violet-200",
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
