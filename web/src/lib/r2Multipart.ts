/**
 * Helpers multipart upload pour Cloudflare R2 (compatible AWS S3).
 *
 * Usage typique (grands fichiers > 100 MB) :
 * 1. createMultipartUpload(key, contentType) → { uploadId }
 * 2. Pour chaque partie : createPresignedUploadPartUrl(key, uploadId, partNumber) → url
 * 3. Le navigateur PUT chaque partie et collecte les ETags.
 * 4. completeMultipartUpload(key, uploadId, parts) pour finaliser.
 * 5. En cas d'erreur : abortMultipartUpload(key, uploadId).
 *
 * Dépendances : même S3Client que r2.ts (singleton via createClient importé).
 * Retries : même stratégie que r2.ts (3 tentatives, backoff [500ms, 1500ms, 3000ms]).
 */

import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ─── Config & helpers (dupliqués de r2.ts pour éviter les imports circulaires) ─

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

function requireR2(): void {
  const { accountId, accessKeyId, secretAccessKey, bucket } = getR2Config();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "R2 non configuré. Renseigner les variables d'environnement : " +
        "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET"
    );
  }
}

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
        console.warn(
          `[r2Multipart/${label}] attempt ${attempt + 1} failed, retrying in ${retries[attempt]}ms:`,
          err
        );
        await new Promise((res) => setTimeout(res, retries[attempt]));
      }
    }
  }
  throw lastErr;
}

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

// ─── Création d'un upload multipart ───────────────────────────────────────────

/**
 * Démarre un upload multipart et retourne l'uploadId.
 */
export async function createMultipartUpload(
  key: string,
  contentType: string
): Promise<{ uploadId: string }> {
  requireR2();
  const { bucket } = getR2Config();
  const client = createClient();

  const result = await withRetry(`createMultipartUpload:${key}`, () =>
    client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket!,
        Key: key,
        ContentType: contentType,
      })
    )
  );

  if (!result.UploadId) {
    throw new Error(`R2 CreateMultipartUpload: UploadId manquant (key=${key})`);
  }

  return { uploadId: result.UploadId };
}

// ─── Presigned URL pour une partie ────────────────────────────────────────────

/**
 * Génère une URL PUT pré-signée pour uploader une partie d'un upload multipart.
 *
 * @param key         Clé R2 de l'objet final.
 * @param uploadId    Identifiant de l'upload multipart (retourné par createMultipartUpload).
 * @param partNumber  Numéro de la partie (1-based).
 * @param expiresIn   Durée de validité en secondes (défaut: 3600 = 1h).
 */
export async function createPresignedUploadPartUrl(
  key: string,
  uploadId: string,
  partNumber: number,
  expiresIn = 3600
): Promise<string> {
  requireR2();
  const { bucket } = getR2Config();
  const client = createClient();

  const command = new UploadPartCommand({
    Bucket: bucket!,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });

  return getSignedUrl(client, command, { expiresIn });
}

// ─── Complétion de l'upload multipart ─────────────────────────────────────────

/**
 * Finalise un upload multipart.
 *
 * @param parts Liste ordonnée des parties avec leur partNumber et ETag (retournés
 *              par R2 dans le header ETag de la réponse PUT de chaque partie).
 */
export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[]
): Promise<void> {
  requireR2();
  const { bucket } = getR2Config();
  const client = createClient();

  await withRetry(`completeMultipartUpload:${key}`, () =>
    client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket!,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      })
    )
  );
}

// ─── Abandon de l'upload multipart ────────────────────────────────────────────

/**
 * Annule un upload multipart en cours et libère le stockage partiel.
 * À appeler si le client abandonne ou si l'insert Prisma échoue.
 */
export async function abortMultipartUpload(
  key: string,
  uploadId: string
): Promise<void> {
  requireR2();
  const { bucket } = getR2Config();
  const client = createClient();

  await withRetry(`abortMultipartUpload:${key}`, () =>
    client.send(
      new AbortMultipartUploadCommand({
        Bucket: bucket!,
        Key: key,
        UploadId: uploadId,
      })
    )
  );
}

// ─── Liste des parties (debug) ────────────────────────────────────────────────

/**
 * Liste les parties déjà uploadées pour un upload multipart en cours.
 * Utile pour le debug ou pour reprendre un upload interrompu.
 */
export async function listInProgressParts(
  key: string,
  uploadId: string
): Promise<{ partNumber: number; size: number; etag: string }[]> {
  requireR2();
  const { bucket } = getR2Config();
  const client = createClient();

  const result = await client.send(
    new ListPartsCommand({
      Bucket: bucket!,
      Key: key,
      UploadId: uploadId,
    })
  );

  return (result.Parts ?? []).map((p) => ({
    partNumber: p.PartNumber ?? 0,
    size: p.Size ?? 0,
    etag: p.ETag ?? "",
  }));
}
