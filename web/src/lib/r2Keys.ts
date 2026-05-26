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
 * Clé R2 pour une version de montage.
 *
 * Pattern : publications/{slotId}/versions/v{versionNumber}-{ts}.{ext}
 * Note : le numéro de version est calculé en DB (lors de l'upload-complete),
 * mais la clé est générée à l'upload-presign avec un numéro temporaire basé
 * sur le timestamp — le numéro définitif sera fixé lors de l'insert Prisma.
 */
export function versionKey(
  slotId: string,
  versionNumber: number,
  filename: string
): string {
  const { ext } = sanitizeFilename(filename);
  return `publications/${slotId}/versions/v${versionNumber}-${timestamp()}.${ext}`;
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
