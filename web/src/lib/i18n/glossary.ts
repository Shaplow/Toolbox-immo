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
 * dans chaque composant — tout passe par ce module. Les `*Options()` ci-dessous
 * renvoient des `{value,label}[]` prêts pour Combobox/Select ; ne redéclare
 * pas de tableau d'options local à côté de ces enums.
 */

import { COVER_MODE_VALUES } from "@/lib/publications/coverMode";
import { CAPTIONS_MODE_LABELS_FR as CAPTIONS_MODE_LABELS_FR_TYPED } from "@/lib/publications/captionsMode";

export interface GlossaryOption {
  value: string;
  label: string;
}

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

/** PatternTemplate.source → options prêtes pour Combobox/Select. */
export function sourceOptions(): GlossaryOption[] {
  return Object.keys(SOURCE_LABELS_FR).map((value) => ({
    value,
    label: SOURCE_LABELS_FR[value],
  }));
}

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

/**
 * PatternTemplate.coverMode → options prêtes pour Combobox/Select. Dérivées
 * de `COVER_MODE_VALUES` (source de vérité des valeurs valides) : exclut de
 * fait l'alias legacy "auto" de `COVER_MODE_LABELS_FR`.
 */
export function coverModeOptions(): GlossaryOption[] {
  return COVER_MODE_VALUES.map((value) => ({
    value,
    label: COVER_MODE_LABELS_FR[value] ?? value,
  }));
}

/** Idem, avec l'option "hérite de la recette" en tête (overrides de binding). */
export function coverModeOverrideOptions(): GlossaryOption[] {
  return [{ value: "", label: "Hérite de la recette" }, ...coverModeOptions()];
}

// ───────────────────────────────────────────────────────────────────────────
// PatternTemplate.needsDescription
// ───────────────────────────────────────────────────────────────────────────

export const NEEDS_DESCRIPTION_LABELS_FR: Record<string, string> = {
  none: "Aucune",
  manualWrite: "Manuelle",
  preFilled: "Pré-remplie par fiche",
  fixed: "Texte fixe",
  autoGenerate: "Auto-générée",
};

// ───────────────────────────────────────────────────────────────────────────
// PatternTemplate.needsCaptionsMode (V8 — remplace le Boolean needsCaptions)
// ───────────────────────────────────────────────────────────────────────────
//
// Labels ré-exportés depuis lib/publications/captionsMode.ts (source unique,
// version typée sur `CaptionsMode`) — ne pas redéclarer ici. `CAPTIONS_MODE_HELP`
// était dupliqué à l'identique dans les deux fichiers ; la version de
// captionsMode.ts est la seule qui reste (import direct, pas de re-export :
// aucun composant ne la consommait via ce module).

export const CAPTIONS_MODE_LABELS_FR: Record<string, string> = CAPTIONS_MODE_LABELS_FR_TYPED;

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
