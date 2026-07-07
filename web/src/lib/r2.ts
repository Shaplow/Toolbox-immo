/**
 * Cloudflare R2 client — compatible AWS S3
 *
 * Variables d'environnement requises :
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL
 *
 * Usage :
 *   import { uploadToR2, getR2PublicUrl, r2Configured } from "@/lib/r2"
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";

// ─── Configuration ────────────────────────────────────────────────────────────

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicUrl = process.env.R2_PUBLIC_URL;

  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl };
}

/** Retourne true si R2 est configuré (toutes les vars d'env présentes). */
export function r2Configured(): boolean {
  const { accountId, accessKeyId, secretAccessKey, bucket, publicUrl } =
    getR2Config();
  return !!(accountId && accessKeyId && secretAccessKey && bucket && publicUrl);
}

/** Lance une erreur si R2 n'est pas configuré. */
export function requireR2(): void {
  if (!r2Configured()) {
    throw new Error(
      "R2 non configuré. Renseigner les variables d'environnement : " +
        "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL"
    );
  }
}

// ─── Retry helper ─────────────────────────────────────────────────────────────

const RETRY_DELAYS_MS = [500, 1500, 3000];

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  retries = RETRY_DELAYS_MS
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries.length) {
        console.warn(`[r2/${label}] attempt ${attempt + 1} failed, retrying in ${retries[attempt]}ms:`, err);
        await new Promise((res) => setTimeout(res, retries[attempt]));
      }
    }
  }
  throw lastErr;
}

// ─── Client singleton ─────────────────────────────────────────────────────────
// Reuse the same S3Client instance across requests within a Node.js process.
// Recreated only when the account/credentials change (should never happen in practice).

let _s3Client: S3Client | null = null;
let _s3ClientKey = "";

function createClient(): S3Client {
  const { accountId, accessKeyId, secretAccessKey } = getR2Config();
  const key = `${accountId}:${accessKeyId}`;
  if (_s3Client && _s3ClientKey === key) return _s3Client;
  _s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: accessKeyId!,
      secretAccessKey: secretAccessKey!,
    },
  });
  _s3ClientKey = key;
  return _s3Client;
}

// ─── Presigned Upload URL ─────────────────────────────────────────────────────

/**
 * Génère une URL PUT pré-signée permettant au browser d'uploader directement vers R2.
 * @param key         Chemin dans le bucket, ex: "uploads/image.jpg"
 * @param contentType MIME type, ex: "image/jpeg"
 * @param expiresIn   Durée de validité en secondes (défaut: 1 heure)
 */
export async function createPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 3600,
  contentLength?: number
): Promise<string> {
  requireR2();
  const { bucket } = getR2Config();
  const client = createClient();
  const command = new PutObjectCommand({
    Bucket: bucket!,
    Key: key,
    ContentType: contentType,
    // When provided, R2/S3 includes ContentLength in the presigned URL signature,
    // so the PUT request must declare exactly this many bytes.
    // This ties the presigned URL to the file size declared by the client, preventing
    // uploads of a different (larger) file after the size check has passed server-side.
    ...(contentLength !== undefined && { ContentLength: contentLength }),
  });
  return getSignedUrl(client, command, { expiresIn });
}

// ─── Presigned Download URL ───────────────────────────────────────────────────

/**
 * Génère une URL GET pré-signée permettant de télécharger un fichier R2 directement
 * depuis le browser avec le bon nom de fichier (Content-Disposition: attachment).
 * @param key        Chemin dans le bucket, ex: "content-library/videos/abc.mp4"
 * @param filename   Nom de fichier à proposer au téléchargement
 * @param expiresIn  Durée de validité en secondes (défaut: 1 heure)
 */
export async function createPresignedDownloadUrl(
  key: string,
  filename: string,
  expiresIn = 3600
): Promise<string> {
  requireR2();
  const { bucket } = getR2Config();
  const client = createClient();
  // Sanitize filename for use in the header value
  const safeFilename = filename.replace(/[\\"/\r\n]/g, "_");
  const command = new GetObjectCommand({
    Bucket: bucket!,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${safeFilename}"`,
  });
  return getSignedUrl(client, command, { expiresIn });
}

// ─── Upload ───────────────────────────────────────────────────────────────────

export interface UploadResult {
  key: string;
  url: string;
}

/**
 * Upload un Buffer ou ReadableStream vers R2.
 * @param key    Chemin dans le bucket, ex: "uploads/image.jpg"
 * @param body   Contenu du fichier
 * @param contentType  MIME type, ex: "image/jpeg"
 */
export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array | Readable | string,
  contentType: string,
  contentLength?: number
): Promise<UploadResult> {
  requireR2();
  const { bucket, publicUrl } = getR2Config();

  const client = createClient();
  const command = new PutObjectCommand({
    Bucket: bucket!,
    Key: key,
    Body: body,
    ContentType: contentType,
    ...(contentLength ? { ContentLength: contentLength } : {}),
  });

  await withRetry(`upload:${key}`, () => client.send(command));

  return {
    key,
    url: `${publicUrl!.replace(/\/$/, "")}/${key}`,
  };
}

// ─── Existence check ─────────────────────────────────────────────────────────

/**
 * Returns true when the key exists in R2.
 * Throws only on genuine network / auth errors (not on 404).
 */
export async function objectExistsInR2(key: string): Promise<boolean> {
  requireR2();
  const { bucket } = getR2Config();
  const client = createClient();
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket!, Key: key }));
    return true;
  } catch (err: unknown) {
    const code = (err as { name?: string; $metadata?: { httpStatusCode?: number } });
    if (code.$metadata?.httpStatusCode === 404 || code.name === "NotFound") return false;
    throw err;
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteFromR2(key: string): Promise<void> {
  requireR2();
  const { bucket } = getR2Config();
  const client = createClient();
  await withRetry(`delete:${key}`, () => client.send(new DeleteObjectCommand({ Bucket: bucket!, Key: key })));
}

/**
 * Supprime TOUS les objets sous un préfixe R2 (best-effort, objet par objet).
 *
 * Utilisé pour reclaim tout le stockage d'un slot en une passe via son préfixe
 * `publications/<slotId>/` (rushes + versions + brief + cover-monteur + résidus
 * d'uploads avortés). Pagine ListObjectsV2 ; chaque suppression passe par
 * `deleteFromR2` (retry). Un échec sur une clé est loggué mais n'interrompt pas
 * le reste — l'appelant gère la résilience.
 *
 * @returns { deleted, failed } — compteurs d'objets supprimés / en échec.
 */
export async function deleteR2Prefix(
  prefix: string,
): Promise<{ deleted: number; failed: number }> {
  requireR2();
  const { bucket } = getR2Config();
  const client = createClient();

  let deleted = 0;
  let failed = 0;
  let continuationToken: string | undefined = undefined;

  do {
    const response: ListObjectsV2CommandOutput = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket!,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      }),
    );

    for (const obj of response.Contents ?? []) {
      if (!obj.Key) continue;
      try {
        await deleteFromR2(obj.Key);
        deleted++;
      } catch (err) {
        failed++;
        console.error(`[deleteR2Prefix] échec suppression key=${obj.Key}:`, err);
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return { deleted, failed };
}

// ─── Public URL ───────────────────────────────────────────────────────────────

/** Construit l'URL publique pour une clé R2 (sans vérifier qu'elle existe). */
export function getR2PublicUrl(key: string): string {
  const { publicUrl } = getR2Config();
  if (!publicUrl) throw new Error("R2_PUBLIC_URL non défini");
  return `${publicUrl.replace(/\/$/, "")}/${key}`;
}

/**
 * Vérifie qu'une URL pointe bien vers le bucket R2 public configuré.
 *
 * Utilisé par les webhooks RunPod pour valider l'origine du `video_url` /
 * `output_url` avant de l'écrire dans Render.videoUrl, CaptionJob.outputUrl,
 * MediaAsset.url, etc. Sans cette garde, un attaquant qui forge un webhook
 * peut pointer ces champs vers n'importe quelle URL externe (stored XSS si
 * rendu dans un <video>/<img>, exfiltration si fetch côté serveur).
 *
 * Comparaison stricte par origin — pas de `startsWith` qui validerait
 * `https://r2.cdn.victim.com.attacker.com/…`.
 */
export function isR2PublicUrl(candidate: string | null | undefined): boolean {
  if (!candidate || typeof candidate !== "string") return false;
  const { publicUrl } = getR2Config();
  if (!publicUrl) return false;
  try {
    const candUrl = new URL(candidate);
    const baseUrl = new URL(publicUrl);
    return candUrl.origin === baseUrl.origin;
  } catch {
    return false;
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Télécharge un objet R2 côté serveur et retourne son contenu sous forme de Buffer.
 */
export async function getFromR2(key: string): Promise<Buffer> {
  requireR2();
  const { bucket } = getR2Config();
  const client = createClient();
  const response = await withRetry(`get:${key}`, () =>
    client.send(new GetObjectCommand({ Bucket: bucket!, Key: key }))
  );
  if (!response.Body) throw new Error(`R2 object empty: ${key}`);
  // Response.Body is a ReadableStream (Web Streams API) in Node 18+
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
