/**
 * SLOT_STATUS_META — descripteur unique des statuts de PublicationSlot (V2.5).
 *
 * Un statut = UNE entrée portant tout ce que l'UI et les services en lisent
 * (label, couleurs, owner, action, groupe, phase, macro-étape). Avant : ~10
 * maps `Record<SlotStatus, …>` parallèles réparties dans 4 fichiers — ajouter
 * un statut demandait 10 éditions synchronisées.
 *
 * Les exports historiques (STATUS_LABELS, STATUS_COLORS, STATUS_DOT,
 * STATUS_OWNER, NEXT_ACTION, STATUS_GROUP) sont DÉRIVÉS du méta : les
 * consommateurs existants ne changent pas, la source est unique.
 *
 * Resserrage V2.5 (22 → 16) : les statuts legacy TO_DO / READY / CHECKING /
 * DONE, plus REJECTED (0 écrivain) et CAPTIONS_PENDING (jamais atteint) ont
 * été backfillés en DB (migration 20260817200000) et retirés du type.
 */

import type { SlotStatus } from "@/types/roles";
import type { PublicationPhase } from "@/lib/slots/phase";
import type { MacroStep } from "@/lib/slots/macroStep";

export type SlotOwnerRole = "VIDEASTE" | "MONTEUR" | "CM" | "ADMIN" | null;

export interface SlotStatusMeta {
  /** Libellé FR (féminin — « la publication »), court et actif. */
  label: string;
  /** Chip complet (bg + text + border). Neutre par défaut, accent chirurgical. */
  colors: string;
  /** Pastille SlotCard. */
  dot: string;
  /** Rôle dont on attend la prochaine action (null = terminal). */
  owner: SlotOwnerRole;
  /** Phrase d'action affichée au rôle owner (« Tu dois… »). */
  nextAction: string | null;
  /** Regroupement grossier (KPI, filtres). */
  group: "todo" | "in_progress" | "done" | "blocked";
  /** Phase de la chaîne de production (badges calendrier). */
  phase: PublicationPhase;
  /** Macro-étape de la timeline publication. */
  macroStep: MacroStep;
}

const NEUTRAL = "bg-gray-100 text-gray-700 border-gray-200";

export const SLOT_STATUS_META: Record<SlotStatus, SlotStatusMeta> = {
  DRAFT: {
    label: "Brouillon",
    colors: "bg-gray-100 text-gray-600 border-gray-200",
    dot: "bg-gray-400",
    owner: "ADMIN",
    nextAction: "Compléter le brouillon",
    group: "todo",
    phase: "planned",
    macroStep: "brief",
  },
  PLANNED: {
    label: "Planifiée",
    colors: NEUTRAL,
    dot: "bg-info-600",
    owner: "ADMIN",
    nextAction: "Confirmer la production",
    group: "todo",
    phase: "planned",
    macroStep: "brief",
  },
  RUSHES_EXPECTED: {
    label: "Rushes attendus",
    colors: NEUTRAL,
    dot: "bg-warning-600",
    owner: "VIDEASTE",
    nextAction: "Uploader les rushes",
    group: "in_progress",
    phase: "shooting",
    macroStep: "production",
  },
  RUSHES_RECEIVED: {
    label: "Rushes reçus",
    colors: NEUTRAL,
    dot: "bg-warning-600",
    owner: "MONTEUR",
    nextAction: "Démarrer le montage",
    group: "in_progress",
    phase: "production",
    macroStep: "production",
  },
  IN_EDIT: {
    label: "En montage",
    colors: NEUTRAL,
    dot: "bg-info-600",
    owner: "MONTEUR",
    nextAction: "Continuer le montage",
    group: "in_progress",
    phase: "production",
    macroStep: "production",
  },
  // Écrit par le pipeline auto_template (render/captions en cours).
  IN_PROGRESS: {
    label: "En cours",
    colors: NEUTRAL,
    dot: "bg-info-600",
    owner: "MONTEUR",
    nextAction: "Continuer le montage",
    group: "in_progress",
    phase: "production",
    macroStep: "production",
  },
  // EDIT_REVIEW est sa propre phase (« À valider », owner ADMIN) : sans ça,
  // le badge « En production » masquait l'attente d'une action admin.
  EDIT_REVIEW: {
    label: "À valider",
    colors: NEUTRAL,
    dot: "bg-warning-600",
    owner: "ADMIN",
    nextAction: "Valider le montage",
    group: "in_progress",
    phase: "admin_review",
    macroStep: "validation",
  },
  EDIT_APPROVED: {
    label: "Validée",
    colors: NEUTRAL,
    dot: "bg-info-600",
    owner: "MONTEUR",
    nextAction: "Exporter le final",
    group: "in_progress",
    phase: "production",
    macroStep: "validation",
  },
  // « À finaliser » : il reste cover, description et/ou validation client —
  // « À publier » (phase publishing) est strictement réservé à SCHEDULED.
  READY_FOR_CM: {
    label: "Prête à publier",
    colors: NEUTRAL,
    dot: "bg-info-700",
    owner: "CM",
    nextAction: "Écrire la légende",
    group: "in_progress",
    phase: "cm_review",
    macroStep: "scheduled",
  },
  AWAITING_CLIENT: {
    label: "Validation client",
    colors: "bg-warning-50 text-warning-700 border-warning-200",
    dot: "bg-danger-600",
    owner: "CM",
    nextAction: "Relancer le client",
    group: "in_progress",
    phase: "cm_review",
    macroStep: "scheduled",
  },
  CLIENT_REVISION: {
    label: "Modifications à appliquer",
    colors: "bg-warning-50 text-warning-700 border-warning-200",
    dot: "bg-danger-600",
    owner: "MONTEUR",
    nextAction: "Appliquer les revisions",
    group: "in_progress",
    phase: "cm_review",
    macroStep: "scheduled",
  },
  SCHEDULED: {
    label: "Programmée",
    colors: "bg-info-50 text-info-700 border-info-200",
    dot: "bg-info-700",
    owner: "CM",
    nextAction: "Surveiller la publication",
    group: "in_progress",
    phase: "publishing",
    macroStep: "scheduled",
  },
  PUBLISHED: {
    label: "Publiée",
    colors: "bg-success-50 text-success-700 border-success-200",
    dot: "bg-success-600",
    owner: null,
    nextAction: null,
    group: "done",
    phase: "published",
    macroStep: "published",
  },
  CANCELLED: {
    label: "Annulée",
    colors: "bg-gray-50 text-gray-500 border-gray-200",
    dot: "bg-gray-300",
    owner: null,
    nextAction: null,
    group: "blocked",
    phase: "terminated",
    macroStep: "blocked",
  },
  BLOCKED: {
    label: "Bloquée",
    colors: "bg-danger-50 text-danger-700 border-danger-200",
    dot: "bg-danger-700",
    owner: "ADMIN",
    nextAction: "Débloquer",
    group: "blocked",
    phase: "terminated",
    macroStep: "blocked",
  },
  ARCHIVED: {
    label: "Archivée",
    colors: "bg-gray-50 text-gray-400 border-gray-200",
    dot: "bg-gray-300",
    owner: null,
    nextAction: null,
    group: "done",
    phase: "terminated",
    macroStep: "published",
  },
};

// ---------------------------------------------------------------------------
// Maps dérivées — API historique conservée, source unique ci-dessus.
// ---------------------------------------------------------------------------

function derive<K extends keyof SlotStatusMeta>(key: K): Record<SlotStatus, SlotStatusMeta[K]> {
  return Object.fromEntries(
    Object.entries(SLOT_STATUS_META).map(([status, meta]) => [status, meta[key]]),
  ) as Record<SlotStatus, SlotStatusMeta[K]>;
}

export const STATUS_LABELS: Record<SlotStatus, string> = derive("label");
export const STATUS_COLORS: Record<SlotStatus, string> = derive("colors");
export const STATUS_DOT: Record<SlotStatus, string> = derive("dot");
export const STATUS_OWNER: Record<SlotStatus, SlotOwnerRole> = derive("owner");
export const NEXT_ACTION: Record<SlotStatus, string | null> = derive("nextAction");
export const STATUS_GROUP: Record<SlotStatus, "todo" | "in_progress" | "done" | "blocked"> =
  derive("group");

/**
 * Owner contextuel : enrichit le méta avec l'état d'assignation.
 *
 * Cas particulier — statut « phase amont » (PLANNED) : le méta le marque
 * ADMIN par défaut, mais quand un vidéaste est assigné, l'action attendue est
 * concrètement le shoot → l'owner effectif est le vidéaste. DRAFT reste ADMIN
 * même avec un vidéaste assigné (un brouillon n'est pas « à shooter » tant
 * que l'admin n'a pas confirmé le passage à PLANNED).
 */
export function resolveSlotOwner(slot: {
  status: SlotStatus | string;
  assigneeVideasteId?: string | null;
}): SlotOwnerRole {
  const base = STATUS_OWNER[slot.status as SlotStatus] ?? null;
  if (slot.status === "PLANNED" && slot.assigneeVideasteId) {
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

/** Couleur du badge owner (1 ton par rôle). */
export const OWNER_BADGE_CLS: Record<NonNullable<SlotOwnerRole>, string> = {
  VIDEASTE: "bg-warning-50 text-warning-700 border-warning-200",
  MONTEUR:  "bg-info-50 text-info-700 border-info-200",
  CM:       "bg-success-50 text-success-700 border-success-200",
  ADMIN:    "bg-danger-50 text-danger-700 border-danger-200",
};
