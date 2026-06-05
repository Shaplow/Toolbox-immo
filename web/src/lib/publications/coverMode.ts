/**
 * Cover mode — source de vérité unique pour les valeurs enum et l'extraction
 * du coverPresetId depuis Pattern.coverConfig (champ JSON opaque).
 *
 * Avant la consolidation : `VALID_COVER_MODES` était dupliqué dans 2 routes
 * patterns admin + comparaison `=== "auto"` (valeur jamais atteinte, dead
 * guard) dans slotService.createSlot/patchSlot. Extraction du coverPresetId
 * répliquée verbatim dans 3 lieux avec 3 guards subtilement différents.
 */

export const COVER_MODE_VALUES = [
  "none",
  "manualSelect",
  "autoPack",
  "monteurUpload",
] as const;

export type CoverMode = (typeof COVER_MODE_VALUES)[number];

export function isCoverMode(value: unknown): value is CoverMode {
  return typeof value === "string" && (COVER_MODE_VALUES as readonly string[]).includes(value);
}

/**
 * Extrait `coverPresetId` du champ JSON `Pattern.coverConfig`.
 *
 * Forme attendue : `{ coverPresetId?: string; coverPresetName?: string; enabled?: boolean; ... }`.
 * Tolère null, undefined, arrays, primitifs — retourne null dans tous ces cas.
 */
export function getCoverPresetIdFromConfig(coverConfig: unknown): string | null {
  if (!coverConfig || typeof coverConfig !== "object" || Array.isArray(coverConfig)) {
    return null;
  }
  const presetId = (coverConfig as { coverPresetId?: unknown }).coverPresetId;
  return typeof presetId === "string" && presetId.length > 0 ? presetId : null;
}
