/**
 * Enums de recette (PatternTemplate / PatternBinding) — source unique (V2.7).
 *
 * Avant : VALID_SOURCES / VALID_CAPTIONS_MODES / VALID_DESCRIPTION_MODES /
 * VALID_COVER_MODES / PUBLISH_TIME_RE redéclarés dans 9 fichiers (routes
 * patterns, recipes, bindings, slotService, deployTemplate). Une valeur
 * ajoutée dans une copie et pas les autres = validation divergente selon la
 * route utilisée.
 *
 * Les labels FR de ces enums vivent dans lib/i18n/glossary.ts ; les cover
 * modes détaillés (type guard + extraction preset) dans
 * lib/publications/coverMode.ts.
 */
import { COVER_MODE_VALUES } from "@/lib/publications/coverMode";

export const VALID_SOURCES: readonly string[] = [
  "auto_template",
  "manual_rushes",
  "external_upload",
];

export const VALID_CAPTIONS_MODES: readonly string[] = ["none", "auto", "manual"];

export const VALID_DESCRIPTION_MODES: readonly string[] = [
  "none",
  "preFilled",
  "fixed",
  "autoGenerate",
  "manualWrite",
];

/** Alias — la source canonique est coverMode.ts (type guard + helpers). */
export const VALID_COVER_MODES: readonly string[] = COVER_MODE_VALUES;

/** "HH:MM" 00:00 → 23:59 (heure à 1 ou 2 chiffres). */
export const PUBLISH_TIME_RE = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
