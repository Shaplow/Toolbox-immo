/**
 * Helpers de génération de clés R2 pour les uploads publications.
 *
 * Convention des préfixes :
 *   publications/{slotId}/rushes/{ts}-{rand}.{ext}
 *   publications/{slotId}/versions/v{versionNumber}-{ts}.{ext}
 *   publications/{slotId}/brief/{ts}-{rand}.{ext}
 *
 * Les filenames sont sanitisés (alphanumeric + point, le reste → tiret).
 * Les extensions originales sont préservées (minuscule).
 */

// ─── Sanitization ─────────────────────────────────────────────────────────────

/**
 * Sanitize un nom de fichier :
 * - Extrait l'extension (conservée en minuscule).
 * - Remplace tout caractère non alphanumérique (sauf point et tiret) par un tiret.
 * - Supprime les tirets consécutifs et les tirets de début/fin dans le stem.
 */
export function sanitizeFilename(filename: string): { stem: string; ext: string } {
  const lastDot = filename.lastIndexOf(".");
  const rawStem = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  const rawExt = lastDot > 0 ? filename.slice(lastDot + 1) : "";

  const stem = rawStem
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    || "file";

  const ext = rawExt.toLowerCase().replace(/[^a-zA-Z0-9]/g, "") || "bin";

  return { stem, ext };
}

// ─── Générateurs de tokens ────────────────────────────────────────────────────

function timestamp(): string {
  return Date.now().toString(36);
}

function randomToken(): string {
  return Math.random().toString(36).slice(2, 8);
}

// ─── Clés R2 ──────────────────────────────────────────────────────────────────

/**
 * Clé R2 pour un rush (vidéo ou photo immo).
 *
 * Pattern : publications/{slotId}/rushes/{ts}-{rand}.{ext}
 */
export function rushKey(slotId: string, filename: string): string {
  const { ext } = sanitizeFilename(filename);
  return `publications/${slotId}/rushes/${timestamp()}-${randomToken()}.${ext}`;
}

/**
 * Clé R2 pour un rush d'ÉVÉNEMENT de tournage (lot partagé du shoot).
 *
 * Pattern : shoot-events/{eventId}/rushes/{ts}-{rand}.{ext}
 * Préfixe distinct de `publications/…` : sert de garde anti cross-scope dans
 * l'upload-complete (un rush event ne peut pas pointer vers une clé de slot).
 */
export function eventRushKey(eventId: string, filename: string): string {
  const { ext } = sanitizeFilename(filename);
  return `shoot-events/${eventId}/rushes/${timestamp()}-${randomToken()}.${ext}`;
}

/**
 * Clé R2 pour une version de montage.
 *
 * Pattern : publications/{slotId}/versions/v{versionNumber}-{ts}-{rand}.{ext}
 * Note : le numéro de version est calculé en DB (lors de l'upload-complete) ;
 * la clé garde le numéro temporaire (généralement 0) du presign. Le random
 * token est obligatoire pour éviter deux uploads concurrents qui tomberaient
 * dans la même milliseconde — sans lui, le 2ème PUT écrasait silencieusement
 * le 1er sur R2 alors que les deux PublicationVersion DB existent (avec
 * versionNumber différents mais r2Key identique).
 */
export function versionKey(
  slotId: string,
  versionNumber: number,
  filename: string
): string {
  const { ext } = sanitizeFilename(filename);
  return `publications/${slotId}/versions/v${versionNumber}-${timestamp()}-${randomToken()}.${ext}`;
}

/**
 * Clé R2 pour une pièce jointe de brief (PDF, image).
 *
 * Pattern : publications/{slotId}/brief/{ts}-{rand}.{ext}
 */
export function briefAttachmentKey(slotId: string, filename: string): string {
  const { ext } = sanitizeFilename(filename);
  return `publications/${slotId}/brief/${timestamp()}-${randomToken()}.${ext}`;
}
