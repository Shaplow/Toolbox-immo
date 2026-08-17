/**
 * Source de vérité unique du mode de rotation d'une `MediaLibrary` / `DataLibrary`.
 *
 * Plan simplification 2026-08 : le mode `override` (séquence ordonnée +
 * curseur) est décommissionné — il ne reste que deux modes :
 *   - `"auto"` : tirage « dossier simple » (least-recently-used, sans état) ;
 *   - `"none"` : pas de tirage — sélection par champ metadata ou manuelle.
 *
 * Les valeurs legacy (`"override"`, `null`) sont normalisées en `"auto"` à la
 * lecture ; la migration SQL de la phase 3 normalise les données en base.
 */

export type RotationMode = "auto" | "none";

export type RotationModeSource = {
  /** Colonne `rotationMode`. `null` / `"override"` = legacy, lus comme `"auto"`. */
  rotationMode: string | null;
};

export type ResolvedRotation = {
  mode: RotationMode;
};

/** Résout le mode effectif : `"none"` reste `none`, tout le reste = `auto`. */
export function resolveRotationMode(
  lib: RotationModeSource,
  _warnContext?: string,
): ResolvedRotation {
  return { mode: lib.rotationMode === "none" ? "none" : "auto" };
}

/** Mode déclaré — identique au mode résolu depuis la suppression d'override. */
export function declaredRotationMode(lib: RotationModeSource): RotationMode {
  return lib.rotationMode === "none" ? "none" : "auto";
}
