/**
 * captionsMode.ts — Helpers V8 pour résoudre le mode captions effectif.
 *
 * Avant V8 : `pattern.needsCaptions: Boolean` (true = auto via preset,
 * false = rien). Pas de mode "manuel".
 *
 * Désormais : `pattern.needsCaptionsMode: "none" | "auto" | "manual"` +
 * override `slot.needsCaptionsModeOverride`. Le mode "manual" ouvre
 * CaptionEditor dans la fiche pub pour saisir des sous-titres à la main.
 *
 * Colonnes Boolean `needsCaptions` / `needsCaptionsOverride` : mortes (V2.3,
 * backfill final 20260817190000) — drop en N+1, plus aucune lecture/écriture.
 */

export type CaptionsMode = "none" | "auto" | "manual";

/**
 * Normalise une chaîne arbitraire en CaptionsMode valide.
 * Sécurité : si la DB renvoie une valeur invalide (bug, ancienne donnée),
 * on retombe sur "none" plutôt que de casser le pipeline.
 */
export function normalizeCaptionsMode(raw: string | null | undefined): CaptionsMode {
  if (raw === "auto" || raw === "manual" || raw === "none") return raw;
  return "none";
}

/**
 * Résout le mode captions effectif pour un slot donné en respectant
 * l'override per-slot si défini.
 *
 * Ordre de priorité :
 * 1. slot.needsCaptionsModeOverride (si non-null)
 * 2. pattern.needsCaptionsMode
 * 3. Fallback "none" si pas de pattern
 *
 * Fallback compat Boolean : si `needsCaptionsMode` est null/absent mais
 * que `needsCaptions: Boolean` existe (ancien code pas encore migré),
 * on lit le Boolean. Garantit zéro régression pendant la transition.
 */
export function resolveCaptionsMode(input: {
  slot?: { needsCaptionsModeOverride?: string | null } | null;
  pattern?: { needsCaptionsMode?: string | null } | null;
}): CaptionsMode {
  // 1) Override per-slot prioritaire
  if (input.slot?.needsCaptionsModeOverride != null) {
    return normalizeCaptionsMode(input.slot.needsCaptionsModeOverride);
  }
  // 2) Mode du pattern
  if (input.pattern?.needsCaptionsMode != null) {
    return normalizeCaptionsMode(input.pattern.needsCaptionsMode);
  }
  return "none";
}

// ── Predicates ─────────────────────────────────────────────────────────────

export function isCaptionsEnabled(mode: CaptionsMode): boolean {
  return mode !== "none";
}

export function isCaptionsAuto(mode: CaptionsMode): boolean {
  return mode === "auto";
}

export function isCaptionsManual(mode: CaptionsMode): boolean {
  return mode === "manual";
}

// ── Labels FR (pour UI Combobox V8.2.3) ───────────────────────────────────

export const CAPTIONS_MODE_LABELS_FR: Record<CaptionsMode, string> = {
  none: "Aucun sous-titre",
  auto: "Auto (preset + IA)",
  manual: "Manuel (écrire à la main)",
};

export const CAPTIONS_MODE_HELP: Record<CaptionsMode, string> = {
  none: "Pas de sous-titres pour ce pattern.",
  auto: "Transcription Whisper + génération via preset captions + burn-in vidéo.",
  manual: "Le CM saisit les sous-titres à la main via CaptionEditor depuis la fiche.",
};
