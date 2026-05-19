/**
 * libraryExport.ts
 *
 * Construit un ZIP exportable d'une bibliothèque (MediaLibrary ou DataLibrary).
 *
 * Manifest format (version 1) :
 *   manifest.json  — métadonnées complètes
 *   files/<basename>  — binaires (si includeFiles=true, uniquement pour MediaLibrary)
 */

import JSZip from "jszip";
import { prisma } from "@/lib/prisma";
import { r2Configured } from "@/lib/r2";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExportOptions {
  includeFiles: boolean;
  includeUsage: boolean;
}

export interface ExportResult {
  zip: JSZip;
  filename: string;
  warnings: string[];
}

export type LibraryExportManifest = MediaLibraryManifest | DataLibraryManifest;

interface MediaLibraryManifest {
  version: 1;
  exportedAt: string;
  libraryType: "media";
  library: {
    id: string;
    name: string;
    type: string;
    tags: string[];
    description: string | null;
    setSequence: string[];
    rotationScope: string;
  };
  assets: ExportedMediaAsset[];
}

interface ExportedMediaAsset {
  id: string;
  filename: string;
  r2Key: string;
  url: string;
  mimeType: string;
  duration: number | null;
  tags: string[];
  setTag: string | null;
  category: string | null;
  usageCount: number;
  lastUsedAt: string | null;
  accessAccountHandles: string[];
  /** Chemin relatif dans le ZIP (vide si non inclus). */
  fileEntry: string;
}

interface DataLibraryManifest {
  version: 1;
  exportedAt: string;
  libraryType: "data";
  library: {
    id: string;
    name: string;
    templateType: string;
    description: string | null;
  };
  campaigns: ExportedCampaign[];
}

interface ExportedCampaign {
  id: string;
  name: string;
  isActive: boolean;
  usagePolicy: string;
  cycleResetAt: string | null;
  entries: ExportedDataEntry[];
}

interface ExportedDataEntry {
  id: string;
  fields: Record<string, string>;
  setTag: string | null;
  category: string | null;
  usageCount: number;
  lastUsedAt: string | null;
  usedInCycle: boolean;
  accessAccountHandles: string[];
}

// ─── R2 stream helper ─────────────────────────────────────────────────────────

function getR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID!;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID!;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY!;
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function downloadR2Object(r2Key: string): Promise<Buffer> {
  const bucket = process.env.R2_BUCKET!;
  const client = getR2Client();
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: r2Key });
  const response = await client.send(cmd);
  if (!response.Body) throw new Error(`Aucun body pour la clé R2 : ${r2Key}`);
  // Body is a ReadableStream (Node.js web stream or Readable depending on env)
  const chunks: Uint8Array[] = [];
  // @ts-expect-error — S3 SDK Body type varies between web/node. We iterate the stream.
  for await (const chunk of response.Body) {
    chunks.push(chunk as Uint8Array);
  }
  return Buffer.concat(chunks);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// ─── Media export ─────────────────────────────────────────────────────────────

async function buildMediaExport(
  libraryId: string,
  options: ExportOptions
): Promise<ExportResult | null> {
  const library = await prisma.mediaLibrary.findUnique({
    where: { id: libraryId },
    include: {
      assets: {
        include: {
          accesses: {
            include: { account: { select: { handle: true } } },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!library) return null;

  const warnings: string[] = [];
  const zip = new JSZip();
  const exportedAssets: ExportedMediaAsset[] = [];

  for (const asset of library.assets) {
    let fileEntry = "";

    if (options.includeFiles && r2Configured()) {
      const basename = sanitizeFilename(asset.filename) || `${asset.id}.bin`;
      const zipPath = `files/${basename}`;
      try {
        const buf = await downloadR2Object(asset.r2Key);
        zip.file(zipPath, buf);
        fileEntry = zipPath;
      } catch (err) {
        const msg = `Fichier R2 introuvable pour l'asset ${asset.id} (${asset.filename}) — ignoré.`;
        warnings.push(msg);
        console.warn(`[libraryExport] ${msg}`, err);
      }
    }

    exportedAssets.push({
      id: asset.id,
      filename: asset.filename,
      r2Key: asset.r2Key,
      url: asset.url,
      mimeType: asset.mimeType,
      duration: asset.duration ?? null,
      tags: safeJsonParse<string[]>(asset.tags, []),
      setTag: asset.setTag ?? null,
      category: asset.category ?? null,
      usageCount: options.includeUsage ? asset.usageCount : 0,
      lastUsedAt: options.includeUsage ? (asset.lastUsedAt?.toISOString() ?? null) : null,
      accessAccountHandles: asset.accesses.map((a) => a.account.handle),
      fileEntry,
    });
  }

  const manifest: MediaLibraryManifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    libraryType: "media",
    library: {
      id: library.id,
      name: library.name,
      type: library.type,
      tags: safeJsonParse<string[]>(library.tags, []),
      description: library.description ?? null,
      setSequence: safeJsonParse<string[]>(library.setSequence, []),
      rotationScope: library.rotationScope,
    },
    assets: exportedAssets,
  };

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  const slug = sanitizeFilename(library.name.toLowerCase().replace(/\s+/g, "-"));
  const filename = `library-media-${slug}-${Date.now()}.zip`;

  return { zip, filename, warnings };
}

// ─── Data export ──────────────────────────────────────────────────────────────

async function buildDataExport(
  libraryId: string,
  options: ExportOptions
): Promise<ExportResult | null> {
  const library = await prisma.dataLibrary.findUnique({
    where: { id: libraryId },
    include: {
      campaigns: {
        include: {
          entries: {
            include: {
              accesses: {
                include: { account: { select: { handle: true } } },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!library) return null;

  const exportedCampaigns: ExportedCampaign[] = library.campaigns.map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    isActive: campaign.isActive,
    usagePolicy: campaign.usagePolicy,
    cycleResetAt: campaign.cycleResetAt?.toISOString() ?? null,
    entries: campaign.entries.map((entry) => ({
      id: entry.id,
      fields: safeJsonParse<Record<string, string>>(entry.fields, {}),
      setTag: entry.setTag ?? null,
      category: entry.category ?? null,
      usageCount: options.includeUsage ? entry.usageCount : 0,
      lastUsedAt: options.includeUsage ? (entry.lastUsedAt?.toISOString() ?? null) : null,
      usedInCycle: options.includeUsage ? entry.usedInCycle : false,
      accessAccountHandles: entry.accesses.map((a) => a.account.handle),
    })),
  }));

  const manifest: DataLibraryManifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    libraryType: "data",
    library: {
      id: library.id,
      name: library.name,
      templateType: library.templateType,
      description: library.description ?? null,
    },
    campaigns: exportedCampaigns,
  };

  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  const slug = sanitizeFilename(library.name.toLowerCase().replace(/\s+/g, "-"));
  const filename = `library-data-${slug}-${Date.now()}.zip`;

  return { zip, filename, warnings: [] };
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Construit le ZIP d'une bibliothèque (MediaLibrary ou DataLibrary).
 * Retourne null si la bibliothèque n'existe ni en MediaLibrary ni en DataLibrary.
 */
export async function buildLibraryExport(
  libraryId: string,
  options: ExportOptions
): Promise<ExportResult | null> {
  // Try media first, then data
  const mediaResult = await buildMediaExport(libraryId, options);
  if (mediaResult) return mediaResult;

  const dataResult = await buildDataExport(libraryId, options);
  return dataResult;
}
