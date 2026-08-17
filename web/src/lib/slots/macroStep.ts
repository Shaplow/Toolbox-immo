/**
 * macroStep — réduit les 17 statuts techniques d'un PublicationSlot à 5
 * étapes narratives lisibles par tous les rôles.
 *
 * Le statut technique reste source de vérité métier (transitions, owner,
 * actions). La macroStep sert uniquement à afficher une timeline visuelle
 * cohérente cross-surface (PublicationHeader, SlotCard, Worklist).
 *
 * Cas particuliers CANCELLED / BLOCKED → "blocked" (état terminal hors flux
 * normal — la timeline les affiche en rose).
 */

import type { SlotStatus } from "@/types/calendar";
import { SLOT_STATUS_META } from "@/lib/slots/statusLabels";

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
 * Statut technique → macroStep — dérivé de SLOT_STATUS_META (V2.5).
 */
export function getMacroStep(status: SlotStatus): MacroStep {
  return SLOT_STATUS_META[status]?.macroStep ?? "brief";
}
