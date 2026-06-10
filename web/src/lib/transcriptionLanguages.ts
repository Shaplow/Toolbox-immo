/**
 * Helpers de validation des codes langue pour TranscriptionJob.
 *
 * Centralise les règles partagées entre les routes :
 *   - POST /api/transcription
 *   - PATCH /api/transcription/[id]
 *
 * En extrayant ces helpers, on garantit que les deux routes appliquent
 * exactement les mêmes règles (rejet "auto", dédup, casing).
 */

export const ALLOWED_LANGUAGE_RE = /^[a-z]{2,3}$|^auto$/;
export const STRICT_ISO_RE = /^[a-z]{2,3}$/;

export function sanitizeLanguage(value: unknown, fallback = "fr"): string {
  const s = String(value ?? fallback).trim().toLowerCase();
  return ALLOWED_LANGUAGE_RE.test(s) ? s : fallback;
}

/**
 * Mode multi-langue. Accepte un array (ou une chaîne CSV "fr,zh"), ne garde
 * que les codes ISO 2-3 lettres uniques, exclut "auto" et tout invalide.
 *
 * Retourne `[]` si moins de 2 codes valides après normalisation — dans ce cas
 * l'appelant doit retomber sur le mode mono-langue (`language`).
 */
export function sanitizeLanguages(value: unknown): string[] {
  let raw: unknown[];
  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === "string" && value.trim()) {
    raw = value.split(",");
  } else {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const code = String(item ?? "").trim().toLowerCase();
    if (!code || code === "auto" || !STRICT_ISO_RE.test(code)) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out.length >= 2 ? out : [];
}
