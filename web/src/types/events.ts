/**
 * Types client-facing pour les événements de tournage (ShootEvent).
 * Dates sérialisées en ISO string (passage Server → Client component).
 */

export type ShootEventStatus = "PLANNED" | "SHOT" | "DONE" | "CANCELLED";

/** Résumé d'événement pour le calendrier / les listes. */
export interface ShootEventSummary {
  id: string;
  title: string;
  accountId: string;
  account: { id: string; name: string; handle: string } | null;
  property: { id: string; label: string } | null;
  scheduledAt: string; // ISO
  endAt: string | null;
  status: ShootEventStatus;
  assigneeVideaste: { id: string; name: string } | null;
  reelsCount: number;
  rushesCount: number;
}

export const EVENT_STATUS_LABELS: Record<ShootEventStatus, string> = {
  PLANNED: "À tourner",
  SHOT: "Tourné",
  DONE: "Terminé",
  CANCELLED: "Annulé",
};

/** Classe Tailwind du dot de statut. */
export const EVENT_STATUS_DOT: Record<ShootEventStatus, string> = {
  PLANNED: "bg-warning-600",
  SHOT: "bg-info-600",
  DONE: "bg-success-600",
  CANCELLED: "bg-zinc-400",
};

/** Variante de badge (classe complète) par statut. */
export const EVENT_STATUS_BADGE: Record<ShootEventStatus, string> = {
  PLANNED: "bg-warning-50 text-warning-700 border-warning-200",
  SHOT: "bg-info-50 text-info-700 border-info-200",
  DONE: "bg-success-50 text-success-700 border-success-200",
  CANCELLED: "bg-muted text-muted-foreground border-border",
};
