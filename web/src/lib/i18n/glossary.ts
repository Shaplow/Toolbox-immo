/**
 * Glossaire FR — UI uniquement. (Ex-entityLabels.ts, renommé V1 17/08 pour
 * éviter la collision avec le modèle Prisma `Entity` / les « Fiches ».)
 *
 * Source unique pour les enums métier de `PatternTemplate` (source, coverMode,
 * needsDescription, needsCaptionsMode) et la portée d'usage des bibliothèques.
 *
 * Le code (Prisma, types, services) garde les noms originaux : PatternTemplate,
 * PatternBinding, PublicationSlot, MediaLibrary. L'UI parle français cohérent.
 *
 * Règle : un terme = un mot. Pas de "Slot" + "Publication" + "PublicationSlot"
 * dans la même page selon l'humeur. Pas de SOURCE_LABEL redéclaré localement
 * dans chaque composant — tout passe par ce module.
 */

// ───────────────────────────────────────────────────────────────────────────
// PatternTemplate.source — labels + help + chip color
// ───────────────────────────────────────────────────────────────────────────

/** Source enum PatternTemplate.source → label FR. */
export const SOURCE_LABELS_FR: Record<string, string> = {
  auto_template: "Template auto",
  manual_rushes: "Montage rushes",
  external_upload: "Upload externe",
};

/** Source enum PatternTemplate.source → aide contextuelle (forms admin). */
export const SOURCE_HELP: Record<string, string> = {
  auto_template:
    "Le rendu vidéo est généré automatiquement depuis un template lié à la recette. Pas de rushes vidéaste à attendre.",
  manual_rushes:
    "Le vidéaste uploade les rushes, le monteur livre une version finale. Active la section Rushes du pipeline.",
  external_upload:
    "Le client uploade directement sa vidéo finale. Pas de rushes, pas de montage interne.",
};

/** Source enum PatternTemplate.source → variante de Chip (couleur). */
export const SOURCE_VARIANT: Record<string, "default" | "sky" | "peach" | "sage"> = {
  auto_template: "sky",
  manual_rushes: "peach",
  external_upload: "sage",
};

// ───────────────────────────────────────────────────────────────────────────
// PatternTemplate.coverMode
// ───────────────────────────────────────────────────────────────────────────

export const COVER_MODE_LABELS_FR: Record<string, string> = {
  none: "Pas de cover",
  manualSelect: "Sélection libre",
  autoPack: "Pack auto → choix CM",
  monteurUpload: "Upload par le monteur",
  // Alias legacy
  auto: "Pack auto → choix CM",
};

// ───────────────────────────────────────────────────────────────────────────
// PatternTemplate.needsDescription
// ───────────────────────────────────────────────────────────────────────────

export const NEEDS_DESCRIPTION_LABELS_FR: Record<string, string> = {
  none: "Aucune",
  manualWrite: "Manuelle",
  preFilled: "Pré-remplie par bien",
  fixed: "Texte fixe",
  autoGenerate: "Auto-générée",
};

// ───────────────────────────────────────────────────────────────────────────
// PatternTemplate.needsCaptionsMode (V8 — remplace le Boolean needsCaptions)
// ───────────────────────────────────────────────────────────────────────────

export const CAPTIONS_MODE_LABELS_FR: Record<string, string> = {
  none: "Aucun sous-titre",
  auto: "Auto (preset + IA)",
  manual: "Manuel (écrits à la main)",
};

export const CAPTIONS_MODE_HELP: Record<string, string> = {
  none: "Pas de sous-titres sur la vidéo finale.",
  auto:
    "Transcription Whisper + burn-in via preset captions. Le pipeline déclenche tout automatiquement après le rendu.",
  manual:
    "L'éditeur écrit les sous-titres à la main dans l'app (pas de burn-in vidéo, juste un SRT stocké sur le slot).",
};

// ───────────────────────────────────────────────────────────────────────────
// MediaLibrary/DataLibrary.rotationScope — portée du tirage par dossier
// ───────────────────────────────────────────────────────────────────────────
//
// Source unique : avant, "shared"/"per_account" étaient traduits localement de
// 5 façons différentes (dont "Per-account" en anglais brut). Tout passe ici.

const ROTATION_SCOPE_LABELS: Record<string, string> = {
  shared: "Partagé (global)",
  per_account: "Indépendant par compte",
};

export function rotationScopeLabel(scope: string | null | undefined): string {
  if (!scope) return "Indépendant par compte";
  return ROTATION_SCOPE_LABELS[scope] ?? scope;
}
