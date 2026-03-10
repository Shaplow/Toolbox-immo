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
} from "@aws-sdk/client-s3";

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

function createClient(): S3Client {
  const { accountId, accessKeyId, secretAccessKey } = getR2Config();
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: accessKeyId!,
      secretAccessKey: secretAccessKey!,
    },
  });
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
  body: Buffer | Uint8Array | ReadableStream | string,
  contentType: string
): Promise<UploadResult> {
  requireR2();
  const { bucket, publicUrl } = getR2Config();

  const client = createClient();
  const command = new PutObjectCommand({
    Bucket: bucket!,
    Key: key,
    Body: body,
    ContentType: contentType,
  });

  await client.send(command);

  return {
    key,
    url: `${publicUrl!.replace(/\/$/, "")}/${key}`,
  };
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteFromR2(key: string): Promise<void> {
  requireR2();
  const { bucket } = getR2Config();
  const client = createClient();
  await client.send(new DeleteObjectCommand({ Bucket: bucket!, Key: key }));
}

// ─── Public URL ───────────────────────────────────────────────────────────────

/** Construit l'URL publique pour une clé R2 (sans vérifier qu'elle existe). */
export function getR2PublicUrl(key: string): string {
  const { publicUrl } = getR2Config();
  if (!publicUrl) throw new Error("R2_PUBLIC_URL non défini");
  return `${publicUrl.replace(/\/$/, "")}/${key}`;
}
