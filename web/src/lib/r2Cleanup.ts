/**
 * r2Cleanup — nettoyage des objets R2 orphelins sous le prefix "publications/".
 *
 * Un objet est considéré orphelin si :
 * - Il se trouve sous le prefix "publications/"
 * - Il a été créé (LastModified) il y a plus de 24h
 * - Son r2Key n'apparaît pas dans les tables PublicationRush,
 *   PublicationVersion ou PublicationBriefAttachment
 *
 * Pagination : ListObjectsV2 (1000 objets max par page, toutes pages parcourues).
 * Cross-check DB : collecte les r2Keys existants une seule fois (pas de N requêtes).
 *
 * Usage :
 *   import { cleanupOrphanR2Objects } from "@/lib/r2Cleanup"
 *   const result = await cleanupOrphanR2Objects({ dryRun: true })
 */

import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
  type ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CleanupResult {
  /** Nombre total d'objets scannés sous "publications/". */
  scanned: number;
  /** Nombre d'objets identifiés comme orphelins (anciens + non référencés en DB). */
  orphans: number;
  /** Nombre d'objets effectivement supprimés (0 si dryRun=true). */
  deleted: number;
  /** Si true, aucune suppression n'a été effectuée. */
  dryRun: boolean;
}

// ─── Config ───────────────────────────────────────────────────────────────────

/** Durée minimale en ms avant qu'un objet soit candidat à la suppression. */
const CUTOFF_MS = 24 * 60 * 60 * 1000; // 24h

/** Prefix R2 à scanner. */
const SCAN_PREFIX = "publications/";

// ─── Client R2 ────────────────────────────────────────────────────────────────

function getR2Client(): S3Client | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) return null;

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucket(): string | null {
  return process.env.R2_BUCKET ?? null;
}

// ─── Helper DB ────────────────────────────────────────────────────────────────

/**
 * Récupère l'ensemble des r2Keys référencés en DB (les 3 tables).
 * Chargement en une seule passe pour éviter les N requêtes par objet.
 */
async function loadReferencedKeys(): Promise<Set<string>> {
  const [rushKeys, versionKeys, attachmentKeys] = await Promise.all([
    prisma.publicationRush.findMany({ select: { r2Key: true } }),
    prisma.publicationVersion.findMany({ select: { r2Key: true } }),
    prisma.publicationBriefAttachment.findMany({ select: { r2Key: true } }),
  ]);

  const set = new Set<string>();
  for (const r of rushKeys) set.add(r.r2Key);
  for (const v of versionKeys) set.add(v.r2Key);
  for (const a of attachmentKeys) set.add(a.r2Key);
  return set;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Liste les objets R2 orphelins sous "publications/" créés il y a >24h
 * et non référencés en DB. Supprime les orphelins (sauf si dryRun=true).
 *
 * @returns CleanupResult — statistiques de l'opération.
 */
export async function cleanupOrphanR2Objects(
  opts?: { dryRun?: boolean }
): Promise<CleanupResult> {
  const dryRun = opts?.dryRun ?? false;

  const client = getR2Client();
  const bucket = getBucket();

  if (!client || !bucket) {
    throw new Error(
      "R2 non configuré : R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET requis."
    );
  }

  const cutoff = new Date(Date.now() - CUTOFF_MS);

  // 1. Charger les r2Keys référencés en DB (une seule requête groupée)
  const referencedKeys = await loadReferencedKeys();

  // 2. Paginer ListObjectsV2 sur le prefix "publications/"
  let continuationToken: string | undefined = undefined;
  let scanned = 0;
  const orphanKeys: string[] = [];

  do {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: SCAN_PREFIX,
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    });

    const response: ListObjectsV2CommandOutput = await client.send(command);
    const objects = response.Contents ?? [];

    for (const obj of objects) {
      if (!obj.Key || !obj.LastModified) continue;
      scanned++;

      // Candidat à l'orphelin : ancien + non référencé
      const isOld = obj.LastModified < cutoff;
      const isOrphan = !referencedKeys.has(obj.Key);

      if (isOld && isOrphan) {
        orphanKeys.push(obj.Key);
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  // 3. Supprimer les orphelins (si pas en dryRun)
  let deleted = 0;
  if (!dryRun && orphanKeys.length > 0) {
    for (const key of orphanKeys) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        deleted++;
      } catch (err) {
        console.warn(`[r2Cleanup] Échec suppression de "${key}" :`, err);
      }
    }
  }

  return {
    scanned,
    orphans: orphanKeys.length,
    deleted,
    dryRun,
  };
}
