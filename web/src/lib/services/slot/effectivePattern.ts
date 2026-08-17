/**
 * effectivePattern — résolution du pattern effectif d'un slot pour les triggers
 * automatiques (transcription, description, cover) et les transitions pipeline.
 *
 * Ce module centralise (1) le fragment `select` à charger et (2) la résolution
 * `patternBinding (recette par compte) ?? patternTemplate (recette globale)`.
 * La branche AccountPattern legacy a été décommissionnée (plan simplification
 * D2, 2026-08) après backfill complet de `slot.patternBindingId`.
 */

import { Prisma } from "@prisma/client";
import { resolveEffectivePattern } from "@/lib/services/pattern/resolveEffective";

/**
 * Forme normalisée du pattern effectif, suffisante pour les gardes des triggers
 * (transcription/description/cover) et la résolution `resolveSlotConfig`.
 */
export interface SlotEffectivePattern {
  source: string;
  templateId: string | null;
  captionPresetId: string | null;
  descriptionPromptId: string | null;
  coverMode: string;
  coverConfig: unknown;
  needsCaptions: boolean;
  needsCaptionsMode: string;
  needsDescription: string;
  /** Mode preFilled : clé du champ du Bien qui pré-remplit la légende. null si inactif. */
  descriptionSourceFieldKey: string | null;
  needsAdminValidation: boolean;
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  needsBrief: boolean;
  needsRushes: boolean;
  requiresProperty: boolean;
}

/**
 * Champs PatternTemplate chargés pour la résolution directe « mission » (recette
 * globale sans binding). `needsRushes` n'existe pas sur PatternTemplate
 * (dérivé de `source === "manual_rushes"`).
 */
const TEMPLATE_PATTERN_SELECT = {
  source: true,
  templateId: true,
  captionPresetId: true,
  descriptionPromptId: true,
  coverMode: true,
  coverConfig: true,
  needsCaptions: true,
  needsCaptionsMode: true,
  needsDescription: true,
  descriptionSourceFieldKey: true,
  needsAdminValidation: true,
  needsClientValidation: true,
  allowsClientRevision: true,
  needsBrief: true,
  requiresProperty: true,
} satisfies Prisma.PatternTemplateSelect;

/**
 * Fragment à fusionner (`...slotEffectivePatternSelect`) dans un `select` de
 * PublicationSlot (direct ou imbriqué via render.publicationSlot / version.slot)
 * pour pouvoir appeler {@link resolveSlotEffectivePattern}. Charge le binding
 * (recette) + son template.
 */
export const slotEffectivePatternSelect = {
  patternBinding: { include: { patternTemplate: true } },
  patternTemplate: { select: TEMPLATE_PATTERN_SELECT },
} satisfies Prisma.PublicationSlotSelect;

/** Slot minimal chargé avec {@link slotEffectivePatternSelect}. */
export type SlotWithEffectivePattern = {
  patternBinding: Prisma.PatternBindingGetPayload<{ include: { patternTemplate: true } }> | null;
  patternTemplate: Prisma.PatternTemplateGetPayload<{ select: typeof TEMPLATE_PATTERN_SELECT }> | null;
};

/**
 * Résout la config de recette effective d'un slot.
 * Précédence : PatternBinding (recette par compte) si présent, sinon dérivé
 * directement du PatternTemplate global (missions sans compte ni binding).
 * null si aucun.
 *
 * La 2e branche (patternTemplate direct) est indispensable : sans elle, une
 * mission account-less résout `null` et TOUTE la chaîne auto (captions/cover/
 * description/transitions) se skippe silencieusement — c'est le bug P2 que ce
 * module existe pour corriger.
 */
export function resolveSlotEffectivePattern(
  slot: SlotWithEffectivePattern,
): SlotEffectivePattern | null {
  if (slot.patternBinding) {
    const e = resolveEffectivePattern(slot.patternBinding);
    return {
      source: e.source,
      templateId: e.builderTemplateId,
      captionPresetId: e.captionPresetId,
      descriptionPromptId: e.descriptionPromptId,
      coverMode: e.coverMode,
      coverConfig: e.coverConfig,
      needsCaptions: e.needsCaptions,
      needsCaptionsMode: e.needsCaptionsMode,
      needsDescription: e.needsDescription,
      descriptionSourceFieldKey: e.descriptionSourceFieldKey,
      needsAdminValidation: e.needsAdminValidation,
      needsClientValidation: e.needsClientValidation,
      allowsClientRevision: e.allowsClientRevision,
      needsBrief: e.needsBrief,
      needsRushes: e.needsRushes,
      requiresProperty: e.requiresProperty,
    };
  }
  if (slot.patternTemplate) {
    const t = slot.patternTemplate;
    return {
      source: t.source,
      templateId: t.templateId,
      captionPresetId: t.captionPresetId,
      descriptionPromptId: t.descriptionPromptId,
      coverMode: t.coverMode,
      coverConfig: t.coverConfig,
      needsCaptions: t.needsCaptions,
      needsCaptionsMode: t.needsCaptionsMode,
      needsDescription: t.needsDescription,
      descriptionSourceFieldKey: t.descriptionSourceFieldKey,
      needsAdminValidation: t.needsAdminValidation,
      needsClientValidation: t.needsClientValidation,
      allowsClientRevision: t.allowsClientRevision,
      needsBrief: t.needsBrief,
      needsRushes: t.source === "manual_rushes",
      requiresProperty: t.requiresProperty,
    };
  }
  return null;
}
