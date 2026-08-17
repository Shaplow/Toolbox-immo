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
import { r2Configured, getFromR2 } from "@/lib/r2";
// W5 — S3Client custom retiré au profit de getFromR2 (helper centralisé dans
// lib/r2.ts qui partage le singleton + retry). Avant la consolidation,
// libraryExport rebuildait son propre client et dupliquait la lecture des
// env vars R2_ — surface d'erreur si les keys de config changent.

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
  /** v2 (plan simplification Phase 3) : drop de `setSequence` (lib) et
   *  `category` (assets). L'import accepte encore les manifests v1 en
   *  ignorant ces champs. */
  version: 2;
  exportedAt: string;
  libraryType: "media";
  library: {
    id: string;
    name: string;
    type: string;
    tags: string[];
    description: string | null;
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
      // W5.2 : préfixe par asset.id pour garantir unicité — sans ça, 2 assets
      // avec même filename (ex: 2 uploads "intro.mp4") écrasaient le 1er dans
      // le ZIP (JSZip override silencieux) → corruption silencieuse à l'import
      // car le manifest référence 2 assets avec même fileEntry.
      const basename = sanitizeFilename(asset.filename) || `${asset.id}.bin`;
      const zipPath = `files/${asset.id}_${basename}`;
      try {
        const buf = await getFromR2(asset.r2Key);
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
      usageCount: options.includeUsage ? asset.usageCount : 0,
      lastUsedAt: options.includeUsage ? (asset.lastUsedAt?.toISOString() ?? null) : null,
      accessAccountHandles: asset.accesses.map((a) => a.account.handle),
      fileEntry,
    });
  }

  const manifest: MediaLibraryManifest = {
    version: 2,
    exportedAt: new Date().toISOString(),
    libraryType: "media",
    library: {
      id: library.id,
      name: library.name,
      type: library.type,
      tags: safeJsonParse<string[]>(library.tags, []),
      description: library.description ?? null,
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
