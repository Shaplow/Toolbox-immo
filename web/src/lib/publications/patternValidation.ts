/**
 * Validation cross-field pour AccountPattern.
 *
 * Source of truth métier : un pattern doit être consistant avec sa source
 * et avec les ressources qu'il référence (template, presets, prompts).
 *
 * Règles couvertes (cf. plan Cohérence Workflows §C1-C5, C10) :
 *   C1 : coverMode=auto → coverConfig.coverPresetName requis
 *   C2 : coverConfig.coverPresetName → doit exister sur template.coverPresets
 *   C3 : needsCaptions=true → captionPresetId requis
 *   C4 : needsDescription="autoGenerate" → descriptionPromptId requis
 *   C5 : source="auto_template" → templateId requis
 *   C10 : allowsClientRevision=true → needsClientValidation=true
 *
 * Utilisé :
 *   - Form `AccountPatternForm` (validation client : onChange = warning inline,
 *     onSubmit = bloquant rouge)
 *   - Routes API POST/PATCH `/api/admin/accounts/[id]/patterns[...]` : 422 si KO
 *   - Liste patterns : helper `detectOrphanedPatternConfig` pour badge "config invalide"
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Erreur de validation : code stable + message FR + field cible (clé du form). */
export interface PatternValidationError {
  field: string;
  code:
    | "MISSING_COVER_PRESET_NAME"
    | "COVER_PRESET_NOT_FOUND"
    | "MISSING_CAPTION_PRESET"
    | "MISSING_DESCRIPTION_PROMPT"
    | "MISSING_TEMPLATE"
    | "ALLOWS_REVISION_WITHOUT_VALIDATION";
  message: string;
}

/** Subset des champs pattern nécessaires à la validation. */
export interface PatternValidationInput {
  source: string;
  templateId: string | null;
  coverMode: string;
  /** Objet ou JSON string représentant coverConfig (forme : { enabled?, coverPresetName? }). */
  coverConfig: unknown;
  needsCaptions: boolean;
  needsDescription: string;
  /** Phase 2.3 — validation admin du montage. Optionnel pour back-compat. */
  needsAdminValidation?: boolean;
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  captionPresetId: string | null;
  descriptionPromptId: string | null;
}

/** Context du template référencé (pour valider que le preset cover existe). */
export interface TemplateValidationContext {
  /** Liste des noms de TemplateCoverPreset définis sur le template courant. */
  coverPresetNames: string[];
  /**
   * Liste des IDs (Phase 3) — utilisée pour valider la nouvelle référence
   * stable coverPresetId. Optionnel pour back-compat des callers existants.
   */
  coverPresetIds?: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface CoverConfigRefs {
  /** ID stable (Phase 3 Cohérence Workflows) — priorité sur le nom. */
  coverPresetId: string | null;
  /** Nom legacy — conservé pour le fallback transitoire pendant la migration. */
  coverPresetName: string | null;
}

function readCoverPresetRefs(coverConfig: unknown): CoverConfigRefs {
  const empty: CoverConfigRefs = { coverPresetId: null, coverPresetName: null };
  if (!coverConfig) return empty;
  // coverConfig peut être un objet déjà parsé (form) ou un JSON string (Prisma raw)
  type ParsedCoverConfig = { coverPresetId?: unknown; coverPresetName?: unknown };
  let obj: ParsedCoverConfig | null = null;
  if (typeof coverConfig === "string") {
    try {
      obj = JSON.parse(coverConfig) as ParsedCoverConfig;
    } catch {
      return empty;
    }
  } else if (typeof coverConfig === "object") {
    obj = coverConfig as ParsedCoverConfig;
  }
  if (!obj) return empty;
  return {
    coverPresetId:
      typeof obj.coverPresetId === "string" && obj.coverPresetId.trim()
        ? obj.coverPresetId.trim()
        : null,
    coverPresetName:
      typeof obj.coverPresetName === "string" && obj.coverPresetName.trim()
        ? obj.coverPresetName.trim()
        : null,
  };
}

// ─── validatePatternConfig ────────────────────────────────────────────────────

/**
 * Valide la cohérence d'un pattern. Retourne le tableau (possiblement vide)
 * des erreurs détectées. `[]` = pattern valide.
 *
 * `template` peut être null si on n'a pas pu charger le template (ex: templateId
 * absent ou template supprimé) — dans ce cas la règle C2 ne peut pas vérifier
 * l'existence du preset et on log seulement les règles indépendantes du template.
 */
export function validatePatternConfig(
  input: PatternValidationInput,
  template: TemplateValidationContext | null,
): PatternValidationError[] {
  const errors: PatternValidationError[] = [];

  // C5 : source=auto_template → templateId requis
  if (input.source === "auto_template" && !input.templateId) {
    errors.push({
      field: "templateId",
      code: "MISSING_TEMPLATE",
      message: "Un template est requis pour la source « auto_template ».",
    });
  }

  // C1 : coverMode=auto → référence preset requise (par ID en priorité, fallback nom)
  if (input.coverMode === "auto") {
    const refs = readCoverPresetRefs(input.coverConfig);
    if (!refs.coverPresetId && !refs.coverPresetName) {
      errors.push({
        field: "coverConfig",
        code: "MISSING_COVER_PRESET_NAME",
        message:
          "Le mode cover « auto » nécessite un preset cover défini dans le template.",
      });
    } else if (template) {
      // C2 : le preset référencé doit exister sur le template (par ID ou nom)
      const existsById =
        refs.coverPresetId && template.coverPresetIds
          ? template.coverPresetIds.includes(refs.coverPresetId)
          : false;
      const existsByName =
        refs.coverPresetName
          ? template.coverPresetNames.includes(refs.coverPresetName)
          : false;
      if (!existsById && !existsByName) {
        const refLabel = refs.coverPresetId
          ? `(id=${refs.coverPresetId})`
          : `« ${refs.coverPresetName} »`;
        errors.push({
          field: "coverConfig",
          code: "COVER_PRESET_NOT_FOUND",
          message: `Le preset cover ${refLabel} n'existe plus sur le template lié. Choisissez-en un autre ou recréez-le dans le builder.`,
        });
      }
    }
  }

  // C3 : needsCaptions=true → captionPresetId requis
  if (input.needsCaptions && !input.captionPresetId) {
    errors.push({
      field: "captionPresetId",
      code: "MISSING_CAPTION_PRESET",
      message:
        "L'activation des sous-titres automatiques nécessite un preset de sous-titres.",
    });
  }

  // C4 : needsDescription=autoGenerate → descriptionPromptId requis
  if (input.needsDescription === "autoGenerate" && !input.descriptionPromptId) {
    errors.push({
      field: "descriptionPromptId",
      code: "MISSING_DESCRIPTION_PROMPT",
      message:
        "La génération automatique de description nécessite un prompt IA.",
    });
  }

  // C10 : allowsClientRevision=true → needsClientValidation=true
  if (input.allowsClientRevision && !input.needsClientValidation) {
    errors.push({
      field: "allowsClientRevision",
      code: "ALLOWS_REVISION_WITHOUT_VALIDATION",
      message:
        "Les révisions client ne peuvent être activées que si la validation client est requise.",
    });
  }

  return errors;
}

// ─── detectOrphanedPatternConfig ──────────────────────────────────────────────

/**
 * Variante "lecture seule" pour la liste des patterns : ne vérifie QUE les
 * références qui peuvent devenir orphelines après la création du pattern
 * (preset cover supprimé, FK SetNull sur captionPresetId, etc.).
 *
 * Utilisée pour afficher un badge "config invalide" sur la card sans bloquer
 * l'admin qui consulte la liste.
 *
 * Renvoie `null` si tout va bien, ou un résumé `{ count, codes }` sinon.
 */
export function detectOrphanedPatternConfig(
  input: PatternValidationInput,
  template: TemplateValidationContext | null,
): { count: number; codes: PatternValidationError["code"][] } | null {
  const errors = validatePatternConfig(input, template);
  if (errors.length === 0) return null;
  return {
    count: errors.length,
    codes: errors.map((e) => e.code),
  };
}
