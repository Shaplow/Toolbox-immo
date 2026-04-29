/**
 * contentLibraryResolver.ts
 *
 * Server-side helper: given a TemplateJSON, resolve which assets should be
 * pre-filled in the generation form based on each block's libraryId +
 * selectionRule, and the template-level dataLibrary config.
 *
 * Called in `generate/[templateId]/page.tsx` (server component) to populate
 * form default values. Does NOT write any usage — that happens on DONE.
 */

import { prisma } from "@/lib/prisma";
import type {
  TemplateJSON, VideoBlock, MusicBlock,
  MediaSelectionRule, MediaSelectionRuleConfig,
} from "@/types/template";

export interface LibraryPrefill {
  /** blockId → suggested asset */
  videoSuggestions: Record<string, { id: string; url: string; filename: string }>;
  /** Single audio asset suggestion (first MusicBlock with a libraryId) */
  audioSuggestion: { id: string; url: string; filename: string } | null;
  /** Parsed fields from the selected DataEntry */
  dataSuggestion: { entryId: string; fields: Record<string, string> } | null;
}

/** Normalize a MediaSelectionRule (legacy string or structured object) into a config. */
export function normalizeRule(rule: MediaSelectionRule | undefined): MediaSelectionRuleConfig {
  if (!rule) return { strategy: "least_used" };
  if (typeof rule === "string") return { strategy: rule };
  return rule;
}

/**
 * Resolve the effective tag for a rule, combining literal tagFilter and
 * dynamic tagFilterParam (looked up from formData).
 * tagFilter takes precedence over tagFilterParam if both are defined.
 */
function resolveTag(
  config: MediaSelectionRuleConfig,
  formData?: Record<string, unknown>,
): string | undefined {
  if (config.tagFilter?.trim()) return config.tagFilter.trim().toLowerCase();
  if (config.tagFilterParam && formData) {
    const v = formData[config.tagFilterParam];
    if (typeof v === "string" && v.trim()) return v.trim().toLowerCase();
  }
  return undefined;
}

/** Select the best asset from a MediaLibrary according to rule. */
async function selectMediaAsset(
  libraryId: string,
  rule: MediaSelectionRule | undefined,
  formData?: Record<string, unknown>,
): Promise<{ id: string; url: string; filename: string } | null> {
  const config = normalizeRule(rule);
  const { strategy } = config;

  if (strategy === "manual") return null;

  const tag = resolveTag(config, formData);

  // Prisma WHERE clause with optional case-insensitive tag filter.
  const tagWhere = tag
    ? { tags: { contains: `"${tag}"`, mode: "insensitive" as const } }
    : {};

  if (strategy === "random") {
    const count = await prisma.mediaAsset.count({ where: { libraryId, ...tagWhere } });
    if (count === 0) return null;
    const skip = Math.floor(Math.random() * count);
    const asset = await prisma.mediaAsset.findFirst({
      where: { libraryId, ...tagWhere },
      skip,
    });
    return asset ? { id: asset.id, url: asset.url, filename: asset.filename } : null;
  }

  if (strategy === "oldest_used") {
    // ORDER BY lastUsedAt ASC NULLS FIRST — Prisma doesn't expose NULLS FIRST natively.
    if (tag) {
      const rows = await prisma.$queryRaw<{ id: string; url: string; filename: string }[]>`
        SELECT id, url, filename
        FROM "MediaAsset"
        WHERE "libraryId" = ${libraryId}
          AND lower(tags) ILIKE ${`%"${tag}"%`}
        ORDER BY "lastUsedAt" ASC NULLS FIRST, "createdAt" ASC
        LIMIT 1
      `;
      return rows[0] ?? null;
    }
    const rows = await prisma.$queryRaw<{ id: string; url: string; filename: string }[]>`
      SELECT id, url, filename
      FROM "MediaAsset"
      WHERE "libraryId" = ${libraryId}
      ORDER BY "lastUsedAt" ASC NULLS FIRST, "createdAt" ASC
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  // least_used (default)
  const asset = await prisma.mediaAsset.findFirst({
    where: { libraryId, ...tagWhere },
    orderBy: [{ usageCount: "asc" }, { lastUsedAt: "asc" }, { createdAt: "asc" }],
  });

  if (!asset) return null;
  return { id: asset.id, url: asset.url, filename: asset.filename };
}

/**
 * Resolve library pre-fill suggestions for a template.
 *
 * @param template  The parsed TemplateJSON.
 * @param formData  Optional: already-known form values (e.g. from URL params or
 *                  a regenerating listing). Used to resolve tagFilterParam rules.
 */
export async function resolveLibraryPrefill(
  template: TemplateJSON,
  formData?: Record<string, unknown>,
): Promise<LibraryPrefill> {
  const result: LibraryPrefill = {
    videoSuggestions: {},
    audioSuggestion: null,
    dataSuggestion: null,
  };

  // --- Video blocks ---
  const videoBlocks = template.blocks.filter(
    (b): b is VideoBlock => b.type === "video" && !!b.libraryId,
  );
  await Promise.all(
    videoBlocks.map(async (b) => {
      const suggestion = await selectMediaAsset(b.libraryId!, b.selectionRule, formData);
      if (suggestion) result.videoSuggestions[b.id] = suggestion;
    }),
  );

  // --- Music blocks (first with a libraryId) ---
  const musicBlock = template.blocks.find(
    (b): b is MusicBlock => b.type === "music" && !!b.libraryId,
  );
  if (musicBlock?.libraryId) {
    result.audioSuggestion = await selectMediaAsset(
      musicBlock.libraryId,
      musicBlock.audioSelectionRule,
      formData,
    );
  }

  // --- Data library ---
  if (template.contentLibrary?.dataCampaignId) {
    result.dataSuggestion = await selectDataEntry(
      template.contentLibrary.dataCampaignId,
      template.contentLibrary.dataSelectionRule,
    );
  }

  return result;
}


export interface LibraryPrefill {
  /** blockId → suggested asset */
  videoSuggestions: Record<string, { id: string; url: string; filename: string }>;
  /** Single audio asset suggestion (first MusicBlock with a libraryId) */
  audioSuggestion: { id: string; url: string; filename: string } | null;
  /** Parsed fields from the selected DataEntry */
  dataSuggestion: { entryId: string; fields: Record<string, string> } | null;
}

/** Select the best DataEntry from a campaign according to rule. */
async function selectDataEntry(
  campaignId: string,
  rule: "not_used_in_cycle" | "least_used" | "manual" | undefined,
): Promise<{ entryId: string; fields: Record<string, string> } | null> {
  if (rule === "manual") return null;

  let entry;
  if (rule === "not_used_in_cycle" || !rule) {
    // Prefer entries not yet used in current cycle, fallback to least used
    entry = await prisma.dataEntry.findFirst({
      where: { campaignId, usedInCycle: false },
      orderBy: [{ usageCount: "asc" }, { createdAt: "asc" }],
    });
    if (!entry) {
      // All used in cycle — fallback to least used overall
      entry = await prisma.dataEntry.findFirst({
        where: { campaignId },
        orderBy: [{ usageCount: "asc" }, { createdAt: "asc" }],
      });
    }
  } else {
    // least_used
    entry = await prisma.dataEntry.findFirst({
      where: { campaignId },
      orderBy: [{ usageCount: "asc" }, { createdAt: "asc" }],
    });
  }

  if (!entry) return null;

  let fields: Record<string, string> = {};
  try {
    fields = JSON.parse(entry.fields) as Record<string, string>;
  } catch {
    fields = {};
  }

  return { entryId: entry.id, fields };
}
