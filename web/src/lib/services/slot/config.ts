/**
 * Resolve helpers : merge override per-slot + config du pattern (override prime).
 *
 * Utilisé par :
 * - computePublicationSteps (fiche slot)
 * - SlotDetailPanel (lecture seule pour afficher les valeurs effectives)
 * - triggerAutoCaptionFromTranscription, trigger-captions, trigger-cover
 * - resolveClientValidationConfig (page /validate/[token])
 *
 * Règle : null = hérite du pattern ; true/false/string = écrase explicitement.
 */

import { resolveCaptionsMode } from "@/lib/publications/captionsMode";

// ─── Helper générique ─────────────────────────────────────────────────────────

export type ResolveSource = "pattern" | "override" | "default";

/**
 * Résout une valeur effective override/pattern selon le contrat :
 *  - override !== null/undefined → override prime (source "override")
 *  - sinon pattern existe → valeur du pattern (source "pattern")
 *  - sinon → valeur par défaut (source "default")
 *
 * Helper générique réutilisable pour TOUS les champs `needs*Override` du slot.
 */
export function resolveOverride<T>(
  overrideValue: T | null | undefined,
  patternValue: T | null | undefined,
  defaultValue: T,
): { value: T; source: ResolveSource } {
  if (overrideValue !== null && overrideValue !== undefined) {
    return { value: overrideValue, source: "override" };
  }
  if (patternValue !== null && patternValue !== undefined) {
    return { value: patternValue, source: "pattern" };
  }
  return { value: defaultValue, source: "default" };
}

// ─── Resolve client validation config ─────────────────────────────────────────

interface PatternForValidation {
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
}

interface SlotForValidation {
  needsClientValidationOverride: boolean | null;
  allowsClientRevisionOverride: boolean | null;
}

export interface ClientValidationConfig {
  /** True si ce slot doit passer par une validation client externe. */
  needsClientValidation: boolean;
  /** True si le client peut refuser avec commentaire (ping-pong autorisé). */
  allowsClientRevision: boolean;
  /**
   * Pour debug/UI : indique d'où chaque valeur vient.
   * - "pattern" : valeur héritée du pattern
   * - "override" : valeur surchargée au niveau du slot
   * - "default" : pas de pattern (slot orphelin), valeur false par défaut
   */
  source: {
    needsClientValidation: ResolveSource;
    allowsClientRevision: ResolveSource;
  };
}

/**
 * Calcule la config effective de validation client pour un slot.
 * Override per-slot prime sur la config du pattern.
 */
export function resolveClientValidationConfig(
  slot: SlotForValidation,
  pattern: PatternForValidation | null,
): ClientValidationConfig {
  const needs = resolveOverride(
    slot.needsClientValidationOverride,
    pattern?.needsClientValidation,
    false,
  );
  const allows = resolveOverride(
    slot.allowsClientRevisionOverride,
    pattern?.allowsClientRevision,
    false,
  );
  return {
    needsClientValidation: needs.value,
    allowsClientRevision: allows.value,
    source: {
      needsClientValidation: needs.source,
      allowsClientRevision: allows.source,
    },
  };
}

// ─── Resolve étendu pour tous les needs* (Cohérence Workflows Phase 4) ────────

interface SlotForAllOverrides {
  /** Phase 2.3 — override admin validation du montage. */
  needsAdminValidationOverride?: boolean | null;
  needsClientValidationOverride: boolean | null;
  allowsClientRevisionOverride: boolean | null;
  /** "none" | "auto" | "manual". null = hérite du pattern. */
  needsCaptionsModeOverride?: string | null;
  needsDescriptionOverride: string | null;
  needsRushesOverride: boolean | null;
  needsBriefOverride: boolean | null;
  // Phase 5 — overrides one-off (référence directe aux ressources)
  coverModeOverride?: string | null;
  captionPresetIdOverride?: string | null;
  descriptionPromptIdOverride?: string | null;
}

interface PatternForAllNeeds {
  /** Phase 2.3 — flag d'activation de la validation admin (EDIT_REVIEW). */
  needsAdminValidation?: boolean;
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  /** "none" | "auto" | "manual". */
  needsCaptionsMode?: string | null;
  needsDescription: string;
  needsRushes: boolean;
  needsBrief: boolean;
  // Phase 5 — valeurs héritées pour les overrides one-off
  coverMode?: string;
  /** coverConfig contient le coverPresetId (Phase 3) — passé en string nullable. */
  coverPresetId?: string | null;
  captionPresetId?: string | null;
  descriptionPromptId?: string | null;
}

/**
 * Config résolue exhaustive des `needs*` (et `allows*`) pour un slot.
 * Inclut la source de chaque valeur (pattern/override/default) pour permettre
 * à l'UI d'indiquer "ce champ est surchargé".
 */
export interface SlotResolvedConfig {
  /** Phase 2.3 — true si le montage uploadé doit passer par EDIT_REVIEW (admin promote). */
  needsAdminValidation: boolean;
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  /** @deprecated V8 — utiliser needsCaptionsMode. Conservé pour compat consumers existants. */
  needsCaptions: boolean;
  /** V8 — mode effectif des captions : "none" | "auto" | "manual". */
  needsCaptionsMode: "none" | "auto" | "manual";
  needsDescription: string;
  needsRushes: boolean;
  needsBrief: boolean;
  // Phase 5 — config one-off résolue (référence aux ressources)
  coverMode: string;
  coverPresetId: string | null;
  captionPresetId: string | null;
  descriptionPromptId: string | null;
  source: {
    needsAdminValidation: ResolveSource;
    needsClientValidation: ResolveSource;
    allowsClientRevision: ResolveSource;
    needsCaptions: ResolveSource;
    needsCaptionsMode: ResolveSource;
    needsDescription: ResolveSource;
    needsRushes: ResolveSource;
    needsBrief: ResolveSource;
    coverMode: ResolveSource;
    coverPresetId: ResolveSource;
    captionPresetId: ResolveSource;
    descriptionPromptId: ResolveSource;
  };
}

/**
 * Calcule la config effective d'un slot pour tous les `needs*` (et `allows*`),
 * en appliquant les overrides per-slot par-dessus la config du pattern.
 */
export function resolveSlotConfig(
  slot: SlotForAllOverrides,
  pattern: PatternForAllNeeds | null,
): SlotResolvedConfig {
  const nav = resolveOverride(slot.needsAdminValidationOverride, pattern?.needsAdminValidation, false);
  const ncv = resolveOverride(slot.needsClientValidationOverride, pattern?.needsClientValidation, false);
  const acr = resolveOverride(slot.allowsClientRevisionOverride, pattern?.allowsClientRevision, false);
  // V2.3 — le mode enum est l'unique source ; le Boolean est dérivé.
  const ncMode = resolveCaptionsMode({
    slot: { needsCaptionsModeOverride: slot.needsCaptionsModeOverride },
    pattern: pattern ? { needsCaptionsMode: pattern.needsCaptionsMode } : null,
  });
  const ncModeSource: ResolveSource =
    slot.needsCaptionsModeOverride != null ? "override" : pattern ? "pattern" : "default";
  const nd = resolveOverride(slot.needsDescriptionOverride, pattern?.needsDescription, "none");
  const nr = resolveOverride(slot.needsRushesOverride, pattern?.needsRushes, false);
  const nb = resolveOverride(slot.needsBriefOverride, pattern?.needsBrief, false);
  // Phase 5 — overrides one-off
  const cm = resolveOverride(slot.coverModeOverride, pattern?.coverMode, "none");
  const cpId = resolveOverride(undefined, pattern?.coverPresetId, null);
  const captPId = resolveOverride(slot.captionPresetIdOverride, pattern?.captionPresetId, null);
  const descPId = resolveOverride(slot.descriptionPromptIdOverride, pattern?.descriptionPromptId, null);
  return {
    needsAdminValidation: nav.value,
    needsClientValidation: ncv.value,
    allowsClientRevision: acr.value,
    needsCaptions: ncMode !== "none",
    needsCaptionsMode: ncMode,
    needsDescription: nd.value,
    needsRushes: nr.value,
    needsBrief: nb.value,
    coverMode: cm.value,
    coverPresetId: cpId.value,
    captionPresetId: captPId.value,
    descriptionPromptId: descPId.value,
    source: {
      needsAdminValidation: nav.source,
      needsClientValidation: ncv.source,
      allowsClientRevision: acr.source,
      needsCaptions: ncModeSource,
      needsCaptionsMode: ncModeSource,
      needsDescription: nd.source,
      needsRushes: nr.source,
      needsBrief: nb.source,
      coverMode: cm.source,
      coverPresetId: cpId.source,
      captionPresetId: captPId.source,
      descriptionPromptId: descPId.source,
    },
  };
}
