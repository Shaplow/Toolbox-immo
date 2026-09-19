/**
 * Le contrat de données de la fiche métaobjet, partagé par ses sections.
 *
 * Ces types vivaient dans `EntityFiche.tsx`. Ils en sortent parce que chaque
 * section autonome en a besoin : les y laisser ferait importer l'assembleur
 * par ses propres enfants, c'est-à-dire un cycle.
 */

import type { CustomField } from "@/lib/customFields";
import type { EntityStatus, EntityValidationStatus } from "@/types/entities";
import type { EntityRush } from "@/components/entities/EntityRushesPanel";

export type { EntityRush };

export interface EntitySlotRef {
  id: string;
  title: string | null;
  status: string;
  scheduledAt: string | null;
}
export interface EntityActivityItem {
  id: string;
  type: string;
  createdAt: string;
  actorName: string | null;
}

export interface EntityFicheData {
  id: string;
  typeId: string;
  typeName: string;
  typeNamePlural: string | null;
  /** Icône du type (clé du registry entityTypeIcons). */
  typeIcon: string | null;
  hasPlanning: boolean;
  hasAccount: boolean;
  hasRushes: boolean;
  hasAssignees: boolean;
  visibility: "admin" | "team";
  label: string;
  /** Libellé posé à la main : le recalcul auto ne l'écrase plus. */
  labelIsCustom: boolean;
  /** Modèle de libellé du type — null/vide = libellé saisi à la main. */
  labelTemplate: string | null;
  isArchived: boolean;
  validationStatus: EntityValidationStatus | null;
  /** Le type a la validation client activée (bouton « Redemander »). */
  needsClientValidation: boolean;
  fieldSchema: CustomField[];
  fields: Record<string, string>;
  status: EntityStatus | null;
  accountId: string | null;
  accountLabel: string | null;
  scheduledAt: string | null;
  scheduledAtLabel: string | null;
  assigneeVideasteId: string | null;
  assigneeVideasteName: string | null;
  /** null = en attente, "CONFIRMED" | "DECLINED" (réponse du vidéaste). */
  videasteConfirmation: "CONFIRMED" | "DECLINED" | null;
  videasteConfirmationAt: string | null;
  videasteDeclineReason: string | null;
  defaultAssigneeMonteurId: string | null;
  defaultAssigneeCmId: string | null;
  notes: string | null;
  relatedEntityId: string | null;
  relatedLabel: string | null;
  /** Commande d'origine, si la fiche est née d'un bon de commande. */
  orderId: string | null;
  orderLabel: string | null;
  slots: EntitySlotRef[];
  shootSlots: EntitySlotRef[];
  rushes: EntityRush[];
  activities: EntityActivityItem[];
}
