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
import type { SlotEffectivePattern } from "@/lib/services/slot/effectivePattern";

/**
 * Vue « binding-centric » du pattern effectif — superset de
 * {@link SlotEffectivePattern} (le type canonique, celui produit par
 * `resolveSlotEffectivePattern`) enrichi de l'identité du binding et des
 * champs planning/assignations qui n'existent qu'à ce niveau (jamais au
 * niveau slot). Les champs partagés (label, source, needs*, cover*,
 * requires*…) sont hérités par `Omit` plutôt que redéclarés — seuls
 * `id`/`templateId` sont renommés ici pour coller au vocabulaire
 * binding-centric : `templateId` désigne l'id du PatternTemplate lui-même
 * (== `SlotEffectivePattern.id`), `builderTemplateId` l'id du Template
 * builder référencé (== `SlotEffectivePattern.templateId`).
 */
export interface EffectivePattern extends Omit<SlotEffectivePattern, "id" | "templateId"> {
  // Identité de la liaison
  bindingId: string;
  templateId: string;
  accountId: string;
  builderTemplateId: string | null;

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
    // Pas de branche d'override binding : la variation par compte passe par
    // rotationScope=per_account côté DataLibrary, pas par un override ici.
    descriptionDataLibraryId: t.descriptionDataLibraryId,
    descriptionDataSetTag: t.descriptionDataSetTag,
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
