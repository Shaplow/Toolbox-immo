/**
 * Types et helpers de mapping pour les worklists par rôle (Home Monteur / CM / Admin).
 *
 * WorklistSlot est un subset de PublicationSlot avec les relations nécessaires
 * à l'affichage des cards. Il est distinct de PublicationSlot pour deux raisons :
 *   1. Les relations (account, pattern) sont des objets natifs Prisma, pas des ISO-strings.
 *   2. Il inclut les champs d'assignation (assigneeMonteurId, assigneeCmId) qui ne
 *      font pas encore partie du type PublicationSlot côté API calendar.
 *
 * Les helpers getMonteurSection / getCmSection centralisent la logique de mapping
 * statut → section pour éviter toute divergence entre HomeMonteur et HomeCm.
 */

import type { SlotStatus } from "@/types/roles";
import { TERMINAL_STATUSES } from "@/types/roles";
export type { TerminalStatus } from "@/types/roles";
export { TERMINAL_STATUSES };

// ---------------------------------------------------------------------------
// WorklistSlot
// ---------------------------------------------------------------------------

export interface WorklistAccount {
  id: string;
  handle: string;
  name: string;
}

export interface WorklistPattern {
  label: string;
}

export interface WorklistSlot {
  id: string;
  title: string | null;
  scheduledAt: Date;
  status: SlotStatus;
  notes: string | null;
  assigneeMonteurId: string | null;
  assigneeCmId: string | null;
  /** Phase VIDÉASTE — assignation du shoot. null = pas de vidéaste assigné (slot legacy ou one-off sans shoot). */
  assigneeVideasteId?: string | null;
  patternId: string | null;
  account: WorklistAccount;
  pattern: WorklistPattern | null;
}

// ---------------------------------------------------------------------------
// Sections Monteur
// ---------------------------------------------------------------------------

/**
 * Sections possibles dans la worklist Monteur.
 *
 * - "overdue"     : EN RETARD — slot dont scheduledAt < maintenant et pas terminé.
 * - "todo"        : À monter — PLANNED, RUSHES_EXPECTED, RUSHES_RECEIVED.
 * - "in_progress" : En cours — IN_EDIT, EDIT_REVIEW.
 * - "waiting"     : En attente client — EDIT_APPROVED, READY_FOR_CM, CAPTIONS_PENDING.
 *                   Informatif seulement (le monteur ne peut rien faire de plus).
 * - null          : Statut exclu de la worklist Monteur (DRAFT, SCHEDULED, PUBLISHED, etc.).
 */
export type MonteurSection = "overdue" | "todo" | "in_progress" | "waiting";

const MONTEUR_SECTION_MAP: Partial<Record<SlotStatus, MonteurSection>> = {
  // Brouillon assigné — surfacé en "todo" pour rester visible (sinon un
  // slot fraîchement créé avant passage en PLANNED disparaît de la worklist).
  DRAFT: "todo",
  // À monter — démarre quand les rushs sont livrés. PLANNED reste en "todo"
  // pour les slots sans pattern (legacy ou one-off) où le monteur peut anticiper.
  PLANNED: "todo",
  // Note Phase VIDÉASTE : RUSHES_EXPECTED appartient désormais au vidéaste.
  // Mais on garde un fallback informatif "todo" pour les slots sans vidéaste assigné
  // (slots historiques avant le rôle, ou one-off où aucun vidéaste n'est défini).
  // Le fallback ne crée pas de doublon — getMonteurSection sera appelé uniquement
  // si le slot est dans la worklist Monteur (assignéeMonteurId), donc déjà filtré.
  RUSHES_EXPECTED: "todo",
  RUSHES_RECEIVED: "todo",
  // En cours
  IN_EDIT: "in_progress",
  EDIT_REVIEW: "in_progress",
  // W2 — le client a demandé des corrections, le monteur doit agir
  CLIENT_REVISION: "in_progress",
  // En attente (informatif — le monteur ne peut rien faire de plus)
  EDIT_APPROVED: "waiting",
  CAPTIONS_PENDING: "waiting",
  READY_FOR_CM: "waiting",
  AWAITING_CLIENT: "waiting",
  // Exclus : DRAFT, SCHEDULED, PUBLISHED, REJECTED, CANCELLED, BLOCKED, ARCHIVED
};

/**
 * Retourne la section Monteur pour un statut donné.
 * Retourne `null` si le statut est exclu de la worklist Monteur (ex. DRAFT, PUBLISHED).
 */
export function getMonteurSection(status: SlotStatus): MonteurSection | null {
  return MONTEUR_SECTION_MAP[status] ?? null;
}

// ---------------------------------------------------------------------------
// Sections CM
// ---------------------------------------------------------------------------

/**
 * Sections possibles dans la worklist CM.
 *
 * - "overdue"       : EN RETARD — slot dont scheduledAt < maintenant et pas terminé.
 * - "to_prepare"    : À préparer — EDIT_APPROVED, CAPTIONS_PENDING, READY_FOR_CM.
 * - "to_publish"    : À publier cette semaine — SCHEDULED dans la semaine courante.
 * - "published"     : Publié récemment — PUBLISHED dans les 14 derniers jours.
 * - null            : Statut exclu de la worklist CM.
 */
export type CmSection = "overdue" | "to_prepare" | "to_publish" | "published";

const CM_SECTION_MAP: Partial<Record<SlotStatus, CmSection>> = {
  // À préparer
  EDIT_APPROVED: "to_prepare",
  CAPTIONS_PENDING: "to_prepare",
  READY_FOR_CM: "to_prepare",
  // W2 — le CM peut continuer cover/desc pendant la validation client (le user
  // a dit : "elle peut evidemment finir la cover et la desc pendant la
  // validation du client ça ça gene pas").
  AWAITING_CLIENT: "to_prepare",
  CLIENT_REVISION: "to_prepare",
  // À publier et publié — la logique temporelle est appliquée dans HomeCm
  SCHEDULED: "to_publish",
  PUBLISHED: "published",
  // Exclus : DRAFT, PLANNED, RUSHES_EXPECTED, RUSHES_RECEIVED, IN_EDIT, EDIT_REVIEW,
  //          REJECTED, CANCELLED, BLOCKED, ARCHIVED
};

/**
 * Retourne la section CM pour un statut donné (sans tenir compte des dates).
 * La logique temporelle (semaine courante, 14 derniers jours) est appliquée
 * côté HomeCm après ce premier filtre.
 * Retourne `null` si le statut est exclu de la worklist CM.
 */
export function getCmSection(status: SlotStatus): CmSection | null {
  return CM_SECTION_MAP[status] ?? null;
}

// ---------------------------------------------------------------------------
// Sections Vidéaste (Phase VIDÉASTE)
// ---------------------------------------------------------------------------

/**
 * Sections possibles dans la worklist Vidéaste.
 *
 * - "overdue"        : EN RETARD — shoot dont scheduledAt < maintenant et rushs non livrés.
 * - "to_shoot"       : À shooter — PLANNED, RUSHES_EXPECTED. Le vidéaste doit aller filmer.
 * - "shooting_done"  : Shoot livré — RUSHES_RECEIVED. Rushs uploadés, le relais passe au monteur.
 * - "in_edit"        : En montage (informatif) — IN_EDIT, EDIT_REVIEW, EDIT_APPROVED, etc.
 *                      Le vidéaste voit ces slots en lecture seule pour suivi/référence.
 * - null             : Statut exclu de la worklist Vidéaste.
 */
export type VideasteSection = "overdue" | "to_shoot" | "shooting_done" | "in_edit";

const VIDEASTE_SECTION_MAP: Partial<Record<SlotStatus, VideasteSection>> = {
  // Brouillon assigné — surfacé en "to_shoot" pour rester visible (un slot
  // assigné mais encore brouillon doit apparaître quelque part).
  DRAFT: "to_shoot",
  // À shooter (action requise)
  PLANNED: "to_shoot",
  RUSHES_EXPECTED: "to_shoot",
  // Shoot livré (en attente du monteur)
  RUSHES_RECEIVED: "shooting_done",
  // En montage et au-delà (informatif — le vidéaste ne fait plus rien)
  IN_EDIT: "in_edit",
  EDIT_REVIEW: "in_edit",
  EDIT_APPROVED: "in_edit",
  CAPTIONS_PENDING: "in_edit",
  READY_FOR_CM: "in_edit",
  CLIENT_REVISION: "in_edit",
  AWAITING_CLIENT: "in_edit",
  SCHEDULED: "in_edit",
  // Exclus : DRAFT, PUBLISHED, REJECTED, CANCELLED, BLOCKED, ARCHIVED
};

/**
 * Retourne la section Vidéaste pour un statut donné.
 * Retourne `null` si le statut est exclu de la worklist Vidéaste.
 */
export function getVideasteSection(status: SlotStatus): VideasteSection | null {
  return VIDEASTE_SECTION_MAP[status] ?? null;
}

// ---------------------------------------------------------------------------
// Helpers communs
// ---------------------------------------------------------------------------

/**
 * Retourne true si un slot est en retard :
 * scheduledAt est dans le passé ET le statut n'est pas terminal.
 */
export function isSlotOverdue(slot: Pick<WorklistSlot, "scheduledAt" | "status">): boolean {
  if ((TERMINAL_STATUSES as readonly string[]).includes(slot.status)) return false;
  return slot.scheduledAt < new Date();
}

/** Retourne le lundi de la semaine courante à 00:00:00 locale. */
export function getCurrentWeekMonday(): Date {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/** Retourne le dimanche de la semaine courante à 23:59:59 locale. */
export function getCurrentWeekSunday(): Date {
  const monday = getCurrentWeekMonday();
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return sunday;
}
