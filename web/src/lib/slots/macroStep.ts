/**
 * macroStep — réduit les 17 statuts techniques d'un PublicationSlot à 5
 * étapes narratives lisibles par tous les rôles.
 *
 * Le statut technique reste source de vérité métier (transitions, owner,
 * actions). La macroStep sert uniquement à afficher une timeline visuelle
 * cohérente cross-surface (PublicationHeader, SlotCard, Worklist).
 *
 * Cas particuliers REJECTED / CANCELLED / BLOCKED / ARCHIVED → "blocked"
 * (état terminal hors flux normal — la timeline les affiche en rose).
 */

import type { SlotStatus } from "@/types/calendar";

export type MacroStep =
  | "brief"
  | "production"
  | "validation"
  | "scheduled"
  | "published"
  | "blocked";

export interface MacroStepInfo {
  key: MacroStep;
  label: string;
  // ordre [1..5] dans la timeline normale. "blocked" est hors timeline (-1).
  order: number;
}

export const MACRO_STEPS: Record<MacroStep, MacroStepInfo> = {
  brief: { key: "brief", label: "Brief", order: 1 },
  production: { key: "production", label: "Production", order: 2 },
  validation: { key: "validation", label: "Validation", order: 3 },
  scheduled: { key: "scheduled", label: "Programmée", order: 4 },
  published: { key: "published", label: "Publiée", order: 5 },
  blocked: { key: "blocked", label: "Bloquée", order: -1 },
};

/** Ordre canonique pour le rendu timeline. "blocked" exclu. */
export const MACRO_STEP_ORDER: MacroStep[] = [
  "brief",
  "production",
  "validation",
  "scheduled",
  "published",
];

/**
 * Map statut technique → macroStep. Déterministe, sans branche conditionnelle
 * sur des champs non-statut (assignée, currentVersion, etc.).
 */
export function getMacroStep(status: SlotStatus): MacroStep {
  switch (status) {
    case "DRAFT":
    case "PLANNED":
    case "TO_DO":
      return "brief";

    case "RUSHES_EXPECTED":
    case "RUSHES_RECEIVED":
    case "IN_EDIT":
    case "IN_PROGRESS":
      return "production";

    case "EDIT_REVIEW":
    case "EDIT_APPROVED":
    case "CAPTIONS_PENDING":
    case "CHECKING":
    case "READY":
      return "validation";

    case "READY_FOR_CM":
    case "AWAITING_CLIENT":
    case "CLIENT_REVISION":
    case "SCHEDULED":
      return "scheduled";

    case "PUBLISHED":
    case "DONE":
    case "ARCHIVED":
      return "published";

    case "REJECTED":
    case "CANCELLED":
    case "BLOCKED":
      return "blocked";
  }
}
