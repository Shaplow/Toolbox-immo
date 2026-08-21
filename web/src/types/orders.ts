/**
 * Types client-facing + labels FR des bons de commande (Order).
 * Miroir de types/entities.ts — les DTOs runtime viennent d'orderService
 * (OrderDetail), ici uniquement le vocabulaire UI partagé.
 */

import type { OrderStatus } from "@/lib/services/order/orderService";

export type { OrderStatus };

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  SUBMITTED: "Soumise",
  VALIDATED: "Validée",
  REJECTED: "Refusée",
  DONE: "Terminée",
  CANCELLED: "Annulée",
};

/** Variante de badge (classe complète) par statut de commande. */
export const ORDER_STATUS_BADGE: Record<OrderStatus, string> = {
  SUBMITTED: "bg-warning-50 text-warning-700 border-warning-200",
  VALIDATED: "bg-success-50 text-success-700 border-success-200",
  REJECTED: "bg-danger-50 text-danger-700 border-danger-200",
  DONE: "bg-muted text-muted-foreground border-border",
  CANCELLED: "bg-muted text-muted-foreground border-border",
};

/** Résumé de commande pour les listes (shape de listOrders). */
export interface OrderSummary {
  id: string;
  status: OrderStatus;
  createdAt: string;
  validatedAt: string | null;
  client: { id: string; name: string };
  account: { id: string; name: string; handle: string } | null;
  templateName: string;
  createdByName: string | null;
  entityCount: number;
  slotCount: number;
}
