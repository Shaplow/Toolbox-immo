/**
 * Ligne de `GET /api/templates/[id]/usage` — les recettes qui utilisent un
 * template builder. Source unique du type (avant V1 : redéclaré localement
 * dans CoverTabPanel et CaptionsTabPanel avec des champs divergents).
 *
 * `id` est ambigu par construction : la route émet une ligne par binding
 * (id = PatternBinding.id) et une ligne « globale » pour les recettes
 * catalogue sans binding (id = PatternTemplate.id). Toujours discriminer
 * via `kind` avant de router un id vers une API.
 */
export interface TemplateUsagePattern {
  /** "binding" = recette appliquée à un compte ; "template" = recette catalogue sans binding. */
  kind: "template" | "binding";
  id: string;
  label: string;
  isActive: boolean;
  /** "" pour une recette globale (pas de compte). */
  accountId: string;
  /** Handle du compte, ou "recette globale". */
  accountHandle: string;
  accountName: string | null;
  captionPresetId: string | null;
  /** Résolu depuis coverConfig.coverPresetName. */
  coverPresetName: string | null;
  coverEnabled: boolean;
}
