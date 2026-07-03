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
 * Champs PatternTemplate chargés pour la résolution directe « mission » (recette
 * globale sans binding). Identique à LEGACY_PATTERN_SELECT SAUF `needsRushes`,
 * qui n'existe pas sur PatternTemplate (dérivé de `source === "manual_rushes"`).
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
  needsAdminValidation: true,
  needsClientValidation: true,
  allowsClientRevision: true,
  needsBrief: true,
} satisfies Prisma.PatternTemplateSelect;

/**
 * Fragment à fusionner (`...slotEffectivePatternSelect`) dans un `select` de
 * PublicationSlot (direct ou imbriqué via render.publicationSlot / version.slot)
 * pour pouvoir appeler {@link resolveSlotEffectivePattern}. Charge le pattern
 * legacy ET le binding (recette) + son template.
 */
export const slotEffectivePatternSelect = {
  pattern: { select: LEGACY_PATTERN_SELECT },
  patternBinding: { include: { patternTemplate: true } },
  patternTemplate: { select: TEMPLATE_PATTERN_SELECT },
} satisfies Prisma.PublicationSlotSelect;

/** Slot minimal chargé avec {@link slotEffectivePatternSelect}. */
export type SlotWithEffectivePattern = {
  pattern: Prisma.AccountPatternGetPayload<{ select: typeof LEGACY_PATTERN_SELECT }> | null;
  patternBinding: Prisma.PatternBindingGetPayload<{ include: { patternTemplate: true } }> | null;
  patternTemplate: Prisma.PatternTemplateGetPayload<{ select: typeof TEMPLATE_PATTERN_SELECT }> | null;
};

/**
 * Résout la config de recette effective d'un slot.
 * Précédence : AccountPattern legacy si présent (slots historiques inchangés),
 * sinon dérivé du PatternBinding (recette par compte), sinon dérivé directement
 * du PatternTemplate global (missions sans compte ni binding). null si aucun.
 *
 * La 3e branche (patternTemplate direct) est indispensable : sans elle, une
 * mission account-less résout `null` et TOUTE la chaîne auto (captions/cover/
 * description/transitions) se skippe silencieusement — c'est le bug P2 que ce
 * module existe pour corriger.
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
      needsAdminValidation: t.needsAdminValidation,
      needsClientValidation: t.needsClientValidation,
      allowsClientRevision: t.allowsClientRevision,
      needsBrief: t.needsBrief,
      needsRushes: t.source === "manual_rushes",
    };
  }
  return null;
}
