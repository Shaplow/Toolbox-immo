/**
 * r2Cleanup — nettoyage des objets R2 orphelins sous les prefixes scannés.
 *
 * Un objet est considéré orphelin si :
 * - Il se trouve sous l'un des SCAN_PREFIXES
 * - Il a été créé (LastModified) il y a plus de 24h
 * - Sa clé n'apparaît dans aucune source DB (cf. collectReferencedKeys) :
 *   PublicationRush, PublicationVersion, PublicationBriefAttachment, MediaAsset
 *   (fichier ET vignette), CoverFramePack (finalCoverKey), TranscriptionJob,
 *   CaptionJob.
 *
 * Pagination : ListObjectsV2 (1000 objets max par page, toutes pages parcourues).
 * Cross-check DB : collecte les r2Keys existants une seule fois (pas de N requêtes).
 *
 * Garde-fous — la route cron est restée inaccessible en prod jusqu'au 06/10/2026
 * (proxy.ts), le premier passage réel balaie donc des mois d'orphelins d'un coup :
 * - dry-run par défaut (il faut le demander explicitement pour supprimer) ;
 * - disjoncteur `maxDeletes` : au-delà, rien n'est supprimé et le résultat le dit ;
 * - détail par classe de clé (volume + échantillons, cf. keyClass) pour juger
 *   un dry-run.
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

export interface ClassReport {
  /** Orphelins trouvés dans cette classe de clés. */
  orphans: number;
  /** Volume cumulé de ces orphelins, en octets. */
  bytes: number;
  /** Premières clés orphelines de la classe (au plus SAMPLE_SIZE) — de quoi relire un dry-run à l'œil. */
  samples: string[];
}

export interface CleanupResult {
  /** Nombre total d'objets scannés sous SCAN_PREFIXES. */
  scanned: number;
  /** Nombre d'objets identifiés comme orphelins (anciens + non référencés en DB). */
  orphans: number;
  /** Nombre d'objets effectivement supprimés (0 si dryRun=true ou si refusé). */
  deleted: number;
  /** Si true, aucune suppression n'a été effectuée. */
  dryRun: boolean;
  /**
   * Détail par CLASSE de clé (cf. keyClass), pour les seules classes qui ont des
   * orphelins : une classe absente n'en a aucun.
   */
  byClass: Record<string, ClassReport>;
  /** Passage réel refusé par le disjoncteur : rien n'a été supprimé. */
  refused: { reason: "too_many_orphans"; maxDeletes: number } | null;
}

/** Lignes DB qui référencent des clés R2, une entrée par source. */
export interface ReferencedKeyRows {
  rushes: { r2Key: string }[];
  versions: { r2Key: string }[];
  attachments: { r2Key: string }[];
  mediaAssets: { id: string; r2Key: string; posterUrl: string | null }[];
  covers: { finalCoverKey: string | null }[];
  transcriptions: { inputKey: string | null; outputJsonKey: string | null }[];
  captions: { inputKey: string | null; outputKey: string | null }[];
}

export interface CleanupParams {
  dryRun: boolean;
  maxDeletes: number;
}

// ─── Config ───────────────────────────────────────────────────────────────────

/** Durée minimale en ms avant qu'un objet soit candidat à la suppression. */
const CUTOFF_MS = 24 * 60 * 60 * 1000; // 24h

/** Plafond de suppressions d'un passage réel, sauf surcharge explicite. */
export const DEFAULT_MAX_DELETES = 500;

/** Clés orphelines rapportées par classe. */
const SAMPLE_SIZE = 20;

/** Prefixes R2 scannés. Chaque prefix a son propre cross-check DB.
 *  Ajouter un prefix ici sans étendre loadReferencedKeys → faux positifs
 *  garantis (l'orphan sweep supprimerait des objets référencés ailleurs).
 *
 *  `transcription/` et `inputs/captions/` ont été ajoutés parce que les sources
 *  de ces jobs n'étaient nettoyées QUE par le webhook RunPod : un upload jamais
 *  soumis (onglet fermé, « Lancer » jamais cliqué) restait indéfiniment. À 100 Go
 *  par rush, c'est la fuite la plus chère du bucket.
 *
 *  ⚠️ `transcription/` contient AUSSI les `segments.json` de sortie
 *  (TranscriptionJob.outputJsonKey), qui sont persistants et référencés en DB.
 *  Ils sont couverts par loadReferencedKeys — les retirer de cette liste
 *  supprimerait tous les transcripts de plus de 24 h. */
const SCAN_PREFIXES = [
  "publications/",
  "content-library/",
  "transcription/",
  "inputs/captions/",
] as const;

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

// ─── Helpers purs ─────────────────────────────────────────────────────────────

/**
 * Paramètres de la route cron. Dry-run par défaut : seul `?apply=1` supprime.
 * L'ancienne forme documentée `?dryRun=true` reste un dry-run, même combinée à
 * `apply=1` — en cas de doute, on ne supprime pas.
 */
export function parseCleanupParams(searchParams: URLSearchParams): CleanupParams {
  const apply = searchParams.get("apply") === "1" && searchParams.get("dryRun") !== "true";
  const raw = Number(searchParams.get("maxDeletes"));
  const maxDeletes = Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_DELETES;
  return { dryRun: !apply, maxDeletes };
}

/**
 * Clé R2 de la vignette d'un asset. Les routes poster et backfill-posters
 * l'écrivent toujours à cet emplacement, sous "content-library/" (préfixe
 * scanné), alors que l'asset ne la référence que par son URL (posterUrl).
 */
export function posterKeyForAsset(assetId: string): string {
  return `content-library/posters/${assetId}.jpg`;
}

// Classe d'une clé pour le rapport d'un dry-run : le sous-dossier qui dit de quoi
// il s'agit, pas le préfixe scanné. ListObjectsV2 rend les clés par ordre
// lexicographique : avec un seul échantillon par préfixe, 20 orphelins sous
// content-library/audio/ cachaient à jamais une classe voisine (les vignettes
// de posters/ avant leur protection, ou toute classe future), et sous
// publications/ on ne voyait que les slots les plus anciens, jamais les rushes
// ou les versions récents. Or ce rapport est le seul garde-fou avant `apply=1`.
//
//   publications/<slot>/<sous-dossier>/…  →  publications/*/<sous-dossier>/
//       (rushes, versions, brief, cover-monteur…) ; un fichier posé directement
//       sous le slot (résidu d'upload avorté) tombe dans publications/*/
//   content-library/<sous-dossier>/…      →  content-library/<sous-dossier>/
//       (audio, posters, videos)
//   tout autre préfixe scanné (transcription/, inputs/captions/) : tel quel.
//
// Le préfixe scanné décide de la forme : un préfixe ajouté à SCAN_PREFIXES a sa
// propre classe sans toucher cette fonction.
//
// (Commentaire de ligne exprès : « publications/*/ » fermerait un bloc JSDoc.)
export function keyClass(key: string, scannedPrefix: string): string {
  const segments = key.split("/");
  if (scannedPrefix === "publications/") {
    return segments.length > 3 ? `publications/*/${segments[2]}/` : "publications/*/";
  }
  if (scannedPrefix === "content-library/") {
    return segments.length > 2 ? `content-library/${segments[1]}/` : "content-library/";
  }
  return scannedPrefix;
}

/**
 * Clé R2 d'une URL publique du bucket (préfixe strict R2_PUBLIC_URL, query et
 * fragment retirés), ou null si l'URL pointe ailleurs (/uploads en local…).
 */
export function keyFromPublicUrl(
  url: string | null | undefined,
  publicUrl: string | null | undefined,
): string | null {
  if (!url || !publicUrl) return null;
  const base = `${publicUrl.replace(/\/+$/, "")}/`;
  if (!url.startsWith(base)) return null;
  const key = url.slice(base.length).split(/[?#]/)[0];
  return key || null;
}

/**
 * Ensemble des clés R2 référencées en DB. Toute clé absente de ce set et plus
 * vieille que CUTOFF_MS sera SUPPRIMÉE : ajouter une source ici avant d'ajouter
 * un préfixe à SCAN_PREFIXES, jamais l'inverse.
 */
export function collectReferencedKeys(
  rows: ReferencedKeyRows,
  publicUrl: string | null | undefined,
): Set<string> {
  const set = new Set<string>();
  for (const r of rows.rushes) set.add(r.r2Key);
  for (const v of rows.versions) set.add(v.r2Key);
  for (const a of rows.attachments) set.add(a.r2Key);
  for (const m of rows.mediaAssets) {
    // MediaAsset référence des objets sous "content-library/" (Phase library).
    // Sans cette source, le sweep supprimerait des assets actifs au prochain
    // run (faux positif catastrophique pour la rotation).
    set.add(m.r2Key);
    // Vignettes : même préfixe, mais référencées par posterUrl seulement. Sans
    // elles, le premier passage réel supprimait toutes les vignettes de +24 h.
    set.add(posterKeyForAsset(m.id));
    const posterKey = keyFromPublicUrl(m.posterUrl, publicUrl);
    if (posterKey) set.add(posterKey);
  }
  // CoverFramePack.finalCoverKey : les covers monteur sont stockées sous
  // "publications/<slotId>/cover-monteur/..." (préfixe scanné).
  for (const c of rows.covers) if (c.finalCoverKey) set.add(c.finalCoverKey);
  // TranscriptionJob : `inputKey` (source, nullée par le webhook après
  // traitement) ET `outputJsonKey` (les segments, PERSISTANTS).
  for (const t of rows.transcriptions) {
    if (t.inputKey) set.add(t.inputKey);
    if (t.outputJsonKey) set.add(t.outputJsonKey);
  }
  // CaptionJob : source sous "inputs/captions/" + output.
  for (const c of rows.captions) {
    if (c.inputKey) set.add(c.inputKey);
    if (c.outputKey) set.add(c.outputKey);
  }
  return set;
}

// ─── Helper DB ────────────────────────────────────────────────────────────────

/** Charge toutes les sources de clés en une passe (pas de N requêtes). */
async function loadReferencedKeys(): Promise<Set<string>> {
  const [rushes, versions, attachments, mediaAssets, covers, transcriptions, captions] =
    await Promise.all([
      prisma.publicationRush.findMany({ select: { r2Key: true } }),
      prisma.publicationVersion.findMany({ select: { r2Key: true } }),
      prisma.publicationBriefAttachment.findMany({ select: { r2Key: true } }),
      prisma.mediaAsset.findMany({ select: { id: true, r2Key: true, posterUrl: true } }),
      prisma.coverFramePack.findMany({
        where: { finalCoverKey: { not: null } },
        select: { finalCoverKey: true },
      }),
      prisma.transcriptionJob.findMany({ select: { inputKey: true, outputJsonKey: true } }),
      prisma.captionJob.findMany({ select: { inputKey: true, outputKey: true } }),
    ]);

  return collectReferencedKeys(
    { rushes, versions, attachments, mediaAssets, covers, transcriptions, captions },
    process.env.R2_PUBLIC_URL,
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Liste les objets R2 orphelins créés il y a >24h et non référencés en DB.
 * Ne supprime que sur demande explicite (`dryRun: false`) et tant que le nombre
 * d'orphelins reste sous `maxDeletes`.
 */
export async function cleanupOrphanR2Objects(
  opts?: { dryRun?: boolean; maxDeletes?: number }
): Promise<CleanupResult> {
  const dryRun = opts?.dryRun ?? true;
  const maxDeletes = opts?.maxDeletes ?? DEFAULT_MAX_DELETES;

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

  // 2. Paginer ListObjectsV2 sur chaque prefix scanné
  let scanned = 0;
  const orphanKeys: string[] = [];
  const byClass: Record<string, ClassReport> = {};

  for (const prefix of SCAN_PREFIXES) {
    let continuationToken: string | undefined = undefined;
    do {
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
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
          const report = (byClass[keyClass(obj.Key, prefix)] ??= {
            orphans: 0,
            bytes: 0,
            samples: [],
          });
          report.orphans++;
          report.bytes += obj.Size ?? 0;
          if (report.samples.length < SAMPLE_SIZE) report.samples.push(obj.Key);
        }
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  // 3. Supprimer les orphelins (si pas en dryRun et sous le plafond)
  let deleted = 0;
  let refused: CleanupResult["refused"] = null;
  if (!dryRun && orphanKeys.length > maxDeletes) {
    refused = { reason: "too_many_orphans", maxDeletes };
  } else if (!dryRun) {
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
    byClass,
    refused,
  };
}
