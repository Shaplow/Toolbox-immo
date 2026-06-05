/**
 * libraryImport.ts
 *
 * Importe un ZIP exporté par libraryExport.ts.
 *
 * Modes :
 *   "new"   — crée une nouvelle bibliothèque à partir du manifest
 *   "merge" — rattache les assets/entrées à une bibliothèque existante (targetLibraryId requis)
 *
 * Options :
 *   includeUsage   — restaurer usageCount / lastUsedAt (défaut: true)
 *   includeAccess  — restaurer les accès par compte (défaut: true)
 *
 * Guards de sécurité :
 *   - Validation du manifest avant tout traitement (version + libraryType)
 *   - r2Key du manifest doit commencer par "content-library/" (anti path-traversal)
 *   - Les IDs du manifest sont toujours remplacés par de nouveaux cuid()
 *   - Si un asset avec le même r2Key existe déjà en base → skip (idempotent)
 *   - Si un compte IG référencé dans les accès n'existe pas → warning, l'asset est quand même créé
 */

import JSZip from "jszip";
import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { uploadToR2, r2Configured } from "@/lib/r2";
import type { LibraryExportManifest } from "@/lib/libraryExport";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ImportOptions {
  mode: "new" | "merge";
  /** Requis si mode=merge */
  targetLibraryId?: string;
  includeUsage: boolean;
  includeAccess: boolean;
}

export interface ImportResult {
  libraryId: string;
  libraryName: string;
  created: number;
  skipped: number;
  warnings: string[];
}

const VALID_R2_PREFIX = "content-library/";

// ─── Manifest validation ──────────────────────────────────────────────────────

function isValidManifest(obj: unknown): obj is LibraryExportManifest {
  if (!obj || typeof obj !== "object") return false;
  const m = obj as Record<string, unknown>;
  if (m.version !== 1) return false;
  if (m.libraryType !== "media" && m.libraryType !== "data") return false;
  if (!m.library || typeof m.library !== "object") return false;
  // W5.6 : validation explicite Array.isArray sur assets/campaigns selon le
  // libraryType. Sans ça, un manifest avec `assets: "not-an-array"` passait
  // ce guard et faisait crasher l'import au premier forEach (500 silencieux,
  // rows partiellement créées sans rollback).
  if (m.libraryType === "media") {
    if (!Array.isArray(m.assets)) return false;
  } else if (m.libraryType === "data") {
    if (!Array.isArray(m.campaigns)) return false;
  }
  return true;
}

function validateR2Key(key: string): boolean {
  // Prevent path traversal: must start with the expected prefix
  if (!key.startsWith(VALID_R2_PREFIX)) return false;
  // No parent directory traversal
  if (key.includes("..")) return false;
  return true;
}

// ─── Account handle resolver ──────────────────────────────────────────────────

async function resolveHandles(handles: string[]): Promise<{ found: string[]; missing: string[] }> {
  if (handles.length === 0) return { found: [], missing: [] };
  const accounts = await prisma.instagramAccount.findMany({
    where: { handle: { in: handles } },
    select: { id: true, handle: true },
  });
  const foundHandles = new Set(accounts.map((a) => a.handle));
  return {
    found: accounts.map((a) => a.id),
    missing: handles.filter((h) => !foundHandles.has(h)),
  };
}

// ─── R2 upload from buffer ────────────────────────────────────────────────────

async function uploadFileToR2(
  buf: Buffer,
  mimeType: string,
  filename: string
): Promise<{ r2Key: string; url: string }> {
  const ext = filename.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") ?? "bin";
  const assetId = createId();
  const prefix = mimeType.startsWith("audio/") ? "content-library/audio" : "content-library/videos";
  const r2Key = `${prefix}/${assetId}.${ext}`;
  const result = await uploadToR2(r2Key, buf, mimeType, buf.length);
  return { r2Key: result.key, url: result.url };
}

// ─── Media import ─────────────────────────────────────────────────────────────

async function importMediaLibrary(
  manifest: LibraryExportManifest & { libraryType: "media" },
  zip: JSZip,
  options: ImportOptions
): Promise<ImportResult> {
  const warnings: string[] = [];
  let created = 0;
  let skipped = 0;

  // 1. Résoudre ou créer la bibliothèque cible
  let targetLibraryId: string;
  let libraryName: string;

  if (options.mode === "merge" && options.targetLibraryId) {
    const existing = await prisma.mediaLibrary.findUnique({
      where: { id: options.targetLibraryId },
    });
    if (!existing) {
      throw new Error(`Bibliothèque cible introuvable : ${options.targetLibraryId}`);
    }
    targetLibraryId = existing.id;
    libraryName = existing.name;
  } else {
    const lib = manifest.library;
    const newLib = await prisma.mediaLibrary.create({
      data: {
        name: lib.name,
        type: lib.type,
        tags: JSON.stringify(lib.tags ?? []),
        description: lib.description ?? null,
        setSequence: JSON.stringify(lib.setSequence ?? []),
        rotationScope: lib.rotationScope ?? "per_account",
      },
    });
    targetLibraryId = newLib.id;
    libraryName = newLib.name;
  }

  // 2. Traiter chaque asset
  for (const asset of manifest.assets) {
    // Guard: r2Key du manifest doit avoir le bon préfixe
    if (!validateR2Key(asset.r2Key)) {
      warnings.push(`Asset ignoré (r2Key invalide) : ${asset.filename} — ${asset.r2Key}`);
      skipped++;
      continue;
    }

    // Idempotence: si le r2Key existe déjà en base, on skip
    const existingByR2Key = await prisma.mediaAsset.findUnique({
      where: { r2Key: asset.r2Key },
    });

    let finalR2Key = asset.r2Key;
    let finalUrl = asset.url;

    if (existingByR2Key) {
      // Le fichier existe déjà — on peut l'associer à la lib cible sans re-upload
      // On crée juste un nouvel enregistrement pointant vers le même r2Key
      // sauf si cet asset appartient déjà à cette lib
      if (existingByR2Key.libraryId === targetLibraryId) {
        skipped++;
        continue;
      }
      // R2Key unique — on doit uploader sous une nouvelle clé si on a le fichier
      const fileEntry = zip.file(asset.fileEntry);
      if (fileEntry && r2Configured()) {
        try {
          const buf = Buffer.from(await fileEntry.async("arraybuffer"));
          const uploaded = await uploadFileToR2(buf, asset.mimeType, asset.filename);
          finalR2Key = uploaded.r2Key;
          finalUrl = uploaded.url;
        } catch (err) {
          warnings.push(`Upload R2 échoué pour ${asset.filename} — asset importé sans fichier.`);
          console.warn("[libraryImport] R2 upload failed:", err);
          // On crée l'asset avec l'URL d'origine (fichier externe, peut être invalide)
        }
      } else {
        // Pas de fichier dans le ZIP et r2Key déjà pris → générer une nouvelle clé fictive
        const ext = asset.filename.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") ?? "bin";
        const assetId = createId();
        const prefix = asset.mimeType.startsWith("audio/") ? "content-library/audio" : "content-library/videos";
        finalR2Key = `${prefix}/${assetId}.${ext}`;
        // URL reste celle du manifest — pointe vers l'original R2
      }
    } else {
      // r2Key pas encore en base
      const fileEntry = asset.fileEntry ? zip.file(asset.fileEntry) : null;
      if (fileEntry && r2Configured()) {
        try {
          const buf = Buffer.from(await fileEntry.async("arraybuffer"));
          const uploaded = await uploadFileToR2(buf, asset.mimeType, asset.filename);
          finalR2Key = uploaded.r2Key;
          finalUrl = uploaded.url;
        } catch (err) {
          warnings.push(`Upload R2 échoué pour ${asset.filename} — asset importé avec l'URL d'origine.`);
          console.warn("[libraryImport] R2 upload failed:", err);
        }
      }
    }

    // 3. Résoudre les accès compte
    let accessAccountIds: string[] = [];
    if (options.includeAccess && asset.accessAccountHandles.length > 0) {
      const { found, missing } = await resolveHandles(asset.accessAccountHandles);
      accessAccountIds = found;
      if (missing.length > 0) {
        warnings.push(
          `Asset "${asset.filename}" : accès non restaurés pour les comptes introuvables : ${missing.join(", ")}`
        );
      }
    }

    // 4. Créer l'asset en base
    try {
      const newAsset = await prisma.mediaAsset.create({
        data: {
          libraryId: targetLibraryId,
          filename: asset.filename,
          r2Key: finalR2Key,
          url: r2Configured() ? finalUrl : asset.url,
          mimeType: asset.mimeType,
          duration: asset.duration ?? null,
          tags: JSON.stringify(asset.tags ?? []),
          setTag: asset.setTag ?? null,
          category: asset.category ?? null,
          usageCount: options.includeUsage ? asset.usageCount : 0,
          lastUsedAt: options.includeUsage && asset.lastUsedAt ? new Date(asset.lastUsedAt) : null,
        },
      });

      // 5. Créer les accès
      if (accessAccountIds.length > 0) {
        await prisma.mediaAssetAccess.createMany({
          data: accessAccountIds.map((accountId) => ({
            assetId: newAsset.id,
            accountId,
          })),
          skipDuplicates: true,
        });
      }

      created++;
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      if (e?.code === "P2002") {
        // Violation unique sur r2Key — peut arriver en race condition
        warnings.push(`Asset "${asset.filename}" ignoré (r2Key déjà présent en base).`);
        skipped++;
      } else {
        throw err;
      }
    }
  }

  return { libraryId: targetLibraryId, libraryName, created, skipped, warnings };
}

// ─── Data import ──────────────────────────────────────────────────────────────

async function importDataLibrary(
  manifest: LibraryExportManifest & { libraryType: "data" },
  options: ImportOptions
): Promise<ImportResult> {
  const warnings: string[] = [];
  let created = 0;
  const skipped = 0;

  // 1. Résoudre ou créer la bibliothèque cible
  let targetLibraryId: string;
  let libraryName: string;

  if (options.mode === "merge" && options.targetLibraryId) {
    const existing = await prisma.dataLibrary.findUnique({
      where: { id: options.targetLibraryId },
    });
    if (!existing) {
      throw new Error(`Bibliothèque cible introuvable : ${options.targetLibraryId}`);
    }
    targetLibraryId = existing.id;
    libraryName = existing.name;
  } else {
    const lib = manifest.library;
    const newLib = await prisma.dataLibrary.create({
      data: {
        name: lib.name,
        templateType: lib.templateType,
        description: lib.description ?? null,
      },
    });
    targetLibraryId = newLib.id;
    libraryName = newLib.name;
  }

  // 2. Traiter chaque campaign
  // W5.6 : invariant "1 seule campaign active par lib" enforce ici. Avant,
  // un ZIP avec plusieurs campaigns isActive=true (état invalide producible
  // si la contrainte a été contournée) importait toutes actives → resolver
  // retournait la 1ère arbitrairement (non déterministe).
  let firstActiveImported = false;
  for (const campaign of manifest.campaigns) {
    const isActiveForce = campaign.isActive && !firstActiveImported;
    if (isActiveForce) firstActiveImported = true;
    else if (campaign.isActive) {
      warnings.push(
        `Campaign "${campaign.name}" était marquée active dans le ZIP mais une autre est déjà active : importée comme inactive.`,
      );
    }
    const newCampaign = await prisma.dataCampaign.create({
      data: {
        libraryId: targetLibraryId,
        name: campaign.name,
        isActive: isActiveForce,
        usagePolicy: campaign.usagePolicy ?? "cycle",
        cycleResetAt: campaign.cycleResetAt ? new Date(campaign.cycleResetAt) : null,
      },
    });

    // 3. Traiter chaque entry
    for (const entry of campaign.entries) {
      // Résoudre les accès compte
      let accessAccountIds: string[] = [];
      if (options.includeAccess && entry.accessAccountHandles.length > 0) {
        const { found, missing } = await resolveHandles(entry.accessAccountHandles);
        accessAccountIds = found;
        if (missing.length > 0) {
          warnings.push(
            `Entrée (setTag: ${entry.setTag ?? "—"}) : accès non restaurés pour : ${missing.join(", ")}`
          );
        }
      }

      const newEntry = await prisma.dataEntry.create({
        data: {
          campaignId: newCampaign.id,
          fields: JSON.stringify(entry.fields ?? {}),
          setTag: entry.setTag ?? null,
          category: entry.category ?? null,
          usageCount: options.includeUsage ? entry.usageCount : 0,
          lastUsedAt: options.includeUsage && entry.lastUsedAt ? new Date(entry.lastUsedAt) : null,
          usedInCycle: options.includeUsage ? entry.usedInCycle : false,
        },
      });

      if (accessAccountIds.length > 0) {
        await prisma.dataEntryAccess.createMany({
          data: accessAccountIds.map((accountId) => ({
            entryId: newEntry.id,
            accountId,
          })),
          skipDuplicates: true,
        });
      }

      created++;
    }
  }

  return { libraryId: targetLibraryId, libraryName, created, skipped, warnings };
}

// ─── Public entry point ───────────────────────────────────────────────────────

const DEFAULT_MAX_ZIP_BYTES = parseInt(process.env.LIBRARY_IMPORT_MAX_SIZE ?? "") || 10 * 1024 * 1024 * 1024; // 10 GB

export async function importLibraryFromZip(
  zipBuffer: Buffer,
  options: ImportOptions
): Promise<ImportResult> {
  if (zipBuffer.length > DEFAULT_MAX_ZIP_BYTES) {
    throw new Error(
      `ZIP trop volumineux (${Math.round(zipBuffer.length / 1024 / 1024)} MB). Maximum : ${Math.round(DEFAULT_MAX_ZIP_BYTES / 1024 / 1024)} MB.`
    );
  }

  // Parse le ZIP
  const zip = await JSZip.loadAsync(zipBuffer);

  // Lire et valider le manifest
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    throw new Error("manifest.json absent du ZIP — ce fichier n'est pas un export de bibliothèque valide.");
  }

  let manifest: unknown;
  try {
    const raw = await manifestFile.async("string");
    manifest = JSON.parse(raw);
  } catch {
    throw new Error("manifest.json illisible ou JSON invalide.");
  }

  if (!isValidManifest(manifest)) {
    throw new Error("manifest.json invalide — version ou libraryType incorrect.");
  }

  if (manifest.libraryType === "media") {
    return importMediaLibrary(manifest, zip, options);
  } else {
    return importDataLibrary(manifest, options);
  }
}
