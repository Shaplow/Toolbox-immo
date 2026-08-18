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
  /** Id du PatternTemplate (jamais du binding — utilisé par les vues UI). */
  id: string;
  /** Label visible : customLabel du binding sinon label du template. */
  label: string;
  source: string;
  templateId: string | null;
  captionPresetId: string | null;
  descriptionPromptId: string | null;
  coverMode: string;
  coverConfig: unknown;
  /** Dérivé de needsCaptionsMode !== "none" — la colonne Boolean est morte (V2.3). */
  needsCaptions: boolean;
  needsCaptionsMode: string;
  needsDescription: string;
  /** Mode preFilled : clé du champ du Bien qui pré-remplit la légende. null si inactif. */
  descriptionSourceFieldKey: string | null;
  /** Mode fixed : texte de départ de la légende. null si inactif. */
  descriptionFixedText: string | null;
  needsAdminValidation: boolean;
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  needsBrief: boolean;
  needsRushes: boolean;
  requiresProperty: boolean;
  /** Type de fiche exigé (remplace requiresProperty). null = aucun. */
  requiresEntityTypeId: string | null;
}

/**
 * Champs PatternTemplate chargés pour la résolution directe « mission » (recette
 * globale sans binding). `needsRushes` n'existe pas sur PatternTemplate
 * (dérivé de `source === "manual_rushes"`).
 */
const TEMPLATE_PATTERN_SELECT = {
  id: true,
  label: true,
  source: true,
  templateId: true,
  captionPresetId: true,
  descriptionPromptId: true,
  coverMode: true,
  coverConfig: true,
  needsCaptionsMode: true,
  needsDescription: true,
  descriptionSourceFieldKey: true,
  descriptionFixedText: true,
  needsAdminValidation: true,
  needsClientValidation: true,
  allowsClientRevision: true,
  needsBrief: true,
  requiresProperty: true,
  requiresEntityTypeId: true,
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
    // EffectivePattern est un superset de SlotEffectivePattern (Omit<id |
    // templateId> + champs binding) — seuls id/templateId sont renommés
    // entre les deux shapes, le reste se propage tel quel via le spread.
    const e = resolveEffectivePattern(slot.patternBinding);
    return { ...e, id: e.templateId, templateId: e.builderTemplateId };
  }
  if (slot.patternTemplate) {
    const t = slot.patternTemplate;
    return {
      id: t.id,
      label: t.label,
      source: t.source,
      templateId: t.templateId,
      captionPresetId: t.captionPresetId,
      descriptionPromptId: t.descriptionPromptId,
      coverMode: t.coverMode,
      coverConfig: t.coverConfig,
      needsCaptions: t.needsCaptionsMode !== "none",
      needsCaptionsMode: t.needsCaptionsMode,
      needsDescription: t.needsDescription,
      descriptionSourceFieldKey: t.descriptionSourceFieldKey,
      descriptionFixedText: t.descriptionFixedText,
      needsAdminValidation: t.needsAdminValidation,
      needsClientValidation: t.needsClientValidation,
      allowsClientRevision: t.allowsClientRevision,
      needsBrief: t.needsBrief,
      needsRushes: t.source === "manual_rushes",
      requiresProperty: t.requiresProperty,
      requiresEntityTypeId: t.requiresEntityTypeId,
    };
  }
  return null;
}

/**
 * Label visible de la recette effective d'un slot — raccourci quand seul le
 * label importe (listes, breadcrumbs, metadata). null si slot sans recette.
 */
export function resolvePatternLabel(slot: SlotWithEffectivePattern): string | null {
  return resolveSlotEffectivePattern(slot)?.label ?? null;
}
