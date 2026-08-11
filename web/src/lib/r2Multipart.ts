/**
 * Helpers multipart upload pour Cloudflare R2 (compatible AWS S3).
 *
 * Usage typique (grands fichiers > 100 MB) :
 * 1. createMultipartUpload(key, contentType) → { uploadId }
 * 2. Pour chaque partie : createPresignedUploadPartUrl(key, uploadId, partNumber) → url
 * 3. Le navigateur PUT chaque partie (l'ETag n'a pas besoin d'être relu côté client).
 * 4. completeMultipartUpload(key, uploadId, parts) : les ETags sont récupérés
 *    côté serveur via ListParts (source de vérité), pas fournis par le client.
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
  ListMultipartUploadsCommand,
  type ListPartsCommandOutput,
  type ListMultipartUploadsCommandOutput,
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
 * Les ETags ne sont PAS fournis par le client : ils sont récupérés côté serveur
 * via ListParts (source de vérité R2). En cross-origin, le header ETag de la
 * réponse PUT d'une partie n'est lisible par le navigateur que si la CORS du
 * bucket expose `ETag` — s'appuyer dessus rendait la finalisation dépendante
 * d'une config CORS hors repo (ETag vide → CompleteMultipartUpload rejeté).
 *
 * @param expectedParts Parties attendues (numéros) telles qu'uploadées par le
 *                       client — sert uniquement de garde anti-troncature
 *                       (comparaison de comptage avec ce que R2 a réellement).
 */
export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  expectedParts: { partNumber: number }[]
): Promise<void> {
  requireR2();
  const { bucket } = getR2Config();
  const client = createClient();

  // ETags canoniques côté serveur (robuste quelle que soit la CORS du bucket).
  const listed = await withRetry(`listParts:${key}`, () =>
    listInProgressParts(key, uploadId)
  );

  // Garde anti-troncature : si R2 a moins (ou plus) de parties que ce que le
  // client déclare avoir uploadé, on refuse d'assembler un fichier incomplet.
  if (listed.length !== expectedParts.length) {
    throw new Error(
      `R2 CompleteMultipartUpload: ${listed.length} parties trouvées, ` +
        `${expectedParts.length} attendues (key=${key}, uploadId=${uploadId})`
    );
  }

  await withRetry(`completeMultipartUpload:${key}`, () =>
    client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket!,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: listed
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

// ─── Liste des parties ────────────────────────────────────────────────────────

/**
 * Liste toutes les parties déjà uploadées pour un upload multipart en cours.
 *
 * Source de vérité des ETags pour la finalisation (voir completeMultipartUpload).
 * Pagine via IsTruncated / PartNumberMarker : R2 renvoie jusqu'à 1000 parties par
 * page. Le cap réel ici est ~400 (20 Go / 50 Mo), mais la pagination reste
 * défensive au cas où PART_SIZE baisserait.
 */
/**
 * Liste les uploads multipart démarrés mais jamais finalisés ni abandonnés.
 *
 * ## Pourquoi cette fonction existe
 *
 * `abortMultipartUpload` n'est appelé que sur une action explicite du client
 * (`/upload-abort`) ou sur un échec de finalisation. Si l'onglet est fermé en
 * cours d'upload — ou si la machine s'endort, ou si le réseau tombe — personne
 * n'annule rien : les parties déjà poussées restent sur R2 **et sont facturées**,
 * indéfiniment, sans apparaître dans aucun listing d'objets (un multipart en
 * cours n'est pas un objet, `ListObjectsV2` ne le voit pas — donc l'orphan sweep
 * de `r2Cleanup.ts` passe complètement à côté).
 *
 * Sur des rushs de 100 Go, chaque onglet fermé coûte donc jusqu'à 100 Go de
 * stockage invisible et permanent.
 *
 * @param olderThanMs Âge minimal depuis `Initiated` pour être candidat.
 */
export async function listStaleMultipartUploads(
  olderThanMs: number
): Promise<{ key: string; uploadId: string; initiated: Date }[]> {
  requireR2();
  const { bucket } = getR2Config();
  const client = createClient();

  const cutoff = new Date(Date.now() - olderThanMs);
  const stale: { key: string; uploadId: string; initiated: Date }[] = [];

  let keyMarker: string | undefined = undefined;
  let uploadIdMarker: string | undefined = undefined;

  do {
    const result: ListMultipartUploadsCommandOutput = await client.send(
      new ListMultipartUploadsCommand({
        Bucket: bucket!,
        KeyMarker: keyMarker,
        UploadIdMarker: uploadIdMarker,
      })
    );

    for (const upload of result.Uploads ?? []) {
      if (!upload.Key || !upload.UploadId || !upload.Initiated) continue;
      if (upload.Initiated < cutoff) {
        stale.push({
          key: upload.Key,
          uploadId: upload.UploadId,
          initiated: upload.Initiated,
        });
      }
    }

    if (result.IsTruncated) {
      keyMarker = result.NextKeyMarker;
      uploadIdMarker = result.NextUploadIdMarker;
    } else {
      keyMarker = undefined;
      uploadIdMarker = undefined;
    }
  } while (keyMarker !== undefined || uploadIdMarker !== undefined);

  return stale;
}

/**
 * Abandonne les uploads multipart restés en cours au-delà du seuil, libérant le
 * stockage des parties déjà poussées.
 *
 * Le seuil doit rester **strictement supérieur** à la validité des URLs de
 * parties (`MULTIPART.PART_URL_EXPIRY_SECONDS`) : au-delà de cette validité un
 * upload ne peut plus aboutir, donc l'abandonner ne détruit rien de récupérable.
 * En deçà, on risquerait de tuer un upload encore en cours.
 *
 * @param opts.dryRun Ne rien abandonner, seulement compter (inspection avant activation).
 */
export async function abortStaleMultipartUploads(
  olderThanMs: number,
  opts?: { dryRun?: boolean }
): Promise<{ found: number; aborted: number; bytesFreed: number; dryRun: boolean }> {
  const dryRun = opts?.dryRun ?? false;
  const stale = await listStaleMultipartUploads(olderThanMs);

  let aborted = 0;
  let bytesFreed = 0;

  for (const upload of stale) {
    // Taille réelle des parties déjà poussées — c'est ce que R2 facture, et le
    // seul chiffre qui rend la fuite lisible dans les logs.
    let uploadBytes = 0;
    try {
      const parts = await listInProgressParts(upload.key, upload.uploadId);
      uploadBytes = parts.reduce((sum, p) => sum + p.size, 0);
    } catch {
      /* best-effort : l'absence de mesure ne doit pas empêcher l'abandon */
    }

    if (dryRun) {
      bytesFreed += uploadBytes;
      continue;
    }

    try {
      await abortMultipartUpload(upload.key, upload.uploadId);
      aborted++;
      bytesFreed += uploadBytes;
    } catch (err) {
      console.warn(
        `[r2Multipart/abortStale] échec abandon key=${upload.key} uploadId=${upload.uploadId}:`,
        err
      );
    }
  }

  return { found: stale.length, aborted, bytesFreed, dryRun };
}

export async function listInProgressParts(
  key: string,
  uploadId: string
): Promise<{ partNumber: number; size: number; etag: string }[]> {
  requireR2();
  const { bucket } = getR2Config();
  const client = createClient();

  const parts: { partNumber: number; size: number; etag: string }[] = [];
  let partNumberMarker: string | undefined = undefined;

  do {
    const result: ListPartsCommandOutput = await client.send(
      new ListPartsCommand({
        Bucket: bucket!,
        Key: key,
        UploadId: uploadId,
        PartNumberMarker: partNumberMarker,
      })
    );

    for (const p of result.Parts ?? []) {
      parts.push({
        partNumber: p.PartNumber ?? 0,
        size: p.Size ?? 0,
        etag: p.ETag ?? "",
      });
    }

    partNumberMarker = result.IsTruncated ? result.NextPartNumberMarker : undefined;
  } while (partNumberMarker !== undefined);

  return parts;
}
