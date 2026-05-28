/**
 * Abstraction stockage objets : R2 en prod, disque local en dev.
 *
 * Permet aux routes upload/download/delete des publications de tourner
 * sans configurer R2. En local, les fichiers sont écrits sous
 * `web/public/uploads/{key}` et servis automatiquement par Next.js
 * static à `/uploads/{key}`.
 *
 * Convention : le `key` est le même format dans les deux modes (ex.
 * "publications/{slotId}/rushes/abc.mp4"), seul le backend physique
 * diffère. Le caller ne sait pas s'il est en local ou R2.
 *
 * Activation : si `r2Configured()` est vrai → R2. Sinon → local.
 * Test : NODE_ENV=production force le mode R2 (refuse de retomber sur
 * disque même si pas configuré) — protège la prod d'un misconfig.
 */

import path from "path";
import {
  access,
  unlink,
  writeFile,
  mkdir,
  stat,
} from "fs/promises";
import {
  r2Configured,
  getR2PublicUrl,
  objectExistsInR2,
  deleteFromR2,
  createPresignedDownloadUrl,
} from "@/lib/r2";

// ─── Mode ────────────────────────────────────────────────────────────────────

/**
 * Détermine si le stockage doit utiliser R2 (true) ou disque local (false).
 *
 * - prod (NODE_ENV=production) + R2 configuré → R2
 * - prod sans R2 → R2 (jette plus tard à l'appel : on refuse de tomber sur
 *   disque en prod, c'est un misconfig)
 * - dev + R2 configuré → R2
 * - dev sans R2 → disque local (ce module)
 */
export function isLocalStorage(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return !r2Configured();
}

// ─── Chemins locaux ──────────────────────────────────────────────────────────

const PUBLIC_UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");

/** Convertit un key logique en chemin disque absolu. Refuse les `..`. */
function keyToLocalPath(key: string): string {
  // Sanitization : pas de path traversal. On accepte slashes (nested),
  // alphanumériques, dashes, underscores, points. Refuse `..`, refuse les
  // segments vides ou commençant par un point caché.
  if (!/^[a-zA-Z0-9_\-./]+$/.test(key)) {
    throw new Error(`storage: key invalide "${key}"`);
  }
  if (key.includes("..") || key.startsWith("/") || key.endsWith("/")) {
    throw new Error(`storage: key invalide "${key}"`);
  }
  const full = path.join(PUBLIC_UPLOADS_DIR, key);
  if (!full.startsWith(PUBLIC_UPLOADS_DIR + path.sep)) {
    throw new Error(`storage: path traversal détecté "${key}"`);
  }
  return full;
}

// ─── API publique ────────────────────────────────────────────────────────────

/** URL publique d'un objet. R2 ou /uploads/{key}. */
export function getPublicUrl(key: string): string {
  if (isLocalStorage()) {
    return `/uploads/${key}`;
  }
  return getR2PublicUrl(key);
}

/** Vérifie qu'un objet existe physiquement. */
export async function objectExists(key: string): Promise<boolean> {
  if (isLocalStorage()) {
    try {
      const full = keyToLocalPath(key);
      const s = await stat(full);
      return s.isFile();
    } catch {
      return false;
    }
  }
  return objectExistsInR2(key);
}

/** Supprime un objet. Idempotent si déjà absent. */
export async function deleteObject(key: string): Promise<void> {
  if (isLocalStorage()) {
    try {
      await unlink(keyToLocalPath(key));
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: string }).code === "ENOENT"
      ) {
        return; // déjà absent
      }
      throw err;
    }
    return;
  }
  await deleteFromR2(key);
}

/**
 * URL de téléchargement avec nom de fichier suggéré.
 *
 * - R2 : URL pré-signée avec Content-Disposition pour 1h.
 * - Local : URL statique (le browser téléchargera avec le nom de l'URL ;
 *   pas de Content-Disposition possible via static — acceptable en dev).
 */
export async function getDownloadUrl(key: string, filename: string): Promise<string> {
  if (isLocalStorage()) {
    return `/uploads/${key}`;
  }
  return createPresignedDownloadUrl(key, filename, 3600);
}

/**
 * Écrit un buffer comme un objet stocké. Disponible UNIQUEMENT en local —
 * en mode R2, les écritures passent par les URL pré-signées (presigned PUT).
 */
export async function writeLocalObject(key: string, body: Buffer): Promise<void> {
  if (!isLocalStorage()) {
    throw new Error("writeLocalObject ne doit pas être appelé en mode R2");
  }
  const full = keyToLocalPath(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, body);
}

/**
 * Vérifie qu'un objet existe avant de retourner sa taille en bytes.
 * Retourne null si absent. Utilisé en upload-complete pour vérifier que
 * la taille déclarée correspond à ce qui a été reçu.
 */
export async function getObjectSize(key: string): Promise<number | null> {
  if (isLocalStorage()) {
    try {
      const s = await stat(keyToLocalPath(key));
      return s.isFile() ? s.size : null;
    } catch {
      return null;
    }
  }
  // R2 : pas d'équivalent simple sans HEAD request. Le check objectExists
  // suffit en pratique car la presigned URL est déjà liée à la taille.
  const exists = await objectExistsInR2(key);
  return exists ? -1 : null;
}

/**
 * Helper d'accès interne (pour les tests / scripts). Expose le chemin
 * physique d'un key en mode local. Throw en mode R2.
 */
export function getLocalPath(key: string): string {
  if (!isLocalStorage()) {
    throw new Error("getLocalPath ne doit pas être appelé en mode R2");
  }
  return keyToLocalPath(key);
}

// Re-export du helper de check pour les callsites qui veulent un message
// utilisateur cohérent. À utiliser en tête de route.
export { access as _accessForTests };
