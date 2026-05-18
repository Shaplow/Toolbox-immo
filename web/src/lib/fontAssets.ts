import { randomUUID } from "crypto";
import { mkdir, readdir, writeFile } from "fs/promises";
import path from "path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type FontAssetRecord = {
  id: string;
  family: string;
  weight: number;
  fontStyle: string;
  url: string;
  storageKey: string | null;
  originalName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type UpsertFontAssetInput = {
  family: string;
  weight?: number;
  fontStyle?: string;
  url: string;
  storageKey?: string | null;
  originalName?: string | null;
};

/** Infer font weight (CSS numeric) from a filename stem. */
export function inferWeightFromFilename(filename: string): number {
  const stem = path.basename(filename, path.extname(filename)).toLowerCase();
  if (/black/.test(stem)) return 900;
  if (/extrabold|extra.?bold/.test(stem)) return 800;
  if (/bold/.test(stem)) return 700;
  if (/semibold|semi.?bold|demibold/.test(stem)) return 600;
  if (/medium/.test(stem)) return 500;
  if (/extralight|extra.?light/.test(stem)) return 200;
  if (/light/.test(stem)) return 300;
  if (/thin/.test(stem)) return 100;
  return 400;
}

/** Infer font style from a filename stem. */
export function inferStyleFromFilename(filename: string): "normal" | "italic" {
  const stem = path.basename(filename, path.extname(filename)).toLowerCase();
  return /italic|oblique/.test(stem) ? "italic" : "normal";
}

type RemoteFontFile = {
  family?: string;
  filename?: string;
  url?: string;
};

const CAPTIONS_FONT_EXTENSIONS = new Set([".ttf", ".otf"]);

export function getFontAssetExtension(asset: Pick<FontAssetRecord, "originalName" | "url">): string {
  const raw = asset.originalName || asset.url;
  const pathname = raw.split("?")[0].toLowerCase();
  const dotIndex = pathname.lastIndexOf(".");
  return dotIndex === -1 ? "" : pathname.slice(dotIndex);
}

export function isCaptionCompatibleFontAsset(asset: Pick<FontAssetRecord, "originalName" | "url">): boolean {
  return CAPTIONS_FONT_EXTENSIONS.has(getFontAssetExtension(asset));
}

function inferFontFamilyFromFilename(filename: string): string {
  const stem = path.basename(filename, path.extname(filename));
  return stem
    .replace(/[_-]+/g, " ")
    .replace(/(?<=[a-z])(?=[A-Z])/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSourceFilename(value: Pick<FontAssetRecord, "originalName" | "url"> | { originalName?: string | null; url?: string | null }): string {
  if (value.originalName?.trim()) return value.originalName.trim();
  const rawUrl = value.url?.split("?")[0] ?? "";
  return path.basename(rawUrl);
}

function getNormalizedSourceKey(value: Pick<FontAssetRecord, "originalName" | "url"> | { originalName?: string | null; url?: string | null }): string {
  return getSourceFilename(value).trim().toLowerCase();
}

function isSupportedFontFilename(filename: string): boolean {
  if (!filename) return false;
  if (filename.startsWith(".")) return false;
  if (filename.startsWith("._")) return false;

  const ext = path.extname(filename).toLowerCase();
  return new Set([".woff", ".woff2", ".ttf", ".otf"]).has(ext);
}

async function deleteFontAssetsByIds(ids: string[]): Promise<void> {
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return;

  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM "FontAsset"
    WHERE "id" IN (${Prisma.join(uniqueIds)})
  `);
}

export async function listFontAssets(): Promise<FontAssetRecord[]> {
  return prisma.$queryRaw<FontAssetRecord[]>(Prisma.sql`
    SELECT "id", "family", "weight", "fontStyle", "url", "storageKey", "originalName", "createdAt", "updatedAt"
    FROM "FontAsset"
    ORDER BY LOWER("family") ASC, "weight" ASC
  `);
}

export async function listFontAssetsByFamilies(families: string[]): Promise<FontAssetRecord[]> {
  const uniqueFamilies = [...new Set(families.map((family) => family.trim()).filter(Boolean))];
  if (uniqueFamilies.length === 0) return [];
  const normalizedFamilies = uniqueFamilies.map((family) => family.toLowerCase());

  return prisma.$queryRaw<FontAssetRecord[]>(Prisma.sql`
    SELECT "id", "family", "weight", "fontStyle", "url", "storageKey", "originalName", "createdAt", "updatedAt"
    FROM "FontAsset"
    WHERE LOWER("family") IN (${Prisma.join(normalizedFamilies)})
    ORDER BY "weight" ASC
  `);
}

export async function upsertFontAsset(input: UpsertFontAssetInput): Promise<FontAssetRecord> {
  const weight = input.weight ?? 400;
  const fontStyle = input.fontStyle ?? "normal";
  const rows = await prisma.$queryRaw<FontAssetRecord[]>(Prisma.sql`
    INSERT INTO "FontAsset" ("id", "family", "weight", "fontStyle", "url", "storageKey", "originalName", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${input.family.trim()}, ${weight}, ${fontStyle}, ${input.url}, ${input.storageKey ?? null}, ${input.originalName ?? null}, NOW(), NOW())
    ON CONFLICT ("family", "weight", "fontStyle")
    DO UPDATE SET
      "url" = EXCLUDED."url",
      "storageKey" = EXCLUDED."storageKey",
      "originalName" = EXCLUDED."originalName",
      "updatedAt" = NOW()
    RETURNING "id", "family", "weight", "fontStyle", "url", "storageKey", "originalName", "createdAt", "updatedAt"
  `);

  return rows[0];
}

export async function getFontAssetById(id: string): Promise<FontAssetRecord | null> {
  const rows = await prisma.$queryRaw<FontAssetRecord[]>(Prisma.sql`
    SELECT "id", "family", "weight", "url", "storageKey", "originalName", "createdAt", "updatedAt"
    FROM "FontAsset"
    WHERE "id" = ${id}
    LIMIT 1
  `);

  return rows[0] ?? null;
}

export async function deleteFontAssetById(id: string): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM "FontAsset"
    WHERE "id" = ${id}
  `);
}

export async function syncLegacyPublicFonts(): Promise<FontAssetRecord[]> {
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  await mkdir(fontsDir, { recursive: true });
  let filenames: string[] = [];

  try {
    filenames = await readdir(fontsDir);
  } catch {
    return listFontAssets();
  }

  const captionsApiUrl = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";
  const remoteFontsByFilename = new Map<string, RemoteFontFile>();

  try {
    const res = await fetch(`${captionsApiUrl}/api/font-files`, {
      headers: { "x-internal-key": process.env.INTERNAL_API_KEY ?? "" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const data = await res.json() as { fonts?: RemoteFontFile[] };
      for (const remoteFont of data.fonts ?? []) {
        const filename = remoteFont.filename?.trim();
        if (!filename || !isSupportedFontFilename(filename)) continue;
        remoteFontsByFilename.set(filename.toLowerCase(), remoteFont);
      }
    }
  } catch {
    // Render-engine indisponible : on garde un fallback sur l'inférence locale.
  }

  let currentFonts = await listFontAssets();
  const fontsBySource = new Map<string, FontAssetRecord[]>();
  for (const font of currentFonts) {
    const sourceKey = getNormalizedSourceKey(font);
    if (!sourceKey) continue;
    const entries = fontsBySource.get(sourceKey) ?? [];
    entries.push(font);
    fontsBySource.set(sourceKey, entries);
  }

  for (const filename of filenames) {
    if (!isSupportedFontFilename(filename)) continue;

    const remoteFont = remoteFontsByFilename.get(filename.toLowerCase());
    const family = remoteFont?.family?.trim() || inferFontFamilyFromFilename(filename);
    const asset = await upsertFontAsset({
      family,
      weight: inferWeightFromFilename(filename),
      fontStyle: inferStyleFromFilename(filename),
      url: `/fonts/${filename}`,
      storageKey: `fonts/${filename}`,
      originalName: filename,
    });

    const sourceKey = filename.toLowerCase();
    const staleEntries = (fontsBySource.get(sourceKey) ?? []).filter((entry) => entry.id !== asset.id);
    if (staleEntries.length > 0) {
      await deleteFontAssetsByIds(staleEntries.map((entry) => entry.id));
    }
    fontsBySource.set(sourceKey, [asset]);
  }

  for (const remoteFont of remoteFontsByFilename.values()) {
    const family = remoteFont.family?.trim();
    const filename = remoteFont.filename?.trim();
    const url = remoteFont.url?.trim();
    if (!family || !filename || !url) continue;

    const sourceKey = filename.toLowerCase();
    const downloadUrl = `${captionsApiUrl}${url.startsWith("/") ? url : `/${url}`}`;
    const targetPath = path.join(fontsDir, filename);

    if (!(fontsBySource.get(sourceKey)?.length)) {
      try {
        const fileRes = await fetch(downloadUrl, {
          headers: { "x-internal-key": process.env.INTERNAL_API_KEY ?? "" },
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        if (!fileRes.ok) continue;

        const buffer = Buffer.from(await fileRes.arrayBuffer());
        await writeFile(targetPath, buffer);
      } catch {
        continue;
      }
    }

    const asset = await upsertFontAsset({
      family,
      weight: inferWeightFromFilename(filename),
      fontStyle: inferStyleFromFilename(filename),
      url: `/fonts/${filename}`,
      storageKey: `fonts/${filename}`,
      originalName: filename,
    });

    const staleEntries = (fontsBySource.get(sourceKey) ?? []).filter((entry) => entry.id !== asset.id);
    if (staleEntries.length > 0) {
      await deleteFontAssetsByIds(staleEntries.map((entry) => entry.id));
    }
    fontsBySource.set(sourceKey, [asset]);
  }

  currentFonts = await listFontAssets();
  return currentFonts;
}