/**
 * Types client-facing pour les fiches (Entity) — plan simplification Phase 5
 * (métaobjet). Remplace `types/events.ts` (ShootEvent) généralisé aux deux
 * visibilités (« Bien » admin, « Tournage » team). Dates sérialisées en ISO
 * string (passage Server → Client component).
 */

import type { CustomField } from "@/lib/customFields";

export type EntityStatus = "PLANNED" | "SHOT" | "DONE" | "CANCELLED";

export type EntityValidationStatus =
  | "PENDING_ADMIN"
  | "PENDING_CLIENT"
  | "APPROVED"
  | "REJECTED"
  | "REJECTED_CLIENT";

export interface EntityTypeSummary {
  id: string;
  name: string;
  namePlural: string | null;
  icon: string | null;
  fieldSchema: CustomField[];
  hasPlanning: boolean;
  hasAccount: boolean;
  hasRushes: boolean;
  hasAssignees: boolean;
  visibility: "admin" | "team";
  position: number;
  isSystem: boolean;
}

/** Résumé de fiche pour les listes / le calendrier. */
export interface EntitySummary {
  id: string;
  typeId: string;
  type: {
    id: string;
    name: string;
    namePlural: string | null;
    icon: string | null;
    visibility: string;
    hasPlanning: boolean;
    hasAccount: boolean;
    hasRushes: boolean;
    hasAssignees: boolean;
  };
  label: string;
  fields: Record<string, string>;
  isArchived: boolean;
  validationStatus: EntityValidationStatus | null;
  accountId: string | null;
  account: { id: string; name: string; handle: string } | null;
  scheduledAt: string | null;
  endAt: string | null;
  shotAt: string | null;
  status: EntityStatus | null;
  assigneeVideasteId: string | null;
  assigneeVideaste: { id: string; name: string } | null;
  defaultAssigneeMonteurId: string | null;
  defaultAssigneeCmId: string | null;
  notes: string | null;
  relatedEntityId: string | null;
  related: { id: string; label: string; typeId: string } | null;
  createdAt: string;
  updatedAt: string;
  _count: { slots: number; shootSlots: number; rushes: number };
}

// Libellés neutres (V3.2) : le métaobjet sert aussi des types sans tournage
// (agence de mode, fleuriste…) — « À tourner / Tourné » ne généralise pas.
export const ENTITY_STATUS_LABELS: Record<EntityStatus, string> = {
  PLANNED: "Planifié",
  SHOT: "Réalisé",
  DONE: "Terminé",
  CANCELLED: "Annulé",
};

/** Classe Tailwind du dot de statut. */
export const ENTITY_STATUS_DOT: Record<EntityStatus, string> = {
  PLANNED: "bg-warning-600",
  SHOT: "bg-info-600",
  DONE: "bg-success-600",
  CANCELLED: "bg-zinc-400",
};

/** Variante de badge (classe complète) par statut. */
export const ENTITY_STATUS_BADGE: Record<EntityStatus, string> = {
  PLANNED: "bg-warning-50 text-warning-700 border-warning-200",
  SHOT: "bg-info-50 text-info-700 border-info-200",
  DONE: "bg-success-50 text-success-700 border-success-200",
  CANCELLED: "bg-muted text-muted-foreground border-border",
};

// ─── Validation bidirectionnelle ────────────────────────────────────────────

export const ENTITY_VALIDATION_LABELS: Record<EntityValidationStatus, string> = {
  PENDING_ADMIN: "À valider (admin)",
  PENDING_CLIENT: "À valider (client)",
  APPROVED: "Validée",
  REJECTED: "Refusée",
  REJECTED_CLIENT: "Refusée (client)",
};

/** Variante de badge (classe complète) par statut de validation. */
export const ENTITY_VALIDATION_BADGE: Record<EntityValidationStatus, string> = {
  PENDING_ADMIN: "bg-warning-50 text-warning-700 border-warning-200",
  PENDING_CLIENT: "bg-info-50 text-info-700 border-info-200",
  APPROVED: "bg-success-50 text-success-700 border-success-200",
  REJECTED: "bg-danger-50 text-danger-700 border-danger-200",
  REJECTED_CLIENT: "bg-warning-50 text-warning-700 border-warning-200",
};
