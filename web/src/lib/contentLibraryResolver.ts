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
import { Prisma } from "@prisma/client";
import type {
  TemplateJSON, VideoBlock, MusicBlock, VideoSequenceSlot,
  MediaSelectionRule, MediaSelectionRuleConfig,
} from "@/types/template";

/** Normalize a MediaSelectionRule (legacy string or structured object) into a config. */
export function normalizeRule(rule: MediaSelectionRule | undefined): MediaSelectionRuleConfig {
  if (!rule) return { strategy: "least_used" };
  if (typeof rule === "string") return { strategy: rule };
  return rule;
}

/**
 * Resolve the effective tag for a rule (legacy: tagFilter / tagFilterParam).
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

/**
 * Build a Prisma.Sql WHERE fragment for all tag conditions in a rule config.
 * Returns an empty fragment if no conditions apply.
 * The fragment starts with AND when non-empty.
 * Assumes the MediaAsset table is aliased as `ma` in the calling query.
 */
function buildTagFragment(
  config: MediaSelectionRuleConfig,
  formData?: Record<string, unknown>,
): Prisma.Sql {
  const parts: Prisma.Sql[] = [];

  // Legacy path: no tagConditions → fall back to single tagFilter/tagFilterParam
  if (!config.tagConditions?.length && !config.igAccountFilter && !config.igAccountFilterParam) {
    const legacyTag = resolveTag(config, formData);
    if (legacyTag) {
      const likeVal = `%"${legacyTag}"%`;
      parts.push(Prisma.sql`lower(ma.tags) ILIKE ${likeVal}`);
    }
  }

  // tagConditions — each condition is an ILIKE (or NOT ILIKE) on ma.tags
  const condParts: Prisma.Sql[] = [];
  for (const c of config.tagConditions ?? []) {
    const rawTag = c.fromParam && formData
      ? (typeof formData[c.tag] === "string" ? (formData[c.tag] as string).trim() : "")
      : (c.tag ?? "").trim();
    if (!rawTag) continue;
    const likeVal = `%"${rawTag.toLowerCase()}"%`;
    if (c.negate) {
      condParts.push(Prisma.sql`NOT lower(ma.tags) ILIKE ${likeVal}`);
    } else {
      condParts.push(Prisma.sql`lower(ma.tags) ILIKE ${likeVal}`);
    }
  }
  if (condParts.length > 0) {
    const op = config.tagConditionsOperator === "OR" ? " OR " : " AND ";
    parts.push(
      condParts.length === 1
        ? condParts[0]!
        : Prisma.sql`(${Prisma.join(condParts, op)})`,
    );
  }

  // igAccountFilter — additional AND tag condition (IG handle stored as tag)
  const igTag =
    config.igAccountFilter?.trim() ||
    (config.igAccountFilterParam && formData
      ? typeof formData[config.igAccountFilterParam] === "string"
        ? (formData[config.igAccountFilterParam] as string).trim()
        : ""
      : "");
  if (igTag) {
    const likeVal = `%"${igTag.toLowerCase()}"%`;
    parts.push(Prisma.sql`lower(ma.tags) ILIKE ${likeVal}`);
  }

  if (parts.length === 0) return Prisma.sql``;
  return parts.length === 1
    ? Prisma.sql`AND ${parts[0]!}`
    : Prisma.sql`AND (${Prisma.join(parts, " AND ")})`;
}

/** Select the best asset from a MediaLibrary according to rule.
 * Respects MediaAssetAccess: with accountId → global OR accessible; without → global only.
 * Ordering uses per-account MediaAssetUsage when accountId is provided,
 * falling back to global MediaAsset counters otherwise.
 *
 * @param excludeAssetIds Optional set of asset IDs to skip (used when multiple blocks share the same library).
 * @public — also used by generateSequenceRender for slot resolution at render time.
 */
export async function selectMediaAsset(
  libraryId: string,
  rule: MediaSelectionRule | undefined,
  formData?: Record<string, unknown>,
  accountId?: string,
  excludeAssetIds?: string[],
  minDuration?: number,
): Promise<{ id: string; url: string; filename: string; metadata: Record<string, string | number | null> } | null> {
  const config = normalizeRule(rule);
  const { strategy } = config;

  if (strategy === "manual") return null;

  const tagFrag = buildTagFragment(config, formData);

  // Access filter: with accountId → global OR restricted-to-me; without → global only
  const accessFilter = accountId
    ? Prisma.sql`AND ma."disabled" = false
        AND (NOT EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id)
        OR EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id AND acc."accountId" = ${accountId}))`
    : Prisma.sql`AND ma."disabled" = false
        AND NOT EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id)`;

  // Exclusion filter: skip already-picked assets from sibling blocks in the same generation
  const excludeFrag =
    excludeAssetIds && excludeAssetIds.length > 0
      ? Prisma.sql`AND ma.id NOT IN (${Prisma.join(excludeAssetIds.map((id) => Prisma.sql`${id}`), ", ")})`
      : Prisma.sql``;

  // Duration filter: skip tracks shorter than the expected total video duration.
  // Assets with no duration stored are excluded when the filter is active — use the
  // backfill script (scripts/backfill-audio-durations.ts) to populate missing durations.
  const durationFrag =
    minDuration != null && minDuration > 0
      ? Prisma.sql`AND ma.duration >= ${minDuration}`
      : Prisma.sql``;

  type AssetRow = { id: string; url: string; filename: string; metadata: string };
  function parseAssetRow(row: AssetRow) {
    let metadata: Record<string, string | number | null> = {};
    try { metadata = JSON.parse(row.metadata ?? "{}") as Record<string, string | number | null>; } catch { /* keep empty */ }
    return { ...row, metadata };
  }

  if (strategy === "random") {
    const rows = await prisma.$queryRaw<AssetRow[]>(
      Prisma.sql`SELECT ma.id, ma.url, ma.filename, ma.metadata FROM "MediaAsset" ma
        WHERE ma."libraryId" = ${libraryId}
        ${accessFilter}
        ${tagFrag}
        ${excludeFrag}
        ${durationFrag}
        ORDER BY RANDOM() LIMIT 1`
    );
    return rows[0] ? parseAssetRow(rows[0]) : null;
  }

  if (strategy === "oldest_used") {
    if (accountId) {
      const rows = await prisma.$queryRaw<AssetRow[]>(
        Prisma.sql`SELECT ma.id, ma.url, ma.filename, ma.metadata FROM "MediaAsset" ma
          LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${accountId}
          WHERE ma."libraryId" = ${libraryId}
          ${accessFilter}
          ${tagFrag}
          ${excludeFrag}
          ${durationFrag}
          ORDER BY mau."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`
      );
      return rows[0] ? parseAssetRow(rows[0]) : null;
    }
    const rows = await prisma.$queryRaw<AssetRow[]>(
      Prisma.sql`SELECT ma.id, ma.url, ma.filename, ma.metadata FROM "MediaAsset" ma
        WHERE ma."libraryId" = ${libraryId}
        ${accessFilter}
        ${tagFrag}
        ${excludeFrag}
        ${durationFrag}
        ORDER BY ma."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`
    );
    return rows[0] ? parseAssetRow(rows[0]) : null;
  }

  // least_used (default) — also handles not_used_in_cycle (same ordering: never/least-used first)
  if (strategy !== "least_used" && strategy !== "not_used_in_cycle") {
    console.warn(`[selectMediaAsset] stratégie inconnue "${strategy}" — fallback sur least_used`);
  }
  if (accountId) {
    const rows = await prisma.$queryRaw<AssetRow[]>(
      Prisma.sql`SELECT ma.id, ma.url, ma.filename, ma.metadata FROM "MediaAsset" ma
        LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${accountId}
        WHERE ma."libraryId" = ${libraryId}
        ${accessFilter}
        ${tagFrag}
        ${excludeFrag}
        ${durationFrag}
        ORDER BY COALESCE(mau."usageCount", 0) ASC, mau."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`
    );
    return rows[0] ? parseAssetRow(rows[0]) : null;
  }
  const rows = await prisma.$queryRaw<AssetRow[]>(
    Prisma.sql`SELECT ma.id, ma.url, ma.filename, ma.metadata FROM "MediaAsset" ma
      WHERE ma."libraryId" = ${libraryId}
      ${accessFilter}
      ${tagFrag}
      ${excludeFrag}
      ${durationFrag}
      ORDER BY ma."usageCount" ASC, ma."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`
  );
  return rows[0] ? parseAssetRow(rows[0]) : null;
}

/**
 * Select an asset from a library by matching a metadata field value.
 *
 * Used when a SchemaField of type "select" has optionsSource.type === "metadata-values-from-library":
 * the user chose a value (e.g., "Dupont") from the dropdown, and this function finds the
 * corresponding asset in the library where metadata[metadataKey] === metadataValue.
 *
 * @returns The first matching active asset, or null if none found.
 */
export async function selectMediaAssetByMetadataValue(
  libraryId: string,
  metadataKey: string,
  metadataValue: string,
  accountId?: string,
): Promise<{ id: string; url: string; filename: string; setTag: string | null; category: string | null; metadata: Record<string, string | number | null> } | null> {
  const accessFilter = accountId
    ? Prisma.sql`AND ma."disabled" = false
        AND (NOT EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id)
        OR EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id AND acc."accountId" = ${accountId}))`
    : Prisma.sql`AND ma."disabled" = false
        AND NOT EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id)`;

  // Filter in PostgreSQL on the JSON metadata field: cast to text and use jsonb operator
  const rows = await prisma.$queryRaw<{ id: string; url: string; filename: string; setTag: string | null; category: string | null; metadata: string }[]>(
    Prisma.sql`SELECT ma.id, ma.url, ma.filename, ma."setTag", ma.category, ma.metadata FROM "MediaAsset" ma
      WHERE ma."libraryId" = ${libraryId}
      ${accessFilter}
      AND (ma.metadata::jsonb ->> ${metadataKey}) = ${metadataValue}
      ORDER BY ma."createdAt" ASC LIMIT 1`
  );

  if (!rows[0]) return null;
  let metadata: Record<string, string | number | null> = {};
  try { metadata = JSON.parse(rows[0].metadata ?? "{}") as Record<string, string | number | null>; } catch { /* keep empty */ }
  return { ...rows[0], metadata };
}

/**
 * Select an asset using the set_sequence strategy.
 *
 * @public — also used by generateSequenceRender for slot resolution at render time.
 *
 * **Auto mode** (setSequence empty or not set):
 *   1. Collect all distinct (category, setTag) groups eligible for this account.
 *      Eligible = global (no MediaAssetAccess rows) OR account-specific (has access entry for accountId).
 *      Without accountId = global-only pool.
 *   2. Exclude the lastUsedCategory group family (avoid consecutive same-category gens).
 *      If only one group exists, allow repeating it.
 *   3. Among candidates, pick the group with the oldest MAX per-account lastUsedAt
 *      (from MediaAssetUsage when accountId present, from MediaAsset.lastUsedAt otherwise).
 *   4. Within the chosen group, pick the asset with the oldest per-account lastUsedAt.
 *
 * **Override mode** (setSequence non-empty):
 *   Uses the integer cursor into the explicit ordered list (legacy behaviour).
 *
 * pinnedSetTag: if provided (2nd+ block sharing the same library in one generation),
 *   skip group discovery and pick from that specific group.
 */

/**
 * Snapshot of the cursor state BEFORE it was advanced, enabling a conditional revert
 * if the render subsequently fails.  See revertLibraryCursors() in recordLibraryUsage.ts.
 */
export type CursorRevertState = {
  /** cursor value BEFORE advance (override mode) */
  prevCursor: number;
  /** cursor value WE WROTE (override mode) — revert condition: cursor still equals this */
  claimedCursor: number;
  /** lastUsedCategory BEFORE we wrote (auto mode) */
  prevLastUsedCategory: string | null;
  /** lastUsedCategory WE WROTE (auto mode) — revert condition: lastUsedCategory still equals this */
  claimedLastUsedCategory: string | null;
};

export async function selectMediaAssetBySetSequence(
  libraryId: string,
  accountId: string | undefined,
  tagFilter?: string,          // kept for backward compat (ignored when ruleConfig provided)
  pinnedSetTag?: string,
  pinnedCategory?: string | null,
  ruleConfig?: MediaSelectionRuleConfig,
): Promise<{ id: string; url: string; filename: string; resolvedSetTag: string | null; resolvedCategory: string | null; prevCursorState?: CursorRevertState } | null> {
  const library = await prisma.mediaLibrary.findUnique({
    where: { id: libraryId },
    select: { setSequence: true },
  });
  if (!library) return null;

  let sequence: string[] = [];
  try { sequence = (JSON.parse(library.setSequence) as string[]).filter((s) => !!s); } catch { sequence = []; }

  // Build tag fragment: prefer structured ruleConfig, fall back to legacy tagFilter string
  const tagFrag: Prisma.Sql = ruleConfig
    ? buildTagFragment(ruleConfig)
    : tagFilter
      ? Prisma.sql`AND lower(ma.tags) ILIKE ${`%"${tagFilter.toLowerCase()}"%`}`
      : Prisma.sql``;

  type AssetRow = { id: string; url: string; filename: string };

  // Helper: pick one asset from a specific (setTag, category) group.
  // Applies access filtering and per-account usage ordering.
  // setTag=null + category non-null = category-only group (guaranteed by group discovery).
  async function pickFromGroup(setTag: string | null, category: string | null): Promise<AssetRow | null> {
    const setTagClause = setTag !== null
      ? Prisma.sql`AND ma."setTag" = ${setTag}`
      : Prisma.sql`AND ma."setTag" IS NULL`;
    const categoryClause = category !== null
      ? Prisma.sql`AND ma."category" = ${category}`
      : Prisma.sql`AND ma."category" IS NULL`;

    if (accountId) {
      const rows = await prisma.$queryRaw<AssetRow[]>(Prisma.sql`
        SELECT ma.id, ma.url, ma.filename FROM "MediaAsset" ma
        LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${accountId}
        WHERE ma."libraryId" = ${libraryId}
          AND ma."disabled" = false
          ${setTagClause}
          ${categoryClause}
          ${tagFrag}
          AND (NOT EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id)
            OR EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id AND acc."accountId" = ${accountId}))
        ORDER BY mau."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`);
      return rows[0] ?? null;
    } else {
      const rows = await prisma.$queryRaw<AssetRow[]>(Prisma.sql`
        SELECT ma.id, ma.url, ma.filename FROM "MediaAsset" ma
        WHERE ma."libraryId" = ${libraryId}
          AND ma."disabled" = false
          ${setTagClause}
          ${categoryClause}
          ${tagFrag}
          AND NOT EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id)
        ORDER BY ma."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`);
      return rows[0] ?? null;
    }
  }

  // --- Pinned group (2nd+ block within same library group in one generation) ---
  if (pinnedSetTag !== undefined) {
    const row = await pickFromGroup(pinnedSetTag, pinnedCategory ?? null);
    return row ? { ...row, resolvedSetTag: pinnedSetTag, resolvedCategory: pinnedCategory ?? null } : null;
  }

  // --- Override mode: setSequence explicitly defined → use cursor ---
  if (sequence.length > 0) {
    if (accountId) {
      // SELECT FOR UPDATE: advance cursor at prefill time so concurrent cron generations
      // each claim a distinct position in the set list before any render finishes.
      let selectedSetTag: string | undefined;
      let prevCursorState: CursorRevertState | undefined;
      await prisma.$transaction(async (tx) => {
        // Ensure row exists before locking
        await tx.accountLibraryCursor.upsert({
          where: { accountId_libraryId: { accountId, libraryId } },
          update: {},
          create: { accountId, libraryId, cursor: 0 },
        });
        const locked = await tx.$queryRaw<{ cursor: number; lastUsedCategory: string | null }[]>(
          Prisma.sql`SELECT cursor, "lastUsedCategory" FROM "AccountLibraryCursor" WHERE "accountId" = ${accountId} AND "libraryId" = ${libraryId} FOR UPDATE`,
        );
        const current = locked[0]?.cursor ?? 0;
        const prevLastUsedCat = locked[0]?.lastUsedCategory ?? null;
        selectedSetTag = sequence[current % sequence.length];
        if (!selectedSetTag) return;
        const nextCursor = (current + 1) % sequence.length;
        // Snapshot BEFORE writing so we can conditionally revert on render failure.
        // Override mode never touches lastUsedCategory, so claimedLastUsedCategory = prevLastUsedCat
        // (the WHERE condition in the revert will still fire only if nothing else changed it).
        prevCursorState = { prevCursor: current, claimedCursor: nextCursor, prevLastUsedCategory: prevLastUsedCat, claimedLastUsedCategory: prevLastUsedCat };
        await tx.accountLibraryCursor.update({
          where: { accountId_libraryId: { accountId, libraryId } },
          data: { cursor: nextCursor, lastUsedSetTag: selectedSetTag, lastAdvancedAt: new Date() },
        });
      });
      if (!selectedSetTag) return null;
      // Asset selection outside the transaction — set position is already committed
      const rows = await prisma.$queryRaw<AssetRow[]>(Prisma.sql`
        SELECT ma.id, ma.url, ma.filename FROM "MediaAsset" ma
        LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${accountId}
        WHERE ma."libraryId" = ${libraryId} AND ma."setTag" = ${selectedSetTag}
          AND ma."disabled" = false
          ${tagFrag}
          AND (NOT EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id)
            OR EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id AND acc."accountId" = ${accountId}))
        ORDER BY mau."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`);
      const row = rows[0] ?? null;
      if (!row && prevCursorState) {
        // No assets are eligible for selectedSetTag — immediately revert the cursor advance
        // so this set position is not permanently skipped in future generations.
        await prisma.$executeRaw(Prisma.sql`
          UPDATE "AccountLibraryCursor"
          SET cursor = ${prevCursorState.prevCursor}
          WHERE "accountId" = ${accountId}
            AND "libraryId" = ${libraryId}
            AND cursor IS NOT DISTINCT FROM ${prevCursorState.claimedCursor}
            AND "lastUsedCategory" IS NOT DISTINCT FROM ${prevCursorState.claimedLastUsedCategory}
        `).catch((e) => {
          console.warn(`[selectMediaAssetBySetSequence] cursor revert failed account=${accountId} library=${libraryId}:`, e);
        });
        console.warn(`[selectMediaAssetBySetSequence] No eligible assets for setTag=${selectedSetTag} library=${libraryId} — cursor reverted to ${prevCursorState.prevCursor}`);
      }
      return row ? { ...row, resolvedSetTag: selectedSetTag, resolvedCategory: null, prevCursorState } : null;
    } else {
      // No accountId (admin preview): position 0, no lock needed
      const selectedSetTag = sequence[0];
      if (!selectedSetTag) return null;
      const rows = await prisma.$queryRaw<AssetRow[]>(Prisma.sql`
        SELECT ma.id, ma.url, ma.filename FROM "MediaAsset" ma
        WHERE ma."libraryId" = ${libraryId} AND ma."setTag" = ${selectedSetTag}
          AND ma."disabled" = false
          ${tagFrag}
          AND NOT EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id)
        ORDER BY ma."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`);
      const row = rows[0] ?? null;
      return row ? { ...row, resolvedSetTag: selectedSetTag, resolvedCategory: null } : null;
    }
  }

  // --- Auto mode: group by (category, setTag), exclude last used category ---
  type GroupRow = { setTag: string | null; category: string | null };

  if (accountId) {
    // SELECT FOR UPDATE: write lastUsedCategory at prefill time so concurrent cron
    // generations block on the lock, then read the updated category and pick a different
    // family — preventing duplicate content across back-to-back auto generations.
    let resultRow: AssetRow | null = null;
    let resultSetTag: string | null = null;
    let resultCategory: string | null = null;
    let prevCursorState: CursorRevertState | undefined;

    await prisma.$transaction(async (tx) => {
      // Ensure cursor row exists before locking
      await tx.accountLibraryCursor.upsert({
        where: { accountId_libraryId: { accountId, libraryId } },
        update: {},
        create: { accountId, libraryId, cursor: 0 },
      });
      // Lock cursor row and read lastUsedCategory atomically
      const locked = await tx.$queryRaw<{ lastUsedCategory: string | null }[]>(
        Prisma.sql`SELECT "lastUsedCategory" FROM "AccountLibraryCursor" WHERE "accountId" = ${accountId} AND "libraryId" = ${libraryId} FOR UPDATE`,
      );
      const lockedCategory = locked[0]?.lastUsedCategory ?? null;

      // Group discovery inside the transaction.
      // Primary sort: category-level staleness (MAX last_used across all sets in the category)
      // → ensures categories rotate round-robin before cycling within a category.
      // Secondary sort: set-level staleness (last_used of this specific group)
      // → within a category, oldest set comes first.
      // Tertiary: stable alphabetical tiebreaker.
      const allGroups: GroupRow[] = await tx.$queryRaw`
          SELECT sub2."setTag", sub2."category"
          FROM (
            SELECT sub1."setTag", sub1."category", sub1.last_used,
                   MAX(sub1.last_used) OVER (PARTITION BY sub1."category") AS cat_last_used
            FROM (
              SELECT ma."setTag", ma."category",
                     MAX(mau."lastUsedAt") AS last_used
              FROM "MediaAsset" ma
              LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${accountId}
              WHERE ma."libraryId" = ${libraryId} AND (ma."setTag" IS NOT NULL OR ma."category" IS NOT NULL)
                AND ma."disabled" = false
                AND (NOT EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id)
                  OR EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id AND acc."accountId" = ${accountId}))
              GROUP BY ma."setTag", ma."category"
            ) sub1
          ) sub2
          ORDER BY sub2.cat_last_used ASC NULLS FIRST, sub2.last_used ASC NULLS FIRST,
                   CASE WHEN sub2."setTag" ~ '^[0-9]+$' THEN LPAD(sub2."setTag", 20, '0') ELSE sub2."setTag" END ASC NULLS LAST,
                   sub2."category" ASC NULLS FIRST`;

      if (allGroups.length === 0) return; // handled by fallback below

      const eligible = lockedCategory != null
        ? allGroups.filter((g) => g.category !== lockedCategory)
        : allGroups;
      const candidates = eligible.length > 0 ? eligible : allGroups;

      for (const candidate of candidates) {
        // Inline pickFromGroup using the transaction client
        const setTagClause = candidate.setTag !== null
          ? Prisma.sql`AND ma."setTag" = ${candidate.setTag}`
          : Prisma.sql`AND ma."setTag" IS NULL`;
        const categoryClause = candidate.category !== null
          ? Prisma.sql`AND ma."category" = ${candidate.category}`
          : Prisma.sql`AND ma."category" IS NULL`;
        const rows = await tx.$queryRaw<AssetRow[]>(Prisma.sql`
          SELECT ma.id, ma.url, ma.filename FROM "MediaAsset" ma
          LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${accountId}
          WHERE ma."libraryId" = ${libraryId}
            AND ma."disabled" = false
            ${setTagClause}
            ${categoryClause}
            ${tagFrag}
            AND (NOT EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id)
              OR EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id AND acc."accountId" = ${accountId}))
          ORDER BY mau."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`);
        if (rows[0]) {
          resultRow = rows[0];
          resultSetTag = candidate.setTag;
          resultCategory = candidate.category;
          // Snapshot BEFORE writing so we can conditionally revert on render failure
          prevCursorState = { prevCursor: 0, claimedCursor: 0, prevLastUsedCategory: lockedCategory, claimedLastUsedCategory: candidate.category };
          // Write lastUsedCategory immediately — the next generator waiting on FOR UPDATE
          // will see this value and exclude this category family.
          await tx.accountLibraryCursor.update({
            where: { accountId_libraryId: { accountId, libraryId } },
            data: {
              lastUsedSetTag: candidate.setTag,
              lastUsedCategory: candidate.category,
              lastAdvancedAt: new Date(),
            },
          });
          return; // commit
        }
      }
    });

    if (resultRow) {
      return { ...(resultRow as AssetRow), resolvedSetTag: resultSetTag, resolvedCategory: resultCategory, prevCursorState };
    }
    // allGroups was empty — fallback: any asset from eligible pool
    const fallbackRows = await prisma.$queryRaw<AssetRow[]>(Prisma.sql`
      SELECT ma.id, ma.url, ma.filename FROM "MediaAsset" ma
      LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${accountId}
      WHERE ma."libraryId" = ${libraryId}
        AND ma."disabled" = false
        ${tagFrag}
        AND (NOT EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id)
          OR EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id AND acc."accountId" = ${accountId}))
      ORDER BY mau."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`);
    return fallbackRows[0] ? { ...fallbackRows[0], resolvedSetTag: null, resolvedCategory: null } : null;
  }

  // No accountId (admin preview): no lock, no cursor writes, global pool only.
  // Same two-level sort as the accountId path: category-level staleness first, set-level second.
  const allGroups: GroupRow[] = await prisma.$queryRaw`
      SELECT sub2."setTag", sub2."category"
      FROM (
        SELECT sub1."setTag", sub1."category", sub1.last_used,
               MAX(sub1.last_used) OVER (PARTITION BY sub1."category") AS cat_last_used
        FROM (
          SELECT "setTag", "category",
                 MAX("lastUsedAt") AS last_used
          FROM "MediaAsset"
          WHERE "libraryId" = ${libraryId} AND ("setTag" IS NOT NULL OR "category" IS NOT NULL)
            AND "disabled" = false
            AND NOT EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = id)
          GROUP BY "setTag", "category"
        ) sub1
      ) sub2
      ORDER BY sub2.cat_last_used ASC NULLS FIRST, sub2.last_used ASC NULLS FIRST,
               CASE WHEN sub2."setTag" ~ '^[0-9]+$' THEN LPAD(sub2."setTag", 20, '0') ELSE sub2."setTag" END ASC NULLS LAST,
               sub2."category" ASC NULLS FIRST`;

  if (allGroups.length === 0) {
    const rows = await prisma.$queryRaw<AssetRow[]>(Prisma.sql`
      SELECT ma.id, ma.url, ma.filename FROM "MediaAsset" ma
      WHERE ma."libraryId" = ${libraryId}
        AND ma."disabled" = false
        ${tagFrag}
        AND NOT EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id)
      ORDER BY ma."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`);
    return rows[0] ? { ...rows[0], resolvedSetTag: null, resolvedCategory: null } : null;
  }

  // No category exclusion without accountId (no per-account cursor)
  for (const candidate of allGroups) {
    const row = await pickFromGroup(candidate.setTag, candidate.category);
    if (row) {
      return { ...row, resolvedSetTag: candidate.setTag, resolvedCategory: candidate.category };
    }
  }
  return null;
}

/**
 * Resolve library pre-fill suggestions for a template.
 *
 * @param template   The parsed TemplateJSON.
 * @param formData   Optional: already-known form values. Used to resolve tagFilterParam rules.
 * @param accountId  Optional: Instagram account ID — required for set_sequence blocks.
 */
export async function resolveLibraryPrefill(
  template: TemplateJSON,
  formData?: Record<string, unknown>,
  accountId?: string,
): Promise<LibraryPrefill> {
  const result: LibraryPrefill = {
    videoSuggestions: {},
    audioSuggestion: null,
    dataSuggestion: null,
    setSequencedLibraryIds: [],
    usedSetTagByLibrary: {},
    usedCategoryByLibrary: {},
    prevCursorStateByLibrary: {},
    prevDataEntryState: undefined,
  };

  // --- Video blocks ---
  const videoBlocks = template.blocks.filter(
    (b): b is VideoBlock => b.type === "video" && !!b.libraryId,
  );

  const regularBlocks = videoBlocks.filter(
    (b) => normalizeRule(b.selectionRule).strategy !== "theme_sequence",
  );
  const sequenceBlocks = videoBlocks.filter(
    (b) => normalizeRule(b.selectionRule).strategy === "theme_sequence",
  );

  // --- VideoSequence slots (template-level sequence mode) ---
  // In sequence mode the libraryId lives on the slot, not on the VideoBlock.
  // We resolve these the same way as regular/sequence blocks but keyed by slot.id.
  const seqSlots: VideoSequenceSlot[] = (template.videoSequence ?? []).filter(
    (s): s is VideoSequenceSlot & { libraryId: string } => !!s.libraryId,
  );

  const regularSeqSlots = seqSlots.filter(
    (s) => normalizeRule(s.selectionRule).strategy !== "theme_sequence",
  );
  const themeSeqSlots = seqSlots.filter(
    (s) => normalizeRule(s.selectionRule).strategy === "theme_sequence",
  );

  // --- Batch-load rotationScope for all used libraries ---
  // When rotationScope === "shared", we omit accountId so the resolver uses the
  // global cursor/ordering (all accounts see the same rotation state).
  const allLibraryIds = [
    ...videoBlocks.map((b) => b.libraryId!),
    ...seqSlots.map((s) => s.libraryId!),
  ].filter((id, i, a) => a.indexOf(id) === i);

  const libScopeMap = new Map<string, string>();
  if (allLibraryIds.length > 0) {
    const libs = await prisma.mediaLibrary.findMany({
      where: { id: { in: allLibraryIds } },
      select: { id: true, rotationScope: true },
    });
    for (const lib of libs) libScopeMap.set(lib.id, lib.rotationScope ?? "per_account");
  }

  /** Returns accountId for per-account libraries, undefined for shared ones. */
  function effectiveAccountId(libId: string): string | undefined {
    return libScopeMap.get(libId) === "shared" ? undefined : accountId;
  }

  // Regular blocks: group by libraryId and resolve serially within each group so that
  // multiple blocks bound to the same library receive distinct assets.
  // Blocks bound to different libraries are still resolved in parallel.
  const regularByLibrary = new Map<string, VideoBlock[]>();
  for (const b of regularBlocks) {
    const key = b.libraryId!;
    if (!regularByLibrary.has(key)) regularByLibrary.set(key, []);
    regularByLibrary.get(key)!.push(b);
  }
  await Promise.all(
    Array.from(regularByLibrary.entries()).map(async ([, blocks]) => {
      const pickedIds: string[] = [];
      for (const b of blocks) {
        const suggestion = await selectMediaAsset(
          b.libraryId!,
          b.selectionRule,
          formData,
          effectiveAccountId(b.libraryId!),
          pickedIds.length > 0 ? pickedIds : undefined,
        );
        if (suggestion) {
          result.videoSuggestions[b.id] = suggestion;
          pickedIds.push(suggestion.id);
        }
      }
    }),
  );

  // Set_sequence blocks: group by libraryId so paired blocks (intro+outro)
  // receive the same set. First block in each library discovers the set (via cursor),
  // subsequent blocks in the same library receive it pinned.
  // accountId is optional: without it we still return a suggestion using global ordering;
  // cursor advancement is skipped (recordLibraryUsage requires accountId for that).
  if (sequenceBlocks.length > 0) {
    const groups = new Map<string, VideoBlock[]>();
    for (const b of sequenceBlocks) {
      const key = b.libraryId!;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(b);
      if (!result.setSequencedLibraryIds!.includes(key)) {
        result.setSequencedLibraryIds!.push(key);
      }
    }

    await Promise.all(
      Array.from(groups.entries()).map(async ([libId, blocks]) => {
        let pinnedSetTag: string | undefined = undefined;
        let pinnedCategory: string | null | undefined = undefined;
        for (const b of blocks) {
          const rule = normalizeRule(b.selectionRule);
          const suggestion = await selectMediaAssetBySetSequence(
            libId,
            effectiveAccountId(libId),
            undefined,
            pinnedSetTag,
            pinnedCategory,
            rule,
          );
          if (suggestion) {
            result.videoSuggestions[b.id] = {
              id: suggestion.id,
              url: suggestion.url,
              filename: suggestion.filename,
            };
            if (pinnedSetTag === undefined) {
              if (suggestion.resolvedSetTag) {
                pinnedSetTag = suggestion.resolvedSetTag;
                pinnedCategory = suggestion.resolvedCategory;
                result.usedSetTagByLibrary![libId] = suggestion.resolvedSetTag;
              }
              if (suggestion.resolvedCategory != null) {
                result.usedCategoryByLibrary![libId] = suggestion.resolvedCategory;
              }
              // Capture cursor snapshot for failure-recovery revert (only first block per library)
              if (suggestion.prevCursorState) {
                result.prevCursorStateByLibrary![libId] = suggestion.prevCursorState;
              }
            }
          }
        }
      }),
    );
  }

  // --- VideoSequence slots: regular strategies ---
  if (regularSeqSlots.length > 0) {
    const regularSlotsByLibrary = new Map<string, typeof regularSeqSlots>();
    for (const s of regularSeqSlots) {
      const key = s.libraryId!;
      if (!regularSlotsByLibrary.has(key)) regularSlotsByLibrary.set(key, []);
      regularSlotsByLibrary.get(key)!.push(s);
    }
    await Promise.all(
      Array.from(regularSlotsByLibrary.entries()).map(async ([, slots]) => {
        const pickedIds: string[] = [];
        for (const s of slots) {
          const suggestion = await selectMediaAsset(
            s.libraryId!,
            s.selectionRule,
            formData,
            effectiveAccountId(s.libraryId!),
            pickedIds.length > 0 ? pickedIds : undefined,
          );
          if (suggestion) {
            result.videoSuggestions[s.id] = suggestion;
            pickedIds.push(suggestion.id);
          }
        }
      }),
    );
  }

  // --- VideoSequence slots: theme_sequence strategy ---
  if (themeSeqSlots.length > 0) {
    const groups = new Map<string, typeof themeSeqSlots>();
    for (const s of themeSeqSlots) {
      const key = s.libraryId!;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
      if (!result.setSequencedLibraryIds!.includes(key)) {
        result.setSequencedLibraryIds!.push(key);
      }
    }
    await Promise.all(
      Array.from(groups.entries()).map(async ([libId, slots]) => {
        let pinnedSetTag: string | undefined = undefined;
        let pinnedCategory: string | null | undefined = undefined;
        for (const s of slots) {
          const rule = normalizeRule(s.selectionRule);
          const suggestion = await selectMediaAssetBySetSequence(
            libId,
            effectiveAccountId(libId),
            undefined,
            pinnedSetTag,
            pinnedCategory,
            rule,
          );
          if (suggestion) {
            result.videoSuggestions[s.id] = {
              id: suggestion.id,
              url: suggestion.url,
              filename: suggestion.filename,
            };
            if (pinnedSetTag === undefined) {
              if (suggestion.resolvedSetTag) {
                pinnedSetTag = suggestion.resolvedSetTag;
                pinnedCategory = suggestion.resolvedCategory;
                result.usedSetTagByLibrary![libId] = suggestion.resolvedSetTag;
              }
              if (suggestion.resolvedCategory != null) {
                result.usedCategoryByLibrary![libId] = suggestion.resolvedCategory;
              }
              if (suggestion.prevCursorState) {
                result.prevCursorStateByLibrary![libId] = suggestion.prevCursorState;
              }
            }
          }
        }
      }),
    );
  }

  // --- Music blocks (first with a libraryId) ---
  // Resolved after all video slots so we can estimate total video duration and skip
  // tracks that are too short.
  const musicBlock = template.blocks.find(
    (b): b is MusicBlock => b.type === "music" && !!b.libraryId,
  );
  if (musicBlock?.libraryId) {
    // Estimate total video duration from all picked video assets (library-sourced only).
    // Assets with no stored duration are treated as 0 for the estimate — safe to be
    // conservative. If all durations are unknown the filter is skipped (minDuration = 0).
    let estimatedVideoDuration = 0;
    const pickedVideoIds = Object.values(result.videoSuggestions).map((s) => s.id);
    if (pickedVideoIds.length > 0) {
      const durations = await prisma.mediaAsset.findMany({
        where: { id: { in: pickedVideoIds } },
        select: { duration: true },
      });
      estimatedVideoDuration = durations.reduce((sum, a) => sum + (a.duration ?? 0), 0);
    }

    // Skip the duration filter when the track loops — any length works.
    const audioMinDuration =
      !musicBlock.loop && estimatedVideoDuration > 0 ? estimatedVideoDuration : undefined;
    result.audioSuggestion = await selectMediaAsset(
      musicBlock.libraryId,
      musicBlock.audioSelectionRule,
      formData,
      effectiveAccountId(musicBlock.libraryId),
      undefined,
      audioMinDuration,
    );
  }

  // --- Data library ---
  if (template.contentLibrary?.dataCampaignId) {
    const dataSuggestion = await selectDataEntry(
      template.contentLibrary.dataCampaignId,
      template.contentLibrary.dataSelectionRule,
      accountId,
    );
    if (dataSuggestion) {
      result.dataSuggestion = { entryId: dataSuggestion.entryId, fields: dataSuggestion.fields };
      if (dataSuggestion.claimState) {
        result.prevDataEntryState = dataSuggestion.claimState;
      }
    }
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
  /**
   * Libraries that used set_sequence for this prefill.
   * Passed through usedAssets so recordLibraryUsage can advance cursor += 1.
   */
  setSequencedLibraryIds?: string[];
  /**
   * libraryId → resolved setTag used in this generation.
   * Stored in Render.usedAssets so recordLibraryUsage can persist lastUsedSetTag.
   */
  usedSetTagByLibrary?: Record<string, string>;
  /**
   * libraryId → resolved category used in this generation.
   * Stored in Render.usedAssets so recordLibraryUsage can persist lastUsedCategory.
   */
  usedCategoryByLibrary?: Record<string, string>;
  /**
   * libraryId → cursor state snapshot taken at prefill time.
   * Passed through to Render.usedAssets so revertLibraryCursors() can roll back
   * the cursor if the render subsequently fails.
   */
  prevCursorStateByLibrary?: Record<string, CursorRevertState>;
  /**
   * DataEntry claim state taken at prefill time.
   * Passed through to Render.usedAssets so revertLibraryCursors() can release the
   * claim if the render subsequently fails.
   */
  prevDataEntryState?: DataEntryClaimState;
}

/**
 * Snapshot of the DataEntry claim state made at prefill time, enabling a conditional revert
 * if the render subsequently fails.  See revertLibraryCursors() in recordLibraryUsage.ts.
 *
 * claimType:
 *  "usedInCycle"     — we set DataEntry.usedInCycle=true (for "cycle" and "once_global" policies).
 *                      Revert: SET usedInCycle=false WHERE id=? AND usageCount=0
 *  "perAccountUsage" — we inserted DataEntryUsage(usageCount=0) as a claim for this account
 *                      (for "cycle_per_account" and "once_per_account").
 *                      Revert: DELETE DataEntryUsage WHERE entryId=? AND accountId=? AND usageCount=0
 */
export type DataEntryClaimState = {
  entryId: string;
  campaignId: string;
  usagePolicy: string;
  claimType: "usedInCycle" | "perAccountUsage";
  accountId?: string;
};

/** Select the best DataEntry from a campaign according to rule.
 * Respects DataEntryAccess: with accountId → global OR accessible; without → global only.
 * Ordering uses per-account DataEntryUsage when accountId is provided,
 * falling back to global DataEntry counters otherwise.
 * The campaign's `usagePolicy` field controls the hard/soft constraint:
 *   - "cycle"             : global not_used_in_cycle + fallback (default)
 *   - "cycle_per_account" : per-account not_used + fallback to least_used_by_account
 *   - "once_per_account"  : per-account hard limit — null when all used
 *   - "once_global"       : global hard limit — null when all used
 *   - "unlimited"         : no constraint, always least_used
 *
 * When accountId is provided and the policy supports it, the selected entry is
 * "claimed" atomically using SELECT … FOR UPDATE SKIP LOCKED so that concurrent
 * cron generations for the same account/campaign pick different entries.
 */
async function selectDataEntry(
  campaignId: string,
  rule: "not_used_in_cycle" | "least_used" | "manual" | undefined,
  accountId?: string,
): Promise<{ entryId: string; fields: Record<string, string>; claimState?: DataEntryClaimState } | null> {
  if (rule === "manual") return null;

  // Fetch campaign to read usagePolicy
  const campaign = await prisma.dataCampaign.findUnique({
    where: { id: campaignId },
    select: { usagePolicy: true },
  });
  if (!campaign) {
    console.warn(`[contentLibraryResolver] DataCampaign ${campaignId} introuvable — fallback usagePolicy="cycle"`);
  }
  const usagePolicy = (campaign?.usagePolicy ?? "cycle") as
    | "cycle"
    | "cycle_per_account"
    | "once_per_account"
    | "once_global"
    | "unlimited";

  // Access filter fragment (built once, used in all queries)
  const accessFilter = accountId
    ? Prisma.sql`AND (NOT EXISTS (SELECT 1 FROM "DataEntryAccess" dea WHERE dea."entryId" = de.id)
        OR EXISTS (SELECT 1 FROM "DataEntryAccess" dea WHERE dea."entryId" = de.id AND dea."accountId" = ${accountId}))`
    : Prisma.sql`AND NOT EXISTS (SELECT 1 FROM "DataEntryAccess" dea WHERE dea."entryId" = de.id)`;

  type EntryRow = { id: string; fields: string };

  // Helper: fetch one entry without locking (used for fallback paths and for !accountId cases)
  async function queryOne(extraWhere: Prisma.Sql, orderBy?: Prisma.Sql): Promise<EntryRow | null> {
    const order = orderBy ?? (accountId
      ? Prisma.sql`ORDER BY COALESCE(deu."usageCount", 0) ASC, deu."lastUsedAt" ASC NULLS FIRST, de."createdAt" ASC`
      : Prisma.sql`ORDER BY de."usageCount" ASC, de."lastUsedAt" ASC NULLS FIRST, de."createdAt" ASC`);
    if (accountId) {
      const rows = await prisma.$queryRaw<EntryRow[]>(
        Prisma.sql`SELECT de.id, de.fields FROM "DataEntry" de
          LEFT JOIN "DataEntryUsage" deu ON deu."entryId" = de.id AND deu."accountId" = ${accountId}
          WHERE de."campaignId" = ${campaignId}
          ${extraWhere}
          ${accessFilter}
          ${order}
          LIMIT 1`
      );
      return rows[0] ?? null;
    }
    const rows = await prisma.$queryRaw<EntryRow[]>(
      Prisma.sql`SELECT de.id, de.fields FROM "DataEntry" de
        WHERE de."campaignId" = ${campaignId}
        ${extraWhere}
        ${accessFilter}
        ${order}
        LIMIT 1`
    );
    return rows[0] ?? null;
  }

  let entry: EntryRow | null = null;
  let claimState: DataEntryClaimState | undefined;

  // -----------------------------------------------------------------------
  // "cycle" — global usedInCycle flag.
  // Claim: SET usedInCycle=true within the tx (FOR UPDATE SKIP LOCKED).
  // Concurrent crons skip the locked/claimed row and land on the next eligible one.
  // -----------------------------------------------------------------------
  if (usagePolicy === "cycle") {
    if (accountId) {
      await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<EntryRow[]>(Prisma.sql`
          SELECT de.id, de.fields FROM "DataEntry" de
          WHERE de."campaignId" = ${campaignId}
            AND de."usedInCycle" = false
            ${accessFilter}
          ORDER BY de."usageCount" ASC, de."lastUsedAt" ASC NULLS FIRST, de."createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`);
        if (rows[0]) {
          entry = rows[0];
          await tx.dataEntry.update({ where: { id: rows[0].id }, data: { usedInCycle: true } });
          claimState = { entryId: rows[0].id, campaignId, usagePolicy, claimType: "usedInCycle", accountId };
        } else {
          // Fallback: all used in this cycle — pick least used globally (no lock needed)
          const fallback = await tx.$queryRaw<EntryRow[]>(Prisma.sql`
            SELECT de.id, de.fields FROM "DataEntry" de
            WHERE de."campaignId" = ${campaignId}
              ${accessFilter}
            ORDER BY de."usageCount" ASC, de."lastUsedAt" ASC NULLS FIRST, de."createdAt" ASC
            LIMIT 1`);
          entry = fallback[0] ?? null;
          // No claim for fallback row — it's already been used in this cycle
        }
      });
    } else {
      // No accountId: unlocked global fallback
      entry = await queryOne(Prisma.sql`AND de."usedInCycle" = false`);
      if (!entry) entry = await queryOne(Prisma.sql``);
    }

  // -----------------------------------------------------------------------
  // "cycle_per_account" — per-account cycle via DataEntryUsage.
  // Primary: no usage row for this account.
  // Claim: INSERT DataEntryUsage(usageCount=0, lastUsedAt=now) — marks entry as claimed.
  // Fallback: restart cycle — pick from rows with usageCount >= 1 (genuinely used).
  // -----------------------------------------------------------------------
  } else if (usagePolicy === "cycle_per_account") {
    if (accountId) {
      await prisma.$transaction(async (tx) => {
        // Primary: entry never touched by this account
        const rows = await tx.$queryRaw<EntryRow[]>(Prisma.sql`
          SELECT de.id, de.fields FROM "DataEntry" de
          WHERE de."campaignId" = ${campaignId}
            AND NOT EXISTS (
              SELECT 1 FROM "DataEntryUsage" deu2
              WHERE deu2."entryId" = de.id AND deu2."accountId" = ${accountId}
            )
            ${accessFilter}
          ORDER BY de."createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`);
        if (rows[0]) {
          entry = rows[0];
          await tx.dataEntryUsage.create({
            data: { entryId: rows[0].id, accountId, usageCount: 0, lastUsedAt: new Date() },
          });
          claimState = { entryId: rows[0].id, campaignId, usagePolicy, claimType: "perAccountUsage", accountId };
        } else {
          // Fallback: cycle restart — pick from genuinely used entries (usageCount >= 1), least used first
          const fallback = await tx.$queryRaw<EntryRow[]>(Prisma.sql`
            SELECT de.id, de.fields FROM "DataEntry" de
            LEFT JOIN "DataEntryUsage" deu ON deu."entryId" = de.id AND deu."accountId" = ${accountId}
            WHERE de."campaignId" = ${campaignId}
              AND COALESCE(deu."usageCount", 0) >= 1
              ${accessFilter}
            ORDER BY deu."usageCount" ASC, deu."lastUsedAt" ASC NULLS FIRST, de."createdAt" ASC
            LIMIT 1`);
          entry = fallback[0] ?? null;
          // No claim for fallback — it's a cycle restart, DONE will just increment usageCount
        }
      });
    } else {
      entry = await queryOne(Prisma.sql``);
    }

  // -----------------------------------------------------------------------
  // "once_per_account" — hard per-account limit via DataEntryUsage.
  // Claim: same INSERT as cycle_per_account.
  // No fallback — returns null when exhausted for this account.
  // -----------------------------------------------------------------------
  } else if (usagePolicy === "once_per_account") {
    if (accountId) {
      await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<EntryRow[]>(Prisma.sql`
          SELECT de.id, de.fields FROM "DataEntry" de
          WHERE de."campaignId" = ${campaignId}
            AND NOT EXISTS (
              SELECT 1 FROM "DataEntryUsage" deu2
              WHERE deu2."entryId" = de.id AND deu2."accountId" = ${accountId}
                AND deu2."usageCount" > 0
            )
            ${accessFilter}
          ORDER BY de."createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`);
        if (rows[0]) {
          entry = rows[0];
          await tx.dataEntryUsage.upsert({
            where: { entryId_accountId: { entryId: rows[0].id, accountId } },
            update: { lastUsedAt: new Date() },
            create: { entryId: rows[0].id, accountId, usageCount: 0, lastUsedAt: new Date() },
          });
          claimState = { entryId: rows[0].id, campaignId, usagePolicy, claimType: "perAccountUsage", accountId };
        }
        // No fallback for once_per_account — null means exhausted
      });
    } else {
      entry = await queryOne(
        Prisma.sql`AND NOT EXISTS (SELECT 1 FROM "DataEntryUsage" deu2 WHERE deu2."entryId" = de.id AND deu2."usageCount" > 0)`
      );
    }

  // -----------------------------------------------------------------------
  // "once_global" — hard global limit via usageCount.
  // Claim: SET usedInCycle=true so concurrent queries see AND usedInCycle=false.
  // The filter includes AND usedInCycle=false as the claim sentinel.
  // Revert: SET usedInCycle=false WHERE usageCount=0.
  // -----------------------------------------------------------------------
  } else if (usagePolicy === "once_global") {
    if (accountId) {
      await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<EntryRow[]>(Prisma.sql`
          SELECT de.id, de.fields FROM "DataEntry" de
          WHERE de."campaignId" = ${campaignId}
            AND de."usageCount" = 0
            AND de."usedInCycle" = false
            ${accessFilter}
          ORDER BY de."createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`);
        if (rows[0]) {
          entry = rows[0];
          await tx.dataEntry.update({ where: { id: rows[0].id }, data: { usedInCycle: true } });
          claimState = { entryId: rows[0].id, campaignId, usagePolicy, claimType: "usedInCycle", accountId };
        }
        // No fallback for once_global — null means globally exhausted
      });
    } else {
      entry = await queryOne(Prisma.sql`AND de."usageCount" = 0 AND de."usedInCycle" = false`);
    }

  // -----------------------------------------------------------------------
  // "unlimited" — no constraint, always least used. No locking needed.
  // -----------------------------------------------------------------------
  } else {
    entry = await queryOne(Prisma.sql``);
  }

  if (!entry) return null;

  let fields: Record<string, string> = {};
  try {
    fields = JSON.parse(entry.fields) as Record<string, string>;
  } catch {
    fields = {};
  }

  return { entryId: entry.id, fields, claimState };
}
