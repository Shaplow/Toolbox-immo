/**
 * Utility functions for CaptionsGenerateForm and related captions UI.
 *
 * Phase F3-step1 du plan recentré. Extraction des fonctions pures sans
 * state (formatters, parsers, nested object access) — premier pas du
 * split de CaptionsGenerateForm (1283 LOC).
 */

import type { AutoHighlightMode, AutoHighlightPlacement } from "@/lib/captionPrompt";

/**
 * Format ISO date pour affichage dans les listes de captions/jobs.
 * Locale fr-FR, format compact "12 mars 14:30".
 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Convertit un timestamp SRT en secondes. Accepte "HH:MM:SS,mmm" ou
 * "HH:MM:SS.mmm" (les deux séparateurs sont communs dans la nature).
 */
export function srtTimeToSeconds(t: string): number {
  const m = t.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

/**
 * Label court pour le mode d'auto-highlight d'un preset captions.
 * "highlight1" → "HL1", "highlight2" → "HL2", autre → "HL1 + HL2".
 */
export function formatAutoHighlightModeLabel(mode: AutoHighlightMode): string {
  if (mode === "highlight1") return "HL1";
  if (mode === "highlight2") return "HL2";
  return "HL1 + HL2";
}

/**
 * Label pour le placement de l'auto-highlight relativement au prompt.
 * "before" → "avant le prompt", "after" → "après le prompt".
 */
export function formatAutoHighlightPlacementLabel(placement: AutoHighlightPlacement): string {
  return placement === "before" ? "avant le prompt" : "après le prompt";
}

/**
 * Accès nested safe à un objet via chemin de keys. Retourne undefined
 * si la chaîne casse à n'importe quel niveau ou si la valeur n'est pas
 * un object. Utilisé pour lire des configs JSON dynamiques.
 */
export function nested(obj: Record<string, unknown>, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[k];
    else return undefined;
  }
  return cur;
}
