/**
 * effectivePattern — résolution du pattern effectif d'un slot pour les triggers
 * automatiques (transcription, description, cover) et les transitions pipeline.
 *
 * Contexte (bug P2) : depuis le refactor « recettes par compte », un slot porte
 * deux relations possibles :
 *   - `slot.pattern`        → AccountPattern  (LEGACY, @deprecated)
 *   - `slot.patternBinding` → PatternBinding → PatternTemplate (recette, source canonique)
 *
 * Les slots créés via une recette ont `patternBindingId` renseigné mais
 * `patternId = null`. Or les triggers auto lisaient UNIQUEMENT `slot.pattern`
 * (legacy), jamais le binding → avec `slot.pattern = null`, coverMode et
 * needsDescription retombaient au défaut ("none") et toute la chaîne auto
 * (transcription → description, cover, transitions) était silencieusement
 * skippée.
 *
 * Ce module centralise (1) le fragment `select` à charger et (2) la résolution
 * `pattern (legacy) ?? patternBinding (recette)`. Précédence au legacy quand il
 * est présent → zéro changement de comportement pour les slots historiques.
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
  needsAdminValidation: boolean;
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  needsBrief: boolean;
  needsRushes: boolean;
}

/** Champs legacy AccountPattern chargés (alignés sur SlotEffectivePattern). */
const LEGACY_PATTERN_SELECT = {
  source: true,
  templateId: true,
  captionPresetId: true,
  descriptionPromptId: true,
  coverMode: true,
  coverConfig: true,
  needsCaptions: true,
  needsCaptionsMode: true,
  needsDescription: true,
  needsAdminValidation: true,
  needsClientValidation: true,
  allowsClientRevision: true,
  needsBrief: true,
  needsRushes: true,
} satisfies Prisma.AccountPatternSelect;

/**
 * Fragment à fusionner (`...slotEffectivePatternSelect`) dans un `select` de
 * PublicationSlot (direct ou imbriqué via render.publicationSlot / version.slot)
 * pour pouvoir appeler {@link resolveSlotEffectivePattern}. Charge le pattern
 * legacy ET le binding (recette) + son template.
 */
export const slotEffectivePatternSelect = {
  pattern: { select: LEGACY_PATTERN_SELECT },
  patternBinding: { include: { patternTemplate: true } },
} satisfies Prisma.PublicationSlotSelect;

/** Slot minimal chargé avec {@link slotEffectivePatternSelect}. */
export type SlotWithEffectivePattern = {
  pattern: Prisma.AccountPatternGetPayload<{ select: typeof LEGACY_PATTERN_SELECT }> | null;
  patternBinding: Prisma.PatternBindingGetPayload<{ include: { patternTemplate: true } }> | null;
};

/**
 * Résout la config de recette effective d'un slot.
 * Précédence : AccountPattern legacy si présent (slots historiques inchangés),
 * sinon dérivé du PatternBinding (recette par compte). null si aucun des deux.
 */
export function resolveSlotEffectivePattern(
  slot: SlotWithEffectivePattern,
): SlotEffectivePattern | null {
  if (slot.pattern) {
    return slot.pattern;
  }
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
      needsAdminValidation: e.needsAdminValidation,
      needsClientValidation: e.needsClientValidation,
      allowsClientRevision: e.allowsClientRevision,
      needsBrief: e.needsBrief,
      needsRushes: e.needsRushes,
    };
  }
  return null;
}
