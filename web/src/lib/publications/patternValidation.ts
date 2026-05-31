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
    | "MONTEUR_UPLOAD_REQUIRES_MANUAL_RUSHES"
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
  /** @deprecated V8 — utiliser needsCaptionsMode. */
  needsCaptions: boolean;
  /** V8 — "none" | "auto" | "manual". Auto exige captionPresetId. Manuel non. */
  needsCaptionsMode?: string | null;
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

  // C6 (Phase 2.5) : coverMode=monteurUpload → source doit être manual_rushes
  // (sinon il n'y a pas de phase montage donc personne pour uploader la cover).
  if (input.coverMode === "monteurUpload" && input.source !== "manual_rushes") {
    errors.push({
      field: "coverMode",
      code: "MONTEUR_UPLOAD_REQUIRES_MANUAL_RUSHES",
      message:
        "Le mode « Upload par le monteur » nécessite une source manual_rushes " +
        "(le monteur livre la cover avec son montage).",
    });
  }

  // C1 (Phase 2.6) : coverMode=autoPack → template doit avoir au moins une
  // config cover (preset par défaut). On ne demande plus de référence par nom
  // côté pattern — c'est toujours le preset sortOrder min qui sert.
  // Si pas de template chargé (cas race condition), on skip silencieusement.
  if (input.coverMode === "autoPack" && template && template.coverPresetNames.length === 0) {
    errors.push({
      field: "coverConfig",
      code: "MISSING_COVER_PRESET_NAME",
      message:
        "Le mode cover « auto » nécessite une config cover dans le template. Ouvre le builder → onglet « Cover auto » pour l'activer.",
    });
  }

  // C3 : needsCaptionsMode="auto" → captionPresetId requis.
  // V8.2.2 — Le mode "manual" n'a pas besoin de preset (édition à la main
  // via CaptionEditor). Fallback compat : needsCaptions=true sans mode défini
  // = ancien comportement = exige preset.
  const captionsMode =
    input.needsCaptionsMode ?? (input.needsCaptions ? "auto" : "none");
  if (captionsMode === "auto" && !input.captionPresetId) {
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
