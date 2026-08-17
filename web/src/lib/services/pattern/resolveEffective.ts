/**
 * resolveEffective — calcule la configuration finale d'un PatternBinding
 * en mergeant les valeurs du PatternTemplate (recette globale) avec
 * les éventuels overrides locaux du binding.
 *
 * Ordre de résolution (du moins prioritaire au plus prioritaire) :
 *   1. PatternTemplate (recette globale)
 *   2. PatternBinding overrides (per-account)
 *
 * Note : les overrides PER-SLOT (slot.captionPresetIdOverride, etc.) restent
 * appliqués au moment de la résolution finale (lecture côté fiche). Ce
 * helper s'arrête au niveau binding ; voir `resolveSlotConfig` pour la
 * cascade complète template → binding → slot.
 */

import type {
  PatternTemplate,
  PatternBinding,
  CaptionPreset,
  DescriptionPrompt,
  Template,
} from "@prisma/client";

export interface EffectivePattern {
  // Identité de la liaison
  bindingId: string;
  templateId: string;
  accountId: string;

  // Label visible
  label: string;

  // Recette (héritée du template, override-able au binding)
  source: string;
  builderTemplateId: string | null;
  captionPresetId: string | null;
  descriptionPromptId: string | null;
  coverMode: string;
  coverConfig: unknown;

  // Workflow flags (immuables au niveau binding pour le scope v1 ;
  // les overrides per-slot existent pour ces flags)
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
  /** Dérivé de source (manual_rushes ⇒ true). Conservé pour compat. */
  needsRushes: boolean;
  /** Recette nécessite un bien rattaché pour créer un slot/mission (legacy). */
  requiresProperty: boolean;
  /** Type de fiche exigé (remplace requiresProperty). null = aucun. */
  requiresEntityTypeId: string | null;

  // Planning + assignations (toujours portés par le binding)
  dayOfWeek: number[];
  publishTime: string;
  isActive: boolean;
  defaultAssigneeMonteurId: string | null;
  defaultAssigneeCmId: string | null;
  defaultAssigneeVideasteId: string | null;
}

interface BindingWithTemplate extends PatternBinding {
  patternTemplate: PatternTemplate;
}

/**
 * Résout les valeurs effectives d'un PatternBinding en lisant le template
 * sous-jacent et en appliquant les overrides du binding par-dessus.
 *
 * Ne touche pas la DB : prend en entrée des objets déjà hydratés via
 * `include: { patternTemplate: true }`.
 */
export function resolveEffectivePattern(
  binding: BindingWithTemplate,
): EffectivePattern {
  const t = binding.patternTemplate;
  return {
    bindingId: binding.id,
    templateId: t.id,
    accountId: binding.accountId,
    label: binding.customLabel ?? t.label,
    source: t.source,
    builderTemplateId: t.templateId,
    captionPresetId: binding.captionPresetIdOverride ?? t.captionPresetId,
    descriptionPromptId:
      binding.descriptionPromptIdOverride ?? t.descriptionPromptId,
    coverMode: binding.coverModeOverride ?? t.coverMode,
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
    dayOfWeek: binding.dayOfWeek,
    publishTime: binding.publishTime,
    isActive: binding.isActive,
    defaultAssigneeMonteurId: binding.defaultAssigneeMonteurId,
    defaultAssigneeCmId: binding.defaultAssigneeCmId,
    defaultAssigneeVideasteId: binding.defaultAssigneeVideasteId,
  };
}

/**
 * Vue « à plat » d'un binding + template résolu — les consommateurs lisent
 * `pattern.captionPresetId`, etc. sans connaître la séparation
 * PatternTemplate / PatternBinding. (Ex-toLegacyPatternShape : les noms de
 * champs viennent du défunt AccountPattern, la shape reste la lingua franca
 * de la couche service / UI.)
 */
export interface PatternView {
  id: string;
  accountId: string;
  label: string;
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
  dayOfWeek: number[];
  publishTime: string;
  isActive: boolean;
  defaultAssigneeMonteurId: string | null;
  defaultAssigneeCmId: string | null;
  defaultAssigneeVideasteId: string | null;
}

export function toPatternView(
  binding: BindingWithTemplate,
): PatternView {
  const e = resolveEffectivePattern(binding);
  return {
    id: e.bindingId,
    accountId: e.accountId,
    label: e.label,
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
    dayOfWeek: e.dayOfWeek,
    publishTime: e.publishTime,
    isActive: e.isActive,
    defaultAssigneeMonteurId: e.defaultAssigneeMonteurId,
    defaultAssigneeCmId: e.defaultAssigneeCmId,
    defaultAssigneeVideasteId: e.defaultAssigneeVideasteId,
  };
}

/**
 * Label visible d'une recette : customLabel du binding sinon label du
 * template. Source unique du motif `customLabel ?? patternTemplate.label`
 * (V2.2 — il était réimplémenté dans 11 sites). Typage structurel minimal :
 * utilisable côté serveur comme dans les composants client (aucune dépendance
 * runtime Prisma).
 */
export function patternLabel(binding: {
  customLabel: string | null;
  patternTemplate: { label: string };
}): string;
export function patternLabel(
  binding:
    | { customLabel: string | null; patternTemplate: { label: string } }
    | null
    | undefined,
): string | null;
export function patternLabel(
  binding:
    | { customLabel: string | null; patternTemplate: { label: string } }
    | null
    | undefined,
): string | null {
  if (!binding) return null;
  return binding.customLabel ?? binding.patternTemplate.label;
}

/** Type-only re-exports utilisés par les call-sites de service. */
export type { CaptionPreset, DescriptionPrompt, Template };
