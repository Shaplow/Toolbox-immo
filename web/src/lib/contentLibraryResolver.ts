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
import {
  SHARED_CURSOR_ACCOUNT_ID as SHARED_CURSOR_ACCOUNT_ID_FROM_SENTINELS,
  SHARED_DATA_CURSOR_ACCOUNT_ID as SHARED_DATA_CURSOR_ACCOUNT_ID_FROM_SENTINELS,
} from "@/lib/rotation/sentinels";

/** Minimal Prisma client interface accepted by selectMediaAsset — satisfied by both the
 *  module-level `prisma` instance and the `tx` callback client from $transaction. */
type PrismaQueryClient = Pick<typeof prisma, '$queryRaw'>;

/**
 * Construit le fragment SQL pour le filtre d'accès MediaAssetAccess +
 * disabled=false (toujours inclus). Toutes les queries de sélection d'asset
 * doivent passer par ce helper plutôt que d'inliner le SQL — sans ça, une
 * variante peut oublier le guard disabled=false (ce qui était le cas dans
 * selectMediaAssetBySetSequence avant W3.1 → un asset disabled pouvait
 * apparaître dans les group listings).
 *
 * Sémantique :
 *   - accountId présent : asset accessible si AUCUNE ligne MediaAssetAccess
 *     existe (= public lib) OU si une ligne pour ce accountId existe.
 *   - accountId absent (admin preview) : seulement les assets sans accès
 *     restrictif (pool global, pas d'accès account-specific).
 *
 * Notes :
 *   - `ma` est l'alias attendu pour MediaAsset dans la query appelante.
 *   - Le helper retourne du SQL préfixé `AND` — à concaténer après un WHERE.
 */
function buildAccessFilter(accountId: string | undefined): Prisma.Sql {
  return accountId
    ? Prisma.sql`AND ma."disabled" = false
        AND (NOT EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id)
        OR EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id AND acc."accountId" = ${accountId}))`
    : Prisma.sql`AND ma."disabled" = false
        AND NOT EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id)`;
}

/**
 * Variante DataEntry du buildAccessFilter — utilise la table DataEntryAccess
 * et l'alias `de` pour DataEntry. Pas de `disabled` sur DataEntry (toutes les
 * entries actives sont éligibles tant qu'elles passent le burn filter).
 */
/**
 * W5.18 — ORDER BY commune à toutes les SQL group-discovery (7 callsites).
 * Sans ça, un changement de la stratégie de tri (ex: ajout d'un tiebreaker)
 * devait être propagé 7×. Le LPAD numérique a été aligné Media↔Data en W3.1 ;
 * cette constante prévient toute future divergence.
 */
const GROUP_DISCOVERY_ORDER_BY = Prisma.sql`
  ORDER BY sub2.cat_last_used ASC NULLS FIRST, sub2.last_used ASC NULLS FIRST,
           sub2.group_created_at ASC NULLS LAST,
           CASE WHEN sub2."setTag" ~ '^[0-9]+$' THEN LPAD(sub2."setTag", 20, '0') ELSE sub2."setTag" END ASC NULLS LAST,
           sub2."category" ASC NULLS FIRST`;

function buildDataAccessFilter(accountId: string | undefined): Prisma.Sql {
  return accountId
    ? Prisma.sql`AND (NOT EXISTS (SELECT 1 FROM "DataEntryAccess" dea WHERE dea."entryId" = de.id)
        OR EXISTS (SELECT 1 FROM "DataEntryAccess" dea WHERE dea."entryId" = de.id AND dea."accountId" = ${accountId}))`
    : Prisma.sql`AND NOT EXISTS (SELECT 1 FROM "DataEntryAccess" dea WHERE dea."entryId" = de.id)`;
}

/**
 * Bug-hunter #3 (2026-06-01) — burn-once race fix.
 *
 * Atomique : SELECT FOR UPDATE SKIP LOCKED + claim immédiat (insert
 * MediaAssetUsage avec usageCount=0 si accountId, sinon increment
 * MediaAsset.usageCount=1) dans la même transaction. Garantit que 2
 * renders concurrents ne peuvent pas picker le même asset quand
 * maxUsageCount est set.
 *
 * Caller : à utiliser par les paths qui font du `least_used` strict avec
 * burn-once (api/renders POST notamment). Les paths read-only/preview
 * continuent à utiliser `selectMediaAsset` (pas de claim, pas de lock).
 */
export async function selectAndClaimMediaAsset(
  libraryId: string,
  rule: MediaSelectionRule | undefined,
  formData?: Record<string, unknown>,
  accountId?: string,
  excludeAssetIds?: string[],
  minDuration?: number,
): Promise<{ id: string; url: string; filename: string; metadata: Record<string, string | number | null> } | null> {
  return prisma.$transaction(async (tx) => {
    // SELECT FOR UPDATE SKIP LOCKED via raw query — le lock est posé
    // jusqu'au commit/rollback de cette transaction. Un 2e concurrent
    // sur le même asset saute via SKIP LOCKED et picke le suivant.
    const picked = await selectMediaAssetWithLock({
      tx,
      libraryId,
      rule,
      formData,
      accountId,
      excludeAssetIds,
      minDuration,
    });
    if (!picked) return null;

    // Claim immédiat : marque l'asset comme "déjà pris" pour les
    // concurrents qui attendent l'unlock (post-commit). Pour per_account :
    // upsert MediaAssetUsage avec lastUsedAt=now. Pour shared :
    // increment MediaAsset.usageCount.
    if (accountId) {
      await tx.mediaAssetUsage.upsert({
        where: { assetId_accountId: { assetId: picked.id, accountId } },
        create: {
          assetId: picked.id,
          accountId,
          usageCount: 1,
          lastUsedAt: new Date(),
        },
        update: {
          usageCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
      });
    } else {
      await tx.mediaAsset.update({
        where: { id: picked.id },
        data: {
          usageCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
      });
    }

    return picked;
  });
}

/** Internal : SELECT with FOR UPDATE SKIP LOCKED, scoped to a tx. */
async function selectMediaAssetWithLock(args: {
  tx: Prisma.TransactionClient;
  libraryId: string;
  rule: MediaSelectionRule | undefined;
  formData?: Record<string, unknown>;
  accountId?: string;
  excludeAssetIds?: string[];
  minDuration?: number;
}): Promise<{ id: string; url: string; filename: string; metadata: Record<string, string | number | null> } | null> {
  const { tx, libraryId, rule, formData, accountId, excludeAssetIds, minDuration } = args;
  const config = normalizeRule(rule);
  const { strategy } = config;
  if (strategy === "manual") return null;

  const lib = await tx.mediaLibrary.findUnique({
    where: { id: libraryId },
    select: { maxUsageCount: true, rotationMode: true },
  });
  if (lib?.rotationMode === "none") return null;

  const tagFrag = buildTagFragment(config, formData);
  const burnFilter = buildBurnFilter(lib?.maxUsageCount ?? null, accountId);
  const accessFilter = buildAccessFilter(accountId);
  const excludeFrag = excludeAssetIds && excludeAssetIds.length > 0
    ? Prisma.sql`AND ma.id NOT IN (${Prisma.join(excludeAssetIds.map((id) => Prisma.sql`${id}`), ", ")})`
    : Prisma.sql``;
  const durationFrag = minDuration != null && minDuration > 0
    ? Prisma.sql`AND ma.duration >= ${minDuration}`
    : Prisma.sql``;

  // Ordering selon strategy. FOR UPDATE SKIP LOCKED appliqué à la fin.
  let orderClause: Prisma.Sql;
  let joinClause: Prisma.Sql = Prisma.sql``;
  if (strategy === "random") {
    orderClause = Prisma.sql`ORDER BY RANDOM()`;
  } else if (strategy === "oldest_used") {
    if (accountId) {
      joinClause = Prisma.sql`LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${accountId}`;
      orderClause = Prisma.sql`ORDER BY mau."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC`;
    } else {
      orderClause = Prisma.sql`ORDER BY ma."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC`;
    }
  } else {
    if (accountId) {
      joinClause = Prisma.sql`LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${accountId}`;
      orderClause = Prisma.sql`ORDER BY COALESCE(mau."usageCount", 0) ASC, mau."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC`;
    } else {
      orderClause = Prisma.sql`ORDER BY ma."usageCount" ASC, ma."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC`;
    }
  }

  type AssetRow = { id: string; url: string; filename: string; metadata: string };
  const rows = await tx.$queryRaw<AssetRow[]>(
    Prisma.sql`SELECT ma.id, ma.url, ma.filename, ma.metadata FROM "MediaAsset" ma
      ${joinClause}
      WHERE ma."libraryId" = ${libraryId}
      ${accessFilter}
      ${burnFilter}
      ${tagFrag}
      ${excludeFrag}
      ${durationFrag}
      ${orderClause}
      LIMIT 1
      FOR UPDATE OF ma SKIP LOCKED`
  );
  if (!rows[0]) return null;

  let metadata: Record<string, string | number | null> = {};
  try { metadata = JSON.parse(rows[0].metadata ?? "{}") as Record<string, string | number | null>; } catch { /* keep empty */ }
  return { id: rows[0].id, url: rows[0].url, filename: rows[0].filename, metadata };
}

/**
 * Account ID sentinel used as cursor/usage key for shared-scope libraries.
 * A single virtual "account" represents all real accounts collectively so
 * the rotation cursor is shared and concurrent generations serialize on it.
 */
// Re-export depuis lib/rotation/sentinels.ts (source unique W3.3).
export const SHARED_CURSOR_ACCOUNT_ID = SHARED_CURSOR_ACCOUNT_ID_FROM_SENTINELS;

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
  if (!config.tagConditions?.length) {
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

  if (parts.length === 0) return Prisma.sql``;
  return parts.length === 1
    ? Prisma.sql`AND ${parts[0]!}`
    : Prisma.sql`AND (${Prisma.join(parts, " AND ")})`;
}

/**
 * Burn-once filter — exclut les assets ayant atteint maxUsageCount.
 * - per-account (accountId fourni) : COUNT depuis MediaAssetUsage par compte.
 * - global (no accountId) : COUNT depuis MediaAsset.usageCount.
 * - maxUsageCount null/<=0 : pas de filtre (rotation infinie).
 */
function buildBurnFilter(maxUsageCount: number | null, accountId?: string, minDuration?: number): Prisma.Sql {
  // Phase 4 gap fix : combine burn + duration en un seul fragment pour économiser
  // 13 injections séparées dans selectMediaAssetBySetSequence. NULL duration permise
  // (tolérance pour les assets non probés).
  const durationClause = minDuration != null && minDuration > 0
    ? Prisma.sql`AND (ma.duration IS NULL OR ma.duration >= ${minDuration})`
    : Prisma.sql``;
  if (maxUsageCount == null || maxUsageCount <= 0) return durationClause;
  if (accountId) {
    return Prisma.sql`AND COALESCE((SELECT mau2."usageCount" FROM "MediaAssetUsage" mau2 WHERE mau2."assetId" = ma.id AND mau2."accountId" = ${accountId}), 0) < ${maxUsageCount} ${durationClause}`;
  }
  return Prisma.sql`AND ma."usageCount" < ${maxUsageCount} ${durationClause}`;
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
  /** Optional Prisma client — pass the transaction tx to run inside an existing transaction. */
  db?: PrismaQueryClient,
): Promise<{ id: string; url: string; filename: string; metadata: Record<string, string | number | null> } | null> {
  const config = normalizeRule(rule);
  const { strategy } = config;

  if (strategy === "manual") return null;

  const tagFrag = buildTagFragment(config, formData);
  const client = db ?? prisma;

  // Burn-once filter — fetch library.maxUsageCount once, use across all queries.
  // Aussi : rotationMode "none" → la lib n'utilise pas la rotation auto, sélection
  // exclusivement via metadata (selectMediaAssetByMetadataValue). Early return null.
  // Note : on utilise `prisma` direct (pas `client`) car PrismaQueryClient n'expose que `$queryRaw`.
  const lib = await prisma.mediaLibrary.findUnique({
    where: { id: libraryId },
    select: { maxUsageCount: true, rotationMode: true },
  });
  if (lib?.rotationMode === "none") return null;
  const burnFilter = buildBurnFilter(lib?.maxUsageCount ?? null, accountId);

  // Access filter: with accountId → global OR restricted-to-me; without → global only
  const accessFilter = buildAccessFilter(accountId);

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
    const rows = await client.$queryRaw<AssetRow[]>(
      Prisma.sql`SELECT ma.id, ma.url, ma.filename, ma.metadata FROM "MediaAsset" ma
        WHERE ma."libraryId" = ${libraryId}
        ${accessFilter}
        ${burnFilter}
        ${tagFrag}
        ${excludeFrag}
        ${durationFrag}
        ORDER BY RANDOM() LIMIT 1`
    );
    return rows[0] ? parseAssetRow(rows[0]) : null;
  }

  if (strategy === "oldest_used") {
    if (accountId) {
      const rows = await client.$queryRaw<AssetRow[]>(
        Prisma.sql`SELECT ma.id, ma.url, ma.filename, ma.metadata FROM "MediaAsset" ma
          LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${accountId}
          WHERE ma."libraryId" = ${libraryId}
          ${accessFilter}
          ${burnFilter}
          ${tagFrag}
          ${excludeFrag}
          ${durationFrag}
          ORDER BY mau."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`
      );
      return rows[0] ? parseAssetRow(rows[0]) : null;
    }
    const rows = await client.$queryRaw<AssetRow[]>(
      Prisma.sql`SELECT ma.id, ma.url, ma.filename, ma.metadata FROM "MediaAsset" ma
        WHERE ma."libraryId" = ${libraryId}
        ${accessFilter}
        ${burnFilter}
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
    const rows = await client.$queryRaw<AssetRow[]>(
      Prisma.sql`SELECT ma.id, ma.url, ma.filename, ma.metadata FROM "MediaAsset" ma
        LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${accountId}
        WHERE ma."libraryId" = ${libraryId}
        ${accessFilter}
        ${burnFilter}
        ${tagFrag}
        ${excludeFrag}
        ${durationFrag}
        ORDER BY COALESCE(mau."usageCount", 0) ASC, mau."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`
    );
    return rows[0] ? parseAssetRow(rows[0]) : null;
  }
  const rows = await client.$queryRaw<AssetRow[]>(
    Prisma.sql`SELECT ma.id, ma.url, ma.filename, ma.metadata FROM "MediaAsset" ma
      WHERE ma."libraryId" = ${libraryId}
      ${accessFilter}
      ${burnFilter}
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
  const accessFilter = buildAccessFilter(accountId);

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
  /** lastUsedSetTag BEFORE we wrote (Phase 6 — closes CAS gap that could overwrite a concurrent setTag-only change) */
  prevLastUsedSetTag: string | null;
  /** lastUsedSetTag WE WROTE — revert condition: lastUsedSetTag still equals this */
  claimedLastUsedSetTag: string | null;
  /** accountId used as the cursor key (may be SHARED_CURSOR_ACCOUNT_ID for shared-scope libs) */
  cursorAccountId: string;
};

export async function selectMediaAssetBySetSequence(
  libraryId: string,
  accountId: string | undefined,
  tagFilter?: string,          // kept for backward compat (ignored when ruleConfig provided)
  pinnedSetTag?: string,
  pinnedCategory?: string | null,
  ruleConfig?: MediaSelectionRuleConfig,
  /** Cursor + MediaAssetUsage ordering key. Defaults to accountId.
   *  Set to SHARED_CURSOR_ACCOUNT_ID for shared-scope libraries so all accounts
   *  advance the same cursor and serialize correctly on concurrent generations. */
  cursorAccountId?: string,
  /** When true, skip all cursor writes and return the asset that *would* be picked
   *  without advancing the cursor.  Used by resolveLibraryPrefill so the page-load
   *  preview no longer permanently advances the rotation. */
  readOnly?: boolean,
  /** Phase 4 gap fix : filtre les assets dont la durée est inférieure à
   *  minDuration. NULL permis (tolérance pour les assets non probés). */
  minDuration?: number,
): Promise<{ id: string; url: string; filename: string; resolvedSetTag: string | null; resolvedCategory: string | null; prevCursorState?: CursorRevertState } | null> {
  const library = await prisma.mediaLibrary.findUnique({
    where: { id: libraryId },
    select: { setSequence: true, maxUsageCount: true, rotationScope: true, rotationMode: true },
  });
  if (!library) return null;
  // rotationMode "none" → pas de rotation auto/override. Selection via metadata seulement.
  if (library.rotationMode === "none") return null;

  let sequence: string[] = [];
  try { sequence = (JSON.parse(library.setSequence) as string[]).filter((s) => !!s); } catch { sequence = []; }

  // effectiveCursorId: used for AccountLibraryCursor ops and MediaAssetUsage ordering.
  // For per-account libraries this equals accountId; for shared libraries it is "__shared__".
  const effectiveCursorId = cursorAccountId ?? accountId;

  // Burn-once filter — selon rotationScope :
  // - per_account : par compte (utilise accountId réel)
  // - shared      : global tous comptes confondus (utilise ma.usageCount)
  const isSharedScope = library.rotationScope === "shared";
  const burnAccountId = isSharedScope ? undefined : accountId;
  const burnFilter = buildBurnFilter(library.maxUsageCount ?? null, burnAccountId, minDuration);

  // Build tag fragment: prefer structured ruleConfig, fall back to legacy tagFilter string
  const tagFrag: Prisma.Sql = ruleConfig
    ? buildTagFragment(ruleConfig)
    : tagFilter
      ? Prisma.sql`AND lower(ma.tags) ILIKE ${`%"${tagFilter.toLowerCase()}"%`}`
      : Prisma.sql``;

  type AssetRow = { id: string; url: string; filename: string };

  // Access filter for MediaAsset queries — always based on real accountId, NOT cursorAccountId.
  // This ensures asset visibility (per-account access restrictions) is independent of the
  // cursor strategy (shared vs per-account). W3.1 : avant, ce site OUBLIAIT le
  // disabled=false guard → un asset disabled pouvait apparaître en groupe
  // listing. Le helper buildAccessFilter le réintroduit systématiquement.
  const accessFilter: Prisma.Sql = buildAccessFilter(accountId);

  /**
   * Anti-répétition 3-niveaux (Phase 2, 2026-05-30) :
   * - Si la lib a ≥2 catégories distinctes (incl. catégorie null pour les orphelins) →
   *   on exclut la dernière catégorie utilisée pour favoriser l'alternance entre catégories.
   * - Si la lib a 1 seule catégorie (peut être null) mais ≥2 setTags distincts →
   *   on exclut le dernier setTag utilisé pour alterner entre packs.
   * - Sinon (1 seul groupe) → tout est éligible, le moins utilisé sortira via pickFromGroup.
   *
   * `hasHistory` discrimine "jamais joué" (curseur vierge → pas d'exclusion) de
   * "dernier joué = orphelin (null, null)" (curseur posé → exclusion réelle).
   *
   * Les barrières de config (max usage, burn-once, 1x par compte) restent appliquées
   * AU SEIN du groupe via `burnFilter` côté pickFromGroup. Cette logique d'exclusion
   * n'est qu'un round-robin doux pour éviter la répétition immédiate.
   */
  // W3.2 : délégation vers selectEligibleRotationGroups (exporté module-level)
  // qui est aussi utilisé par DataEntry. Source unique pour la logique
  // d'anti-répétition Media + Data — un changement de règle ne se propage
  // plus dans 2 sites.
  function selectEligibleGroups(
    allGroups: Array<{ setTag: string | null; category: string | null }>,
    lastCategory: string | null,
    lastSetTag: string | null,
    hasHistory: boolean,
  ): Array<{ setTag: string | null; category: string | null }> {
    return selectEligibleRotationGroups(allGroups, lastCategory, lastSetTag, hasHistory);
  }

  // Helper: pick one asset from a specific (setTag, category) group.
  // Access filtering uses real accountId; usage ordering uses usageAccountId (may differ for shared).
  // setTag=null + category=null = groupe orphelin (Phase 2).
  async function pickFromGroup(setTag: string | null, category: string | null, usageAccountId?: string): Promise<AssetRow | null> {
    const setTagClause = setTag !== null
      ? Prisma.sql`AND ma."setTag" = ${setTag}`
      : Prisma.sql`AND ma."setTag" IS NULL`;
    const categoryClause = category !== null
      ? Prisma.sql`AND ma."category" = ${category}`
      : Prisma.sql`AND ma."category" IS NULL`;

    if (usageAccountId) {
      const rows = await prisma.$queryRaw<AssetRow[]>(Prisma.sql`
        SELECT ma.id, ma.url, ma.filename FROM "MediaAsset" ma
        LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${usageAccountId}
        WHERE ma."libraryId" = ${libraryId}
          AND ma."disabled" = false
          ${setTagClause}
          ${categoryClause}
          ${tagFrag}
          ${accessFilter}
          ${burnFilter}
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
          ${burnFilter}
        ORDER BY ma."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`);
      return rows[0] ?? null;
    }
  }

  // --- Pinned group (2nd+ block within same library group in one generation) ---
  if (pinnedSetTag !== undefined) {
    const row = await pickFromGroup(pinnedSetTag, pinnedCategory ?? null, effectiveCursorId);
    return row ? { ...row, resolvedSetTag: pinnedSetTag, resolvedCategory: pinnedCategory ?? null } : null;
  }

  // --- Override mode: setSequence explicitly defined → use cursor ---
  if (sequence.length > 0) {
    if (effectiveCursorId) {
      if (readOnly) {
        // Read-only peek: read current cursor position without advancing or locking
        const cursorRow = await prisma.accountLibraryCursor.findUnique({
          where: { accountId_libraryId: { accountId: effectiveCursorId, libraryId } },
          select: { cursor: true },
        });
        const current = cursorRow?.cursor ?? 0;
        const selectedSetTag = sequence[current % sequence.length];
        if (!selectedSetTag) return null;
        const rows = await prisma.$queryRaw<AssetRow[]>(Prisma.sql`
          SELECT ma.id, ma.url, ma.filename FROM "MediaAsset" ma
          LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${effectiveCursorId}
          WHERE ma."libraryId" = ${libraryId} AND ma."setTag" = ${selectedSetTag}
            AND ma."disabled" = false
            ${tagFrag}
            ${accessFilter}
            ${burnFilter}
          ORDER BY mau."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`);
        return rows[0] ? { ...rows[0], resolvedSetTag: selectedSetTag, resolvedCategory: null } : null;
      }
      // SELECT FOR UPDATE: advance cursor at prefill time so concurrent cron generations
      // each claim a distinct position in the set list before any render finishes.
      let selectedSetTag: string | undefined;
      let prevCursorState: CursorRevertState | undefined;
      await prisma.$transaction(async (tx) => {
        // Ensure row exists before locking
        await tx.accountLibraryCursor.upsert({
          where: { accountId_libraryId: { accountId: effectiveCursorId, libraryId } },
          update: {},
          create: { accountId: effectiveCursorId, libraryId, cursor: 0 },
        });
        const locked = await tx.$queryRaw<{ cursor: number; lastUsedCategory: string | null; lastUsedSetTag: string | null }[]>(
          Prisma.sql`SELECT cursor, "lastUsedCategory", "lastUsedSetTag" FROM "AccountLibraryCursor" WHERE "accountId" = ${effectiveCursorId} AND "libraryId" = ${libraryId} FOR UPDATE`,
        );
        const current = locked[0]?.cursor ?? 0;
        const prevLastUsedCat = locked[0]?.lastUsedCategory ?? null;
        const prevLastUsedSetTag = locked[0]?.lastUsedSetTag ?? null;
        selectedSetTag = sequence[current % sequence.length];
        if (!selectedSetTag) return;
        const nextCursor = (current + 1) % sequence.length;
        // Snapshot BEFORE writing so we can conditionally revert on render failure.
        // Override mode never touches lastUsedCategory, so claimedLastUsedCategory = prevLastUsedCat.
        // Phase 6: also snapshot lastUsedSetTag (claimed = selectedSetTag).
        prevCursorState = { prevCursor: current, claimedCursor: nextCursor, prevLastUsedCategory: prevLastUsedCat, claimedLastUsedCategory: prevLastUsedCat, prevLastUsedSetTag, claimedLastUsedSetTag: selectedSetTag, cursorAccountId: effectiveCursorId };
        await tx.accountLibraryCursor.update({
          where: { accountId_libraryId: { accountId: effectiveCursorId, libraryId } },
          data: { cursor: nextCursor, lastUsedSetTag: selectedSetTag, lastAdvancedAt: new Date() },
        });
      });
      if (!selectedSetTag) return null;
      // Asset selection outside the transaction — set position is already committed
      const rows = await prisma.$queryRaw<AssetRow[]>(Prisma.sql`
        SELECT ma.id, ma.url, ma.filename FROM "MediaAsset" ma
        LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${effectiveCursorId}
        WHERE ma."libraryId" = ${libraryId} AND ma."setTag" = ${selectedSetTag}
          AND ma."disabled" = false
          ${tagFrag}
          ${accessFilter}
          ${burnFilter}
        ORDER BY mau."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`);
      const row = rows[0] ?? null;
      if (!row) {
        // No eligible assets for this setTag (all disabled or access-restricted).
        // Cursor was already advanced to nextCursor — leave it there so the next generation
        // tries the following position in the sequence. The disabled position will naturally
        // re-appear after a full cycle and be skipped again if still disabled.
        console.warn(`[selectMediaAssetBySetSequence] No eligible assets for setTag=${selectedSetTag} library=${libraryId} — skipping to next cursor position`);
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
          ${burnFilter}
        ORDER BY ma."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`);
      const row = rows[0] ?? null;
      return row ? { ...row, resolvedSetTag: selectedSetTag, resolvedCategory: null } : null;
    }
  }

  // --- Auto mode: group by (category, setTag), exclude last used category ---
  type GroupRow = { setTag: string | null; category: string | null };

  if (effectiveCursorId) {
    if (readOnly) {
      // Read-only: peek at cursor without locking, run group discovery outside tx.
      // Phase 2 (orphelins) — on lit aussi lastUsedSetTag + lastAdvancedAt pour
      // discriminer "jamais joué" (lastAdvancedAt null) de "dernier joué = orphelin"
      // (lastAdvancedAt non null + lastUsedCategory null + lastUsedSetTag null).
      const cursorRow = await prisma.accountLibraryCursor.findUnique({
        where: { accountId_libraryId: { accountId: effectiveCursorId, libraryId } },
        select: { lastUsedCategory: true, lastUsedSetTag: true, lastAdvancedAt: true },
      });
      const currentCategory = cursorRow?.lastUsedCategory ?? null;
      const currentSetTag = cursorRow?.lastUsedSetTag ?? null;
      const hasHistory = cursorRow?.lastAdvancedAt != null;
      // Phase 2 (orphelins) — la clause `(setTag IS NOT NULL OR category IS NOT NULL)`
      // a été retirée : les assets totalement orphelins forment désormais un groupe
      // (null, null) à part entière, traité comme une catégorie normale.
      const allGroupsRo: Array<{ setTag: string | null; category: string | null }> = await prisma.$queryRaw`
          SELECT sub2."setTag", sub2."category"
          FROM (
            SELECT sub1."setTag", sub1."category", sub1.last_used, sub1.group_created_at,
                   MAX(sub1.last_used) OVER (PARTITION BY sub1."category") AS cat_last_used
            FROM (
              SELECT ma."setTag", ma."category",
                     MAX(mau."lastUsedAt") AS last_used,
                     MIN(ma."createdAt") AS group_created_at
              FROM "MediaAsset" ma
              LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${effectiveCursorId}
              WHERE ma."libraryId" = ${libraryId}
                ${accessFilter}
                ${burnFilter}
              GROUP BY ma."setTag", ma."category"
              HAVING COUNT(*) FILTER (WHERE NOT ma."disabled") > 0
            ) sub1
          ) sub2
          ${GROUP_DISCOVERY_ORDER_BY}`;
      if (allGroupsRo.length === 0) {
        const fallbackRows = await prisma.$queryRaw<AssetRow[]>(Prisma.sql`
          SELECT ma.id, ma.url, ma.filename FROM "MediaAsset" ma
          LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${effectiveCursorId}
          WHERE ma."libraryId" = ${libraryId}
            AND ma."disabled" = false
            ${tagFrag}
            ${accessFilter}
            ${burnFilter}
          ORDER BY mau."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`);
        return fallbackRows[0] ? { ...fallbackRows[0], resolvedSetTag: null, resolvedCategory: null } : null;
      }
      const eligibleRo = selectEligibleGroups(allGroupsRo, currentCategory, currentSetTag, hasHistory);
      const candidatesRo = eligibleRo.length > 0 ? eligibleRo : allGroupsRo;
      for (const candidate of candidatesRo) {
        const row = await pickFromGroup(candidate.setTag, candidate.category, effectiveCursorId);
        if (row) return { ...row, resolvedSetTag: candidate.setTag, resolvedCategory: candidate.category };
      }
      return null;
    }
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
        where: { accountId_libraryId: { accountId: effectiveCursorId, libraryId } },
        update: {},
        create: { accountId: effectiveCursorId, libraryId, cursor: 0 },
      });
      // Lock cursor row and read its rotation state atomically.
      // Phase 2 — on lit lastUsedSetTag + lastAdvancedAt en plus pour
      // pouvoir appliquer l'anti-répétition 3-niveaux et discriminer
      // "jamais joué" de "dernier joué = orphelin".
      const locked = await tx.$queryRaw<{ lastUsedCategory: string | null; lastUsedSetTag: string | null; lastAdvancedAt: Date | null }[]>(
        Prisma.sql`SELECT "lastUsedCategory", "lastUsedSetTag", "lastAdvancedAt" FROM "AccountLibraryCursor" WHERE "accountId" = ${effectiveCursorId} AND "libraryId" = ${libraryId} FOR UPDATE`,
      );
      const lockedCategory = locked[0]?.lastUsedCategory ?? null;
      const lockedSetTag = locked[0]?.lastUsedSetTag ?? null;
      const hasHistory = locked[0]?.lastAdvancedAt != null;

      // Group discovery inside the transaction.
      // Primary sort: category-level staleness (MAX last_used across all sets in the category)
      // → ensures categories rotate round-robin before cycling within a category.
      // Secondary sort: set-level staleness (last_used of this specific group)
      // → within a category, oldest set comes first.
      // Tertiary: group creation date (MIN createdAt within the group)
      // → among never-used groups, follow upload order (oldest first).
      // Quaternary: stable alphabetical tiebreaker (setTag then category).
      // Usage ordering uses effectiveCursorId; access filter uses real accountId.
      // Phase 2 — la clause `(setTag IS NOT NULL OR category IS NOT NULL)` a été retirée :
      // les assets totalement orphelins forment désormais un groupe (null, null) éligible.
      const allGroups: GroupRow[] = await tx.$queryRaw`
          SELECT sub2."setTag", sub2."category"
          FROM (
            SELECT sub1."setTag", sub1."category", sub1.last_used, sub1.group_created_at,
                   MAX(sub1.last_used) OVER (PARTITION BY sub1."category") AS cat_last_used
            FROM (
              SELECT ma."setTag", ma."category",
                     MAX(mau."lastUsedAt") AS last_used,
                     MIN(ma."createdAt") AS group_created_at
              FROM "MediaAsset" ma
              LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${effectiveCursorId}
              WHERE ma."libraryId" = ${libraryId}
                ${accessFilter}
                ${burnFilter}
              GROUP BY ma."setTag", ma."category"
              HAVING COUNT(*) FILTER (WHERE NOT ma."disabled") > 0
            ) sub1
          ) sub2
          ${GROUP_DISCOVERY_ORDER_BY}`;

      if (allGroups.length === 0) return; // handled by fallback below

      const eligible = selectEligibleGroups(allGroups, lockedCategory, lockedSetTag, hasHistory);
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
          LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${effectiveCursorId}
          WHERE ma."libraryId" = ${libraryId}
            AND ma."disabled" = false
            ${setTagClause}
            ${categoryClause}
            ${tagFrag}
            ${accessFilter}
            ${burnFilter}
          ORDER BY mau."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`);
        if (rows[0]) {
          resultRow = rows[0];
          resultSetTag = candidate.setTag;
          resultCategory = candidate.category;
          // Snapshot BEFORE writing so we can conditionally revert on render failure.
          // Phase 6 : also snapshot lastUsedSetTag so the CAS revert can verify nothing
          // else (e.g. a concurrent prefill that only updated lastUsedSetTag) has changed
          // the row between our claim and the revert.
          prevCursorState = { prevCursor: 0, claimedCursor: 0, prevLastUsedCategory: lockedCategory, claimedLastUsedCategory: candidate.category, prevLastUsedSetTag: lockedSetTag, claimedLastUsedSetTag: candidate.setTag, cursorAccountId: effectiveCursorId };
          // Write lastUsedCategory immediately — the next generator waiting on FOR UPDATE
          // will see this value and exclude this category family.
          await tx.accountLibraryCursor.update({
            where: { accountId_libraryId: { accountId: effectiveCursorId, libraryId } },
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
    // allGroups was empty — fallback: any asset from eligible pool.
    // Phase W2.6 : on stamp `lastAdvancedAt=now` même dans le fallback pour
    // marquer la rotation comme "history connue". Sans ça, après un full
    // burn-once cycle (tous assets épuisés), le cursor reste avec
    // lastAdvancedAt=null → toutes les générations suivantes voient
    // hasHistory=false et l'anti-repetition catégorie ne se déclenche plus
    // jamais (finding rotation-9).
    const fallbackRows = await prisma.$queryRaw<AssetRow[]>(Prisma.sql`
      SELECT ma.id, ma.url, ma.filename FROM "MediaAsset" ma
      LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${effectiveCursorId}
      WHERE ma."libraryId" = ${libraryId}
        AND ma."disabled" = false
        ${tagFrag}
        ${accessFilter}
        ${burnFilter}
      ORDER BY mau."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`);
    if (fallbackRows[0]) {
      try {
        await prisma.accountLibraryCursor.upsert({
          where: { accountId_libraryId: { accountId: effectiveCursorId, libraryId } },
          update: { lastAdvancedAt: new Date() },
          create: { accountId: effectiveCursorId, libraryId, cursor: 0, lastAdvancedAt: new Date() },
        });
      } catch (err) {
        console.warn(`[selectMediaAssetBySetSequence] fallback lastAdvancedAt stamp failed lib=${libraryId}:`, err);
      }
    }
    return fallbackRows[0] ? { ...fallbackRows[0], resolvedSetTag: null, resolvedCategory: null } : null;
  }

  // No accountId (admin preview): no lock, no cursor writes, global pool only.
  // Same two-level sort as the accountId path: category-level staleness first, set-level second.
  // Phase 2 — la clause `(setTag IS NOT NULL OR category IS NOT NULL)` a été retirée :
  // les assets totalement orphelins forment désormais un groupe (null, null) éligible.
  const allGroups: GroupRow[] = await prisma.$queryRaw`
      SELECT sub2."setTag", sub2."category"
      FROM (
        SELECT sub1."setTag", sub1."category", sub1.last_used, sub1.group_created_at,
               MAX(sub1.last_used) OVER (PARTITION BY sub1."category") AS cat_last_used
        FROM (
          SELECT "setTag", "category",
                 MAX("lastUsedAt") AS last_used,
                 MIN("createdAt") AS group_created_at
          FROM "MediaAsset"
          WHERE "libraryId" = ${libraryId}
            AND NOT EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = id)
          GROUP BY "setTag", "category"
          HAVING COUNT(*) FILTER (WHERE NOT "disabled") > 0
        ) sub1
      ) sub2
      ${GROUP_DISCOVERY_ORDER_BY}`;

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
    prevAudioUsageState: undefined,
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

  /**
   * Returns the cursor/usage-ordering account ID:
   * - shared libraries → SHARED_CURSOR_ACCOUNT_ID so all accounts advance the same cursor
   * - per-account libraries → real accountId
   * - no accountId at all → undefined (admin preview, no cursor)
   */
  function effectiveCursorAccountId(libId: string): string | undefined {
    return libScopeMap.get(libId) === "shared" ? SHARED_CURSOR_ACCOUNT_ID : accountId;
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
            effectiveCursorAccountId(libId),
            true,
            (b as { minDuration?: number }).minDuration,
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
          // Phase 4 : passe slot.maxDuration comme minimum requis pour l'asset.
          const slotMinDuration = s.maxDuration && s.maxDuration > 0 ? s.maxDuration : undefined;
          const suggestion = await selectMediaAssetBySetSequence(
            libId,
            effectiveAccountId(libId),
            undefined,
            pinnedSetTag,
            pinnedCategory,
            rule,
            effectiveCursorAccountId(libId),
            true,
            slotMinDuration,
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
    // Estimate total video duration. The estimate is meant to UPPER-BOUND the final
    // output length so the duration filter rejects any track that cannot cover the
    // whole video. Two modes:
    //  - Sequence mode (videoSequence non-empty): sum each slot's effective duration:
    //      library-picked slot → min(asset.duration, slot.maxDuration)
    //      binding-form slot   → slot.maxDuration (upper bound, no asset known yet)
    //  - Single-video mode: prefer canvas.maxDuration; fall back to summed library durations.
    let estimatedVideoDuration = 0;
    const seq = template.videoSequence ?? [];

    if (seq.length > 0) {
      const pickedIdBySlot = new Map<string, string>();
      for (const slot of seq) {
        const pickedId = result.videoSuggestions[slot.id]?.id;
        if (pickedId) pickedIdBySlot.set(slot.id, pickedId);
      }
      const durationByAssetId = new Map<string, number>();
      const pickedIds = Array.from(pickedIdBySlot.values());
      if (pickedIds.length > 0) {
        const rows = await prisma.mediaAsset.findMany({
          where: { id: { in: pickedIds } },
          select: { id: true, duration: true },
        });
        for (const r of rows) durationByAssetId.set(r.id, r.duration ?? 0);
      }
      for (const slot of seq) {
        const cap = slot.maxDuration && slot.maxDuration > 0 ? slot.maxDuration : undefined;
        const pickedId = pickedIdBySlot.get(slot.id);
        const assetDur = pickedId ? durationByAssetId.get(pickedId) ?? 0 : 0;
        let slotDur: number;
        if (assetDur > 0) {
          slotDur = cap !== undefined ? Math.min(assetDur, cap) : assetDur;
        } else {
          slotDur = cap ?? 0;
        }
        estimatedVideoDuration += slotDur;
      }
    } else if (template.canvas?.maxDuration && template.canvas.maxDuration > 0) {
      estimatedVideoDuration = template.canvas.maxDuration;
    } else {
      const pickedVideoIds = Object.values(result.videoSuggestions).map((s) => s.id);
      if (pickedVideoIds.length > 0) {
        const durations = await prisma.mediaAsset.findMany({
          where: { id: { in: pickedVideoIds } },
          select: { duration: true },
        });
        estimatedVideoDuration = durations.reduce((sum, a) => sum + (a.duration ?? 0), 0);
      }
    }

    // Skip the duration filter when the track loops — any length works.
    const audioMinDuration =
      !musicBlock.loop && estimatedVideoDuration > 0 ? estimatedVideoDuration : undefined;

    const audioLibraryId = musicBlock.libraryId;

    // Guard against stale template references: if the library was deleted, skip silently.
    const audioLibraryExists = await prisma.mediaLibrary.findUnique({
      where: { id: audioLibraryId },
      select: { id: true },
    });
    if (!audioLibraryExists) {
      console.warn(`[resolveLibraryPrefill] audioLibraryId=${audioLibraryId} introuvable — sélection audio ignorée`);
    } else {

    const audioEffectiveAccountId = effectiveAccountId(audioLibraryId);

    // Read-only: just pick the best audio asset without stamping lastUsedAt.
    // The actual usage claim (MediaAssetUsage.lastUsedAt) is written at submission time
    // via advanceAudioUsageOnSubmit called from POST /api/renders.
    result.audioSuggestion = await selectMediaAsset(
      audioLibraryId,
      musicBlock.audioSelectionRule,
      formData,
      audioEffectiveAccountId,
      undefined,
      audioMinDuration,
    );
    } // end audioLibraryExists guard
  }

  // --- Data library ---
  if (template.contentLibrary?.dataCampaignId) {
    // Phase 1.2 + Phase 3.B — load cursor state to enable category anti-repetition.
    // Applies to both "per_account" and "shared" rotationScope.
    // For shared scope, the cursor is keyed by SHARED_DATA_CURSOR_ACCOUNT_ID.
    let prevCursorState: { lastUsedSetTag: string | null; lastUsedCategory: string | null; hasHistory: boolean } | undefined;
    const campaignWithLib = await prisma.dataCampaign.findUnique({
      where: { id: template.contentLibrary.dataCampaignId },
      select: { libraryId: true, library: { select: { rotationScope: true } } },
    });
    if (campaignWithLib) {
      const scope = campaignWithLib.library.rotationScope;
      // Determine the effective cursor account ID: shared libs use a global synthetic key.
      const cursorAccountId =
        scope === "shared"
          ? SHARED_DATA_CURSOR_ACCOUNT_ID
          : accountId; // per_account: only load when accountId is known
      if (cursorAccountId) {
        const cursorRow = await prisma.accountDataLibraryCursor.findUnique({
          where: { accountId_libraryId: { accountId: cursorAccountId, libraryId: campaignWithLib.libraryId } },
          select: { lastUsedSetTag: true, lastUsedCategory: true, lastAdvancedAt: true },
        });
        prevCursorState = {
          lastUsedSetTag: cursorRow?.lastUsedSetTag ?? null,
          lastUsedCategory: cursorRow?.lastUsedCategory ?? null,
          hasHistory: cursorRow?.lastAdvancedAt != null,
        };
      }
    }

    // Phase 8.M1 : readOnly=true → ne pose plus de claim DataEntryUsage(usageCount=0)
    // ni n'update usedInCycle au SSR. Si l'user abandonne la page, aucun état n'est
    // laissé en DB. Le claim définitif (atomique avec FOR UPDATE) se fait au submit
    // via advanceDataEntryClaimOnSubmit appelée depuis POST /api/renders. Symétrique
    // avec selectMediaAssetBySetSequence(..., readOnly=true).
    const dataSuggestion = await selectDataEntry(
      template.contentLibrary.dataCampaignId,
      template.contentLibrary.dataSelectionRule,
      accountId,
      prevCursorState,
      true, // readOnly
    );
    if (dataSuggestion) {
      result.dataSuggestion = {
        entryId: dataSuggestion.entryId,
        fields: dataSuggestion.fields,
        resolvedSetTag: dataSuggestion.resolvedSetTag,
        resolvedCategory: dataSuggestion.resolvedCategory,
      };
      if (dataSuggestion.claimState) {
        result.prevDataEntryState = dataSuggestion.claimState;
      }
    }
  }

  return result;
}

/**
 * Advances AccountLibraryCursor for all set-sequenced libraries at form submission time.
 * Called from POST /api/renders so the cursor only moves when the user actually submits,
 * not when they open the generate page.
 *
 * For override mode libraries, the advance reads the CURRENT cursor position (not the
 * value suggested at prefill time) to handle any concurrent submissions correctly.
 * For auto mode libraries, the submitted category/setTag (from the read-only prefill) is
 * trusted and written as lastUsedCategory.
 */
export async function advanceLibraryCursorsOnSubmit(
  setSequencedLibraryIds: string[],
  submittedSetTagByLibrary: Record<string, string>,
  submittedCategoryByLibrary: Record<string, string>,
  accountId: string,
): Promise<{
  prevCursorStateByLibrary: Record<string, CursorRevertState>;
  usedSetTagByLibrary: Record<string, string>;
  usedCategoryByLibrary: Record<string, string>;
}> {
  const result = {
    prevCursorStateByLibrary: {} as Record<string, CursorRevertState>,
    usedSetTagByLibrary: { ...submittedSetTagByLibrary },
    usedCategoryByLibrary: { ...submittedCategoryByLibrary },
  };

  if (!setSequencedLibraryIds.length) return result;

  const libs = await prisma.mediaLibrary.findMany({
    where: { id: { in: setSequencedLibraryIds } },
    select: { id: true, setSequence: true, rotationScope: true },
  });

  // W5.5 / rotation-11 : warn si certaines libs ne sont plus en base (deleted
  // entre prefill et submit). Les cursors orphelins du payload sont skipped
  // silencieusement par le for-of, mais on log pour permettre l'investigation
  // si un Render finit avec usedAssets référençant des libs inexistantes.
  if (libs.length < setSequencedLibraryIds.length) {
    const foundIds = new Set(libs.map((l) => l.id));
    const missing = setSequencedLibraryIds.filter((id) => !foundIds.has(id));
    console.warn(
      `[advanceLibraryCursorsOnSubmit] ${missing.length} libraryId(s) absente(s) en base : ${missing.join(", ")}`,
    );
  }

  for (const lib of libs) {
    const cursorAccountId = lib.rotationScope === "shared" ? SHARED_CURSOR_ACCOUNT_ID : accountId;
    let sequence: string[] = [];
    try { sequence = (JSON.parse(lib.setSequence) as string[]).filter(Boolean); } catch { sequence = []; }

    await prisma.$transaction(async (tx) => {
      // Ensure cursor row exists before locking
      await tx.accountLibraryCursor.upsert({
        where: { accountId_libraryId: { accountId: cursorAccountId, libraryId: lib.id } },
        update: {},
        create: { accountId: cursorAccountId, libraryId: lib.id, cursor: 0 },
      });

      if (sequence.length > 0) {
        // Override mode: advance cursor from its CURRENT position (handles concurrency)
        const locked = await tx.$queryRaw<{ cursor: number; lastUsedCategory: string | null; lastUsedSetTag: string | null }[]>(
          Prisma.sql`SELECT cursor, "lastUsedCategory", "lastUsedSetTag" FROM "AccountLibraryCursor" WHERE "accountId" = ${cursorAccountId} AND "libraryId" = ${lib.id} FOR UPDATE`,
        );
        const current = locked[0]?.cursor ?? 0;
        const prevLastUsedCat = locked[0]?.lastUsedCategory ?? null;
        const prevLastUsedSetTag = locked[0]?.lastUsedSetTag ?? null;
        const selectedSetTag = sequence[current % sequence.length];
        if (!selectedSetTag) return;
        const nextCursor = (current + 1) % sequence.length;
        result.prevCursorStateByLibrary[lib.id] = {
          prevCursor: current,
          claimedCursor: nextCursor,
          prevLastUsedCategory: prevLastUsedCat,
          claimedLastUsedCategory: prevLastUsedCat,
          prevLastUsedSetTag,
          claimedLastUsedSetTag: selectedSetTag,
          cursorAccountId,
        };
        result.usedSetTagByLibrary[lib.id] = selectedSetTag;
        await tx.accountLibraryCursor.update({
          where: { accountId_libraryId: { accountId: cursorAccountId, libraryId: lib.id } },
          data: { cursor: nextCursor, lastUsedSetTag: selectedSetTag, lastAdvancedAt: new Date() },
        });
      } else {
        // Auto mode: trust submitted category/setTag from the read-only prefill
        const submittedCategory = submittedCategoryByLibrary[lib.id] ?? null;
        const submittedSetTag = submittedSetTagByLibrary[lib.id] ?? null;
        if (!submittedCategory && !submittedSetTag) return;

        const locked = await tx.$queryRaw<{ lastUsedCategory: string | null; lastUsedSetTag: string | null }[]>(
          Prisma.sql`SELECT "lastUsedCategory", "lastUsedSetTag" FROM "AccountLibraryCursor" WHERE "accountId" = ${cursorAccountId} AND "libraryId" = ${lib.id} FOR UPDATE`,
        );
        const prevLastUsedCategory = locked[0]?.lastUsedCategory ?? null;
        const prevLastUsedSetTag = locked[0]?.lastUsedSetTag ?? null;
        result.prevCursorStateByLibrary[lib.id] = {
          prevCursor: 0,
          claimedCursor: 0,
          prevLastUsedCategory,
          claimedLastUsedCategory: submittedCategory,
          prevLastUsedSetTag,
          claimedLastUsedSetTag: submittedSetTag,
          cursorAccountId,
        };
        await tx.accountLibraryCursor.update({
          where: { accountId_libraryId: { accountId: cursorAccountId, libraryId: lib.id } },
          data: {
            lastUsedSetTag: submittedSetTag,
            lastUsedCategory: submittedCategory,
            lastAdvancedAt: new Date(),
          },
        });
      }
    });
  }

  return result;
}

/**
 * Advances AccountDataLibraryCursor for a DataLibrary at form submission time.
 * Mirror of advanceLibraryCursorsOnSubmit but for DataLibrary cursors.
 *
 * Phase 3.B: supports both "per_account" and "shared" rotationScope.
 *   - per_account: cursor key = real accountId
 *   - shared: cursor key = SHARED_DATA_CURSOR_ACCOUNT_ID (one global cursor)
 *
 * Fix C3: always writes lastAdvancedAt even when submittedSetTag and
 * submittedCategory are both null (orphan-group libs). Without this, the
 * `hasHistory = lastAdvancedAt != null` check in selectDataEntry stays false
 * forever → selectEligibleDataGroups returns ALL groups every time → same
 * orphan entry picked repeatedly (rotation broken for all-orphan libs).
 *
 * Returns prevState (lastUsedSetTag + lastUsedCategory before the write) so the
 * caller can conditionally revert if the Render creation fails.
 * Also returns the effectiveCursorId used so the caller can store it in the
 * snapshot for the revert path.
 */
export async function advanceDataLibraryCursorOnSubmit(
  dataLibraryId: string,
  submittedSetTag: string | null,
  submittedCategory: string | null,
  accountId: string,
): Promise<{
  prevState: { lastUsedSetTag: string | null; lastUsedCategory: string | null } | null;
  effectiveCursorId: string | null;
}> {
  // Load library to check rotationScope
  const library = await prisma.dataLibrary.findUnique({
    where: { id: dataLibraryId },
    select: { rotationScope: true },
  });
  if (!library) return { prevState: null, effectiveCursorId: null };

  // Phase 3.B: compute effective cursor account ID based on scope
  const effectiveCursorId =
    library.rotationScope === "shared" ? SHARED_DATA_CURSOR_ACCOUNT_ID : accountId;

  // Fix C3: removed the early return for (submittedSetTag === null && submittedCategory === null).
  // We MUST write lastAdvancedAt even for orphan-group libs so that hasHistory becomes true
  // after the first generation. Without this, selectEligibleDataGroups returns all groups
  // on every call (no history = no exclusion) → same entry repeatedly.

  // Code-reviewer C2 fix : retourner prevState UNIQUEMENT si la transaction
  // a effectivement commit. Avant : prevState était `let` en dehors, donc une
  // tx qui rejette après l'affectation mais avant le commit aurait laissé
  // prevState avec une valeur DB qu'on n'a en réalité jamais écrite — causant
  // un revert "fantôme" plus tard (no-op via CAS mais log trompeur).
  // Maintenant : prevState est retourné par le callback, donc seulement
  // si le commit réussit. Si la tx throw, l'erreur remonte et l'appelant
  // ne stocke pas de revert state.
  const prevState = await prisma.$transaction(async (tx) => {
    // Ensure cursor row exists before locking
    await tx.accountDataLibraryCursor.upsert({
      where: { accountId_libraryId: { accountId: effectiveCursorId, libraryId: dataLibraryId } },
      update: {},
      create: { accountId: effectiveCursorId, libraryId: dataLibraryId },
    });

    // Lock cursor row and snapshot current state
    const locked = await tx.$queryRaw<{ lastUsedSetTag: string | null; lastUsedCategory: string | null }[]>(
      Prisma.sql`SELECT "lastUsedSetTag", "lastUsedCategory" FROM "AccountDataLibraryCursor" WHERE "accountId" = ${effectiveCursorId} AND "libraryId" = ${dataLibraryId} FOR UPDATE`,
    );
    const snapshot = {
      lastUsedSetTag: locked[0]?.lastUsedSetTag ?? null,
      lastUsedCategory: locked[0]?.lastUsedCategory ?? null,
    };

    await tx.accountDataLibraryCursor.update({
      where: { accountId_libraryId: { accountId: effectiveCursorId, libraryId: dataLibraryId } },
      data: {
        lastUsedSetTag: submittedSetTag,
        lastUsedCategory: submittedCategory,
        lastAdvancedAt: new Date(),
      },
    });

    return snapshot;
  });

  return { prevState, effectiveCursorId };
}

/**
 * Phase 8.M1 — Claim DataEntry atomique au moment du submit.
 *
 * Avant Phase 8.M1, selectDataEntry posait le claim (INSERT DataEntryUsage
 * usageCount=0 ou UPDATE usedInCycle=true) au PREFILL SSR. Si l'user
 * abandonnait la page, le claim restait et l'entry était définitivement
 * marquée "consommée" pour ce compte. Asymétrique avec Media (readOnly
 * au prefill, claim au submit).
 *
 * Phase 8.M1 corrige : selectDataEntry est désormais readOnly au prefill
 * (juste pick avec FOR UPDATE SKIP LOCKED pour stabilité concurrente, sans
 * mutation), et CE helper claim l'entry au submit avec garde anti-race.
 *
 * Stratégie :
 *  - Si l'entry suggéré est encore claimable (NOT EXISTS DataEntryUsage)
 *    → claim posé.
 *  - Sinon (un autre render a déjà claimé l'entry entre prefill et submit)
 *    → fallback : re-pick + claim sur une autre entry éligible. Le render
 *    final utilisera des données différentes que la suggestion mais
 *    n'échoue pas (le user voit les data du form figées via dataEntryId
 *    envoyé, mais le claim DB est sur une autre — c'est best-effort).
 *
 * Pour `usagePolicy === "unlimited"` ou `"none"`, pas de claim — return null
 * (le caller traite comme "pas de revert state à stocker").
 *
 * Le retour `null` signifie "rien à claim" (unlimited, manual, ou exhausted).
 * Le caller (POST /api/renders) ne stocke alors pas de prevDataEntryState.
 */
export async function advanceDataEntryClaimOnSubmit(
  campaignId: string,
  suggestedEntryId: string | null | undefined,
  accountId: string | undefined,
): Promise<{ claimState: DataEntryClaimState } | null> {
  const campaign = await prisma.dataCampaign.findUnique({
    where: { id: campaignId },
    select: {
      library: {
        select: {
          rotationMode: true,
          rotationScope: true,
          maxUsageCount: true,
        },
      },
    },
  });
  if (!campaign?.library) return null;
  const lib = campaign.library;
  if (lib.rotationMode === "none") return null;

  const usagePolicy: "cycle_per_account" | "once_per_account" | "once_global" | "unlimited" =
    lib.maxUsageCount === 1
      ? (lib.rotationScope === "per_account" ? "once_per_account" : "once_global")
      : (lib.rotationScope === "per_account" ? "cycle_per_account" : "unlimited");

  // "unlimited" → no claim mechanism (lastUsedAt incrémenté au DONE via recordLibraryUsage).
  if (usagePolicy === "unlimited") return null;

  // Per-account policies require accountId.
  if ((usagePolicy === "cycle_per_account" || usagePolicy === "once_per_account") && !accountId) {
    return null;
  }

  // Tente le claim sur l'entry suggérée d'abord (best-effort).
  // Si elle est déjà claimée par un render concurrent, on retombe sur
  // selectDataEntry(readOnly=false) qui re-pioche atomiquement.
  //
  // W5.15 : lecture setTag/category pour populer claimState.resolvedSetTag/
  // Category — sans ça, le caller route.ts devait utiliser le hint client
  // (dataResolvedSetTag) qui pouvait référer à l'ancien entry après re-pick.
  let suggestedSetTag: string | null = null;
  let suggestedCategory: string | null = null;
  if (suggestedEntryId) {
    const sug = await prisma.dataEntry.findUnique({
      where: { id: suggestedEntryId },
      select: { setTag: true, category: true },
    });
    suggestedSetTag = sug?.setTag ?? null;
    suggestedCategory = sug?.category ?? null;
  }
  if (suggestedEntryId) {
    if (usagePolicy === "cycle_per_account") {
      try {
        await prisma.dataEntryUsage.create({
          data: { entryId: suggestedEntryId, accountId: accountId!, usageCount: 0, lastUsedAt: new Date() },
        });
        return {
          claimState: { entryId: suggestedEntryId, campaignId, usagePolicy, claimType: "perAccountUsage", accountId, resolvedSetTag: suggestedSetTag, resolvedCategory: suggestedCategory },
        };
      } catch {
        // Unique constraint (entryId, accountId) → déjà claim, on fallback.
        console.info(`[advanceDataEntryClaimOnSubmit] suggested entry ${suggestedEntryId} already claimed for account ${accountId} — re-picking`);
      }
    } else if (usagePolicy === "once_per_account") {
      // Code-reviewer M1 : pour once_per_account, on doit utiliser upsert
      // (pas create). Le create lèverait sur unique-constraint si une row
      // usageCount=0 existe déjà (cas re-essai après abandon), déclenchant
      // un fallback re-pick alors que l'entry n'est pas réellement consommée
      // (usageCount > 0 = consommation effective).
      try {
        const upserted = await prisma.dataEntryUsage.upsert({
          where: { entryId_accountId: { entryId: suggestedEntryId, accountId: accountId! } },
          update: {}, // ne touche pas si row existe (claim déjà posé OU consommé)
          create: { entryId: suggestedEntryId, accountId: accountId!, usageCount: 0, lastUsedAt: new Date() },
        });
        // Si usageCount > 0, l'entry est réellement consommée → on fallback.
        if (upserted.usageCount > 0) {
          console.info(`[advanceDataEntryClaimOnSubmit] suggested entry ${suggestedEntryId} already consumed (usageCount > 0) — re-picking`);
        } else {
          return {
            claimState: { entryId: suggestedEntryId, campaignId, usagePolicy, claimType: "perAccountUsage", accountId, resolvedSetTag: suggestedSetTag, resolvedCategory: suggestedCategory },
          };
        }
      } catch (err) {
        console.warn(`[advanceDataEntryClaimOnSubmit] upsert failed:`, err);
      }
    } else if (usagePolicy === "once_global") {
      // Atomic CAS : claim seulement si pas encore claim.
      const updated = await prisma.$executeRaw(Prisma.sql`
        UPDATE "DataEntry"
        SET "usedInCycle" = true
        WHERE id = ${suggestedEntryId}
          AND "usedInCycle" = false
          AND "usageCount" = 0
      `);
      if (updated > 0) {
        return {
          claimState: { entryId: suggestedEntryId, campaignId, usagePolicy, claimType: "usedInCycle", accountId, resolvedSetTag: suggestedSetTag, resolvedCategory: suggestedCategory },
        };
      }
      console.info(`[advanceDataEntryClaimOnSubmit] suggested entry ${suggestedEntryId} already claimed globally — re-picking`);
    }
  }

  // Fallback : re-pick avec selectDataEntry en mode CLAIM (readOnly=false).
  // Mirror du fallback Media quand un asset suggéré est devenu indisponible.
  //
  // Code-reviewer M6 : on passe le prevCursorState lu depuis AccountDataLibraryCursor
  // pour que l'anti-répétition cat/setTag s'applique aussi au re-pick. Sans ça,
  // le fallback pouvait tomber sur la même catégorie que la génération précédente,
  // cassant l'anti-répétition silencieusement.
  let prevCursorState: { lastUsedSetTag: string | null; lastUsedCategory: string | null; hasHistory: boolean } | undefined;
  if (accountId && suggestedEntryId) {
    // Bug-hunter B5 : findUnique({ id: "" }) renvoie silencieusement null →
    // prevCursorState reste undefined et l'anti-répétition saute. On ne tente
    // de lire le cursor QUE si un suggestedEntryId existe vraiment.
    // Détermine la libraryId pour lire le bon AccountDataLibraryCursor.
    const dataEntry = await prisma.dataEntry.findUnique({
      where: { id: suggestedEntryId },
      select: { campaign: { select: { libraryId: true } } },
    });
    const libraryId = dataEntry?.campaign?.libraryId;
    if (libraryId) {
      const effectiveCursorId = lib.rotationScope === "shared" ? SHARED_DATA_CURSOR_ACCOUNT_ID : accountId;
      const cursorRow = await prisma.accountDataLibraryCursor.findUnique({
        where: { accountId_libraryId: { accountId: effectiveCursorId, libraryId } },
        select: { lastUsedSetTag: true, lastUsedCategory: true, lastAdvancedAt: true },
      });
      prevCursorState = {
        lastUsedSetTag: cursorRow?.lastUsedSetTag ?? null,
        lastUsedCategory: cursorRow?.lastUsedCategory ?? null,
        hasHistory: cursorRow?.lastAdvancedAt != null,
      };
    }
  }
  const reSelected = await selectDataEntry(
    campaignId,
    undefined, // rule — la lib joue le pattern par défaut
    accountId,
    prevCursorState, // M6 : on porte l'anti-rép historique
    false, // readOnly = false → claim posé
  );
  if (reSelected?.claimState) return { claimState: reSelected.claimState };
  return null;
}

/**
 * Stamps MediaAssetUsage.lastUsedAt for the submitted audio asset at form submission time.
 * Called from POST /api/renders after advanceLibraryCursorsOnSubmit.
 * Returns the prev/claimed state needed for failure-recovery revert.
 */
export async function advanceAudioUsageOnSubmit(
  audioAssetId: string,
  accountId: string,
  audioLibraryId: string,
): Promise<{ prevAudioUsageState: { assetId: string; accountId: string; prevLastUsedAt: string | null; claimedLastUsedAt: string } } | null> {
  let prevUsage: { lastUsedAt: Date | null } | null = null;
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Use AccountLibraryCursor as a serialization lock for the audio library
    await tx.accountLibraryCursor.upsert({
      where: { accountId_libraryId: { accountId, libraryId: audioLibraryId } },
      update: {},
      create: { accountId, libraryId: audioLibraryId, cursor: 0 },
    });
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "AccountLibraryCursor" WHERE "accountId" = ${accountId} AND "libraryId" = ${audioLibraryId} FOR UPDATE`,
    );
    prevUsage = await tx.mediaAssetUsage.findUnique({
      where: { assetId_accountId: { assetId: audioAssetId, accountId } },
      select: { lastUsedAt: true },
    });
    await tx.mediaAssetUsage.upsert({
      where: { assetId_accountId: { assetId: audioAssetId, accountId } },
      update: { lastUsedAt: now },
      create: { assetId: audioAssetId, accountId, usageCount: 0, lastUsedAt: now },
    });
  });
  return {
    prevAudioUsageState: {
      assetId: audioAssetId,
      accountId,
      prevLastUsedAt: (prevUsage as { lastUsedAt: Date | null } | null)?.lastUsedAt?.toISOString() ?? null,
      claimedLastUsedAt: now.toISOString(),
    },
  };
}

export interface LibraryPrefill {
  /** blockId → suggested asset */
  videoSuggestions: Record<string, { id: string; url: string; filename: string }>;
  /** Single audio asset suggestion (first MusicBlock with a libraryId) */
  audioSuggestion: { id: string; url: string; filename: string } | null;
  /** Parsed fields from the selected DataEntry */
  dataSuggestion: {
    entryId: string;
    fields: Record<string, string>;
    /** Resolved setTag of the selected group — used to advance AccountDataLibraryCursor at submit. */
    resolvedSetTag?: string | null;
    /** Resolved category of the selected group — used to advance AccountDataLibraryCursor at submit. */
    resolvedCategory?: string | null;
  } | null;
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
  /**
   * Audio asset usage claim taken at prefill time.
   * Used to conditionally revert MediaAssetUsage.lastUsedAt if the render fails,
   * so the track re-enters the rotation as if it was never picked.
   */
  prevAudioUsageState?: {
    assetId: string;
    accountId: string;
    /** lastUsedAt value before we wrote (null = row did not exist) */
    prevLastUsedAt: string | null;
    /** lastUsedAt value we wrote — revert condition: row still has this value */
    claimedLastUsedAt: string;
  };
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
  /** W5.9 (rotation-13) : setTag de l'entry réellement claimée — utile au
   *  caller pour advance le cursor avec la bonne valeur après un re-pick
   *  (sans ce champ, le caller utilisait le hint client de prefill qui
   *  pouvait référer à l'ancien entry). Null si l'entry est orphan. */
  resolvedSetTag?: string | null;
  /** W5.9 (rotation-13) : category miroir du resolvedSetTag. */
  resolvedCategory?: string | null;
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
 *
 * prevCursorState: when provided (per-account rotation), the group selection
 * applies the same 3-level anti-repetition logic as selectMediaAssetBySetSequence:
 *   - ≥2 distinct categories → exclude the last used category family.
 *   - 1 category, ≥2 setTags → exclude the last used setTag.
 *   - Otherwise (single group) → no exclusion.
 */
/**
 * Anti-repetition group selection — version exportée module-level utilisée
 * pour les rotations Media (selectMediaAssetBySetSequence) ET DataEntry
 * (selectDataEntry). Avant W3.2 les deux paths avaient des copies identiques
 * (selectEligibleGroups inner + selectEligibleDataGroups) — un changement à la
 * règle aurait dû être propagé dans 2 fichiers ou risquer une divergence
 * silencieuse de la rotation media↔data.
 *
 * @internal Exported for unit testing.
 */
export function selectEligibleRotationGroups(
  allGroups: Array<{ setTag: string | null; category: string | null }>,
  lastCategory: string | null,
  lastSetTag: string | null,
  hasHistory: boolean,
): Array<{ setTag: string | null; category: string | null }> {
  if (!hasHistory) return allGroups; // jamais joué → tout est éligible
  const distinctCategories = new Set(allGroups.map((g) => g.category)).size;
  let filtered: Array<{ setTag: string | null; category: string | null }>;
  if (distinctCategories >= 2) {
    // ≥2 catégories : exclude catégorie (incl null === null pour orphelins)
    filtered = allGroups.filter((g) => g.category !== lastCategory);
  } else {
    // 1 catégorie unique (peut être null) : exclude setTag (incl null === null)
    filtered = allGroups.filter((g) => g.setTag !== lastSetTag);
  }
  // Phase W3.2 : fallback explicite — si tous les groupes sont exclus (cas
  // commun : libs avec un seul setTag/category, ou orphelins purement null),
  // retourne allGroups pour éviter qu'un caller naïf pick rien et que la
  // génération échoue. Le caller principal (selectMediaAsset...) faisait déjà
  // ce fallback implicit ; on le rend explicite ici pour protéger tous les
  // consumers (notamment DataEntry).
  return filtered.length > 0 ? filtered : allGroups;
}

/** @deprecated use selectEligibleRotationGroups — kept as alias for tests. */
export const selectEligibleDataGroups = selectEligibleRotationGroups;

/**
 * Synthetic accountId used as the cursor key for DataLibrary rotations when
 * rotationScope === "shared". Mirrors SHARED_CURSOR_ACCOUNT_ID for MediaLibrary.
 */
// Re-export depuis lib/rotation/sentinels.ts (source unique W3.3).
export const SHARED_DATA_CURSOR_ACCOUNT_ID = SHARED_DATA_CURSOR_ACCOUNT_ID_FROM_SENTINELS;

/** @internal Exported for unit testing only. */
export async function selectDataEntry(
  campaignId: string,
  rule: "not_used_in_cycle" | "least_used" | "manual" | undefined,
  accountId?: string,
  prevCursorState?: { lastUsedSetTag: string | null; lastUsedCategory: string | null; hasHistory: boolean },
  /**
   * Phase 8.M1 — Symétrie avec selectMediaAssetBySetSequence(..., readOnly=true).
   * En readOnly:
   *  - Aucun claim n'est écrit (INSERT DataEntryUsage usageCount=0, UPDATE usedInCycle=true).
   *  - Aucun curseur n'est avancé.
   *  - Le pick utilise FOR UPDATE SKIP LOCKED pour piocher de manière déterministe
   *    contre la concurrence, mais ne mute pas la DB.
   * Le claim définitif (avec FOR UPDATE) se fait à advanceDataEntryClaimOnSubmit
   * appelé depuis POST /api/renders au moment du submit — comme Media.
   *
   * Default false pour backwards compat (callers internes du grouping flow).
   */
  readOnly: boolean = false,
): Promise<{
  entryId: string;
  fields: Record<string, string>;
  claimState?: DataEntryClaimState;
  resolvedSetTag?: string | null;
  resolvedCategory?: string | null;
} | null> {
  if (rule === "manual") return null;

  // Phase 1.x — les réglages rotation vivent désormais sur DataLibrary
  // (rotationMode / rotationScope / maxUsageCount, mirror MediaLibrary).
  // DataCampaign reste un wrapper invisible (1 "Default" par lib).
  const campaign = await prisma.dataCampaign.findUnique({
    where: { id: campaignId },
    select: {
      library: {
        select: {
          id: true,
          rotationMode: true,
          rotationScope: true,
          maxUsageCount: true,
        },
      },
    },
  });
  if (!campaign?.library) {
    console.warn(`[contentLibraryResolver] DataCampaign ${campaignId} introuvable`);
    return null;
  }
  const lib = campaign.library;

  // rotationMode "none" → pas de rotation auto.
  // rotationMode "override" → TODO V2 (ordre fixe via DataEntry.position).
  //   En attendant, fallback sur "auto" pour ne pas casser les flows existants.
  if (lib.rotationMode === "none") return null;

  // Mapping (scope, maxUsage) → policy interne. N > 1 saturé à "unlimited"
  // (l'UI clamp déjà à {vide, 1}). Si on veut un vrai burn-N par fiche côté
  // data, il faudra une nouvelle branche dédiée.
  const usagePolicy: "cycle_per_account" | "once_per_account" | "once_global" | "unlimited" =
    lib.maxUsageCount === 1
      ? (lib.rotationScope === "per_account" ? "once_per_account" : "once_global")
      : (lib.rotationScope === "per_account" ? "cycle_per_account" : "unlimited");

  // Phase 3.B — effective cursor account ID:
  // - shared scope: one global cursor shared across all accounts
  // - per_account scope: each account has its own cursor
  // Mirrors the SHARED_CURSOR_ACCOUNT_ID pattern in selectMediaAssetBySetSequence.
  const effectiveCursorId: string | undefined =
    lib.rotationScope === "shared"
      ? SHARED_DATA_CURSOR_ACCOUNT_ID
      : accountId;

  // Access filter fragment (built once, used in all queries) — pass par le
  // helper centralisé pour aligner avec MediaAsset (1 seul site à éditer si
  // la sémantique d'accès change).
  const accessFilter = buildDataAccessFilter(accountId);

  // W5.15 (rotation-13) : setTag + category remontent pour populer
  // claimState.resolvedSetTag/Category. Sans ça, le caller route.ts devait
  // utiliser le hint client (dataResolvedSetTag) qui pouvait référer à
  // l'ancien entry après un re-pick concurrent.
  type EntryRow = { id: string; fields: string; setTag: string | null; category: string | null };
  type GroupRow = { setTag: string | null; category: string | null };

  // Helper: fetch one entry without locking (used for fallback paths and for !accountId cases)
  async function queryOne(extraWhere: Prisma.Sql, orderBy?: Prisma.Sql): Promise<EntryRow | null> {
    const order = orderBy ?? (accountId
      ? Prisma.sql`ORDER BY COALESCE(deu."usageCount", 0) ASC, deu."lastUsedAt" ASC NULLS FIRST, de."createdAt" ASC`
      : Prisma.sql`ORDER BY de."usageCount" ASC, de."lastUsedAt" ASC NULLS FIRST, de."createdAt" ASC`);
    if (accountId) {
      const rows = await prisma.$queryRaw<EntryRow[]>(
        Prisma.sql`SELECT de.id, de.fields, de."setTag", de."category" FROM "DataEntry" de
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
      Prisma.sql`SELECT de.id, de.fields, de."setTag", de."category" FROM "DataEntry" de
        WHERE de."campaignId" = ${campaignId}
        ${extraWhere}
        ${accessFilter}
        ${order}
        LIMIT 1`
    );
    return rows[0] ?? null;
  }

  // Helper: discover (setTag, category) groups eligible for the given policy.
  // Groups are ordered by cat_last_used ASC NULLS FIRST, last_used ASC NULLS FIRST,
  // group_created_at ASC — mirrors the MediaAsset group discovery sort.
  //
  // Phase 3.A: ALL policies go through group-based discovery (not just per_account).
  // Phase 3.B: usage ordering uses effectiveCursorId (SHARED_DATA_CURSOR_ACCOUNT_ID for
  //            shared-scope libs) so the staleness ranking reflects the shared global cursor.
  // Fix C2: accepts an optional tx client so it can run INSIDE the outer $transaction,
  //         preventing the "discovery reads stale, claim sees a different set" race.
  async function discoverGroups(
    policy: "cycle_per_account" | "once_per_account" | "once_global" | "unlimited",
    tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  ): Promise<GroupRow[]> {
    const client = tx ?? prisma;
    if (policy === "cycle_per_account" && accountId) {
      // Groups where at least one entry has NOT been claimed by this account yet
      // (no DataEntryUsage row) OR where at least one genuinely-used entry exists
      // (usageCount >= 1) — same as the two-step primary+fallback logic, but at group level.
      // We list ALL groups and let pickEntryFromGroup decide per-entry eligibility.
      // Usage ordering uses effectiveCursorId (may be SHARED_DATA_CURSOR_ACCOUNT_ID for shared libs).
      return client.$queryRaw<GroupRow[]>(Prisma.sql`
        SELECT sub2."setTag", sub2."category"
        FROM (
          SELECT sub1."setTag", sub1."category", sub1.last_used, sub1.group_created_at,
                 MAX(sub1.last_used) OVER (PARTITION BY sub1."category") AS cat_last_used
          FROM (
            SELECT de."setTag", de."category",
                   MAX(deu."lastUsedAt") AS last_used,
                   MIN(de."createdAt") AS group_created_at
            FROM "DataEntry" de
            LEFT JOIN "DataEntryUsage" deu ON deu."entryId" = de.id AND deu."accountId" = ${effectiveCursorId}
            WHERE de."campaignId" = ${campaignId}
              ${accessFilter}
            GROUP BY de."setTag", de."category"
            HAVING COUNT(*) > 0
          ) sub1
        ) sub2
        ${GROUP_DISCOVERY_ORDER_BY}`);
    }
    if (policy === "once_per_account" && accountId) {
      // Groups where at least one entry hasn't been consumed (usageCount=0, not yet claimed)
      return client.$queryRaw<GroupRow[]>(Prisma.sql`
        SELECT sub2."setTag", sub2."category"
        FROM (
          SELECT sub1."setTag", sub1."category", sub1.last_used, sub1.group_created_at,
                 MAX(sub1.last_used) OVER (PARTITION BY sub1."category") AS cat_last_used
          FROM (
            SELECT de."setTag", de."category",
                   MAX(deu."lastUsedAt") AS last_used,
                   MIN(de."createdAt") AS group_created_at
            FROM "DataEntry" de
            LEFT JOIN "DataEntryUsage" deu ON deu."entryId" = de.id AND deu."accountId" = ${effectiveCursorId}
            WHERE de."campaignId" = ${campaignId}
              AND NOT EXISTS (
                SELECT 1 FROM "DataEntryUsage" deu2
                WHERE deu2."entryId" = de.id AND deu2."accountId" = ${accountId}
                  AND deu2."usageCount" > 0
              )
              ${accessFilter}
            GROUP BY de."setTag", de."category"
            HAVING COUNT(*) > 0
          ) sub1
        ) sub2
        ${GROUP_DISCOVERY_ORDER_BY}`);
    }
    if (policy === "once_global") {
      // Groups where at least one entry is unused globally.
      // Phase 3.A: now used for group-based selection like per_account policies.
      return client.$queryRaw<GroupRow[]>(Prisma.sql`
        SELECT sub2."setTag", sub2."category"
        FROM (
          SELECT sub1."setTag", sub1."category", sub1.last_used, sub1.group_created_at,
                 MAX(sub1.last_used) OVER (PARTITION BY sub1."category") AS cat_last_used
          FROM (
            SELECT de."setTag", de."category",
                   MAX(de."lastUsedAt") AS last_used,
                   MIN(de."createdAt") AS group_created_at
            FROM "DataEntry" de
            WHERE de."campaignId" = ${campaignId}
              AND de."usageCount" = 0
              AND de."usedInCycle" = false
              ${accessFilter}
            GROUP BY de."setTag", de."category"
            HAVING COUNT(*) > 0
          ) sub1
        ) sub2
        ${GROUP_DISCOVERY_ORDER_BY}`);
    }
    // unlimited — all groups.
    // Phase 3.A: now used for group-based selection (anti-repetition across unlimited libs).
    // Usage ordering uses effectiveCursorId for shared-scope libraries.
    return client.$queryRaw<GroupRow[]>(Prisma.sql`
      SELECT sub2."setTag", sub2."category"
      FROM (
        SELECT sub1."setTag", sub1."category", sub1.last_used, sub1.group_created_at,
               MAX(sub1.last_used) OVER (PARTITION BY sub1."category") AS cat_last_used
        FROM (
          SELECT de."setTag", de."category",
                 MAX(deu."lastUsedAt") AS last_used,
                 MIN(de."createdAt") AS group_created_at
          FROM "DataEntry" de
          LEFT JOIN "DataEntryUsage" deu ON deu."entryId" = de.id AND deu."accountId" = ${effectiveCursorId}
          WHERE de."campaignId" = ${campaignId}
            ${accessFilter}
          GROUP BY de."setTag", de."category"
          HAVING COUNT(*) > 0
        ) sub1
      ) sub2
      ${GROUP_DISCOVERY_ORDER_BY}`);
  }

  // Helper: pick the best entry within a specific (setTag, category) group.
  // Filters applied here mirror the per-policy eligibility.
  async function pickEntryFromGroup(
    setTag: string | null,
    category: string | null,
    policy: "cycle_per_account" | "once_per_account" | "once_global" | "unlimited",
    tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  ): Promise<{ entry: EntryRow; claimState?: DataEntryClaimState } | null> {
    const client = tx ?? prisma;
    const setTagClause = setTag !== null
      ? Prisma.sql`AND de."setTag" = ${setTag}`
      : Prisma.sql`AND de."setTag" IS NULL`;
    const categoryClause = category !== null
      ? Prisma.sql`AND de."category" = ${category}`
      : Prisma.sql`AND de."category" IS NULL`;

    if (policy === "cycle_per_account" && accountId) {
      // Primary within group: not yet claimed by this account
      const rows = await client.$queryRaw<EntryRow[]>(Prisma.sql`
        SELECT de.id, de.fields, de."setTag", de."category" FROM "DataEntry" de
        WHERE de."campaignId" = ${campaignId}
          ${setTagClause}
          ${categoryClause}
          AND NOT EXISTS (
            SELECT 1 FROM "DataEntryUsage" deu2
            WHERE deu2."entryId" = de.id AND deu2."accountId" = ${accountId}
          )
          ${accessFilter}
        ORDER BY de."createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`);
      if (rows[0]) {
        // Phase 8.M1 : skip claim si readOnly (claim posé au submit côté serveur).
        if (!readOnly) {
          await (tx ? tx.dataEntryUsage : prisma.dataEntryUsage).create({
            data: { entryId: rows[0].id, accountId, usageCount: 0, lastUsedAt: new Date() },
          });
        }
        return {
          entry: rows[0],
          claimState: readOnly ? undefined : { entryId: rows[0].id, campaignId, usagePolicy, claimType: "perAccountUsage", accountId },
        };
      }
      // Fallback within group: cycle restart — genuinely used entries
      const fallback = await client.$queryRaw<EntryRow[]>(Prisma.sql`
        SELECT de.id, de.fields, de."setTag", de."category" FROM "DataEntry" de
        LEFT JOIN "DataEntryUsage" deu ON deu."entryId" = de.id AND deu."accountId" = ${accountId}
        WHERE de."campaignId" = ${campaignId}
          ${setTagClause}
          ${categoryClause}
          AND COALESCE(deu."usageCount", 0) >= 1
          ${accessFilter}
        ORDER BY deu."usageCount" ASC, deu."lastUsedAt" ASC NULLS FIRST, de."createdAt" ASC
        FOR UPDATE OF de SKIP LOCKED
        LIMIT 1`);
      if (fallback[0]) return { entry: fallback[0] };
      return null;
    }

    if (policy === "once_per_account" && accountId) {
      const rows = await client.$queryRaw<EntryRow[]>(Prisma.sql`
        SELECT de.id, de.fields, de."setTag", de."category" FROM "DataEntry" de
        WHERE de."campaignId" = ${campaignId}
          ${setTagClause}
          ${categoryClause}
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
        // Phase 8.M1 : skip claim si readOnly.
        if (!readOnly) {
          await (tx ? tx.dataEntryUsage : prisma.dataEntryUsage).upsert({
            where: { entryId_accountId: { entryId: rows[0].id, accountId } },
            update: { lastUsedAt: new Date() },
            create: { entryId: rows[0].id, accountId, usageCount: 0, lastUsedAt: new Date() },
          });
        }
        return {
          entry: rows[0],
          claimState: readOnly ? undefined : { entryId: rows[0].id, campaignId, usagePolicy, claimType: "perAccountUsage", accountId },
        };
      }
      return null;
    }

    if (policy === "once_global") {
      const rows = await client.$queryRaw<EntryRow[]>(Prisma.sql`
        SELECT de.id, de.fields, de."setTag", de."category" FROM "DataEntry" de
        WHERE de."campaignId" = ${campaignId}
          ${setTagClause}
          ${categoryClause}
          AND de."usageCount" = 0
          AND de."usedInCycle" = false
          ${accessFilter}
        ORDER BY de."createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`);
      if (rows[0]) {
        // Phase 8.M1 : skip claim si readOnly.
        if (!readOnly) {
          await (tx ? tx.dataEntry : prisma.dataEntry).update({
            where: { id: rows[0].id },
            data: { usedInCycle: true },
          });
        }
        return {
          entry: rows[0],
          claimState: readOnly ? undefined : { entryId: rows[0].id, campaignId, usagePolicy, claimType: "usedInCycle", accountId },
        };
      }
      return null;
    }

    // unlimited — least used within group, no locking
    const rows = await (tx ?? prisma).$queryRaw<EntryRow[]>(
      accountId
        ? Prisma.sql`SELECT de.id, de.fields, de."setTag", de."category" FROM "DataEntry" de
            LEFT JOIN "DataEntryUsage" deu ON deu."entryId" = de.id AND deu."accountId" = ${accountId}
            WHERE de."campaignId" = ${campaignId}
              ${setTagClause}
              ${categoryClause}
              ${accessFilter}
            ORDER BY COALESCE(deu."usageCount", 0) ASC, deu."lastUsedAt" ASC NULLS FIRST, de."createdAt" ASC
            LIMIT 1`
        : Prisma.sql`SELECT de.id, de.fields, de."setTag", de."category" FROM "DataEntry" de
            WHERE de."campaignId" = ${campaignId}
              ${setTagClause}
              ${categoryClause}
              ${accessFilter}
            ORDER BY de."usageCount" ASC, de."lastUsedAt" ASC NULLS FIRST, de."createdAt" ASC
            LIMIT 1`
    );
    if (rows[0]) return { entry: rows[0] };
    return null;
  }

  let entry: EntryRow | null = null;
  let claimState: DataEntryClaimState | undefined;
  let resolvedSetTag: string | null | undefined;
  let resolvedCategory: string | null | undefined;

  // -----------------------------------------------------------------------
  // Group-based selection when prevCursorState is provided.
  //
  // Phase 3.A: applied to ALL policies (not just per_account) so that
  // once_global and unlimited also benefit from anti-repetition grouping.
  //
  // Phase 3.B: discoverGroups uses effectiveCursorId for usage ordering so
  // shared-scope libs rank group staleness on the shared cursor, not per-account.
  //
  // Fix C2: discoverGroups runs INSIDE the $transaction so its read is consistent
  // with the subsequent FOR UPDATE SKIP LOCKED picks.
  // -----------------------------------------------------------------------
  if (prevCursorState) {
    // Must run inside a transaction so group discovery and claims are atomic.
    await prisma.$transaction(async (tx) => {
      // C2 fix: discoverGroups runs inside the transaction with the tx client.
      const allGroups = await discoverGroups(usagePolicy, tx);

      if (allGroups.length > 0) {
        const eligible = selectEligibleDataGroups(
          allGroups,
          prevCursorState.lastUsedCategory,
          prevCursorState.lastUsedSetTag,
          prevCursorState.hasHistory,
        );
        const candidates = eligible.length > 0 ? eligible : allGroups;

        for (const candidate of candidates) {
          const picked = await pickEntryFromGroup(candidate.setTag, candidate.category, usagePolicy, tx);
          if (picked) {
            entry = picked.entry;
            claimState = picked.claimState;
            resolvedSetTag = candidate.setTag;
            resolvedCategory = candidate.category;
            return; // commit
          }
        }
      }
      // If group-based pick found nothing, fall through to legacy flat selection (entry stays null).
    });
  }

  // -----------------------------------------------------------------------
  // Flat selection (no prevCursorState, or group discovery returned nothing,
  // or policies that don't benefit from group grouping).
  // Preserves ALL original locking semantics.
  // -----------------------------------------------------------------------
  if (!entry) {
    if (usagePolicy === "cycle_per_account") {
      if (accountId) {
        await prisma.$transaction(async (tx) => {
          // Primary: entry never touched by this account
          const rows = await tx.$queryRaw<EntryRow[]>(Prisma.sql`
            SELECT de.id, de.fields, de."setTag", de."category" FROM "DataEntry" de
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
            // Phase 8.M1 : skip claim si readOnly.
            if (!readOnly) {
              await tx.dataEntryUsage.create({
                data: { entryId: rows[0].id, accountId, usageCount: 0, lastUsedAt: new Date() },
              });
              claimState = { entryId: rows[0].id, campaignId, usagePolicy, claimType: "perAccountUsage", accountId, resolvedSetTag: rows[0].setTag, resolvedCategory: rows[0].category };
            }
          } else {
            // Fallback: cycle restart — pick from genuinely used entries (usageCount >= 1), least used first.
            // FOR UPDATE OF de SKIP LOCKED ensures concurrent cron jobs pick distinct entries
            // during a simultaneous cycle restart.
            const fallback = await tx.$queryRaw<EntryRow[]>(Prisma.sql`
              SELECT de.id, de.fields, de."setTag", de."category" FROM "DataEntry" de
              LEFT JOIN "DataEntryUsage" deu ON deu."entryId" = de.id AND deu."accountId" = ${accountId}
              WHERE de."campaignId" = ${campaignId}
                AND COALESCE(deu."usageCount", 0) >= 1
                ${accessFilter}
              ORDER BY deu."usageCount" ASC, deu."lastUsedAt" ASC NULLS FIRST, de."createdAt" ASC
              FOR UPDATE OF de SKIP LOCKED
              LIMIT 1`);
            entry = fallback[0] ?? null;
            // Bug-hunter B4 : poser un claim soft (update lastUsedAt=now) pour
            // que les submits concurrents au cycle restart voient un ordering
            // mis à jour et choisissent une autre entry. Sans ce claim, plusieurs
            // submits simultanés peuvent re-sélectionner la même entry au restart
            // (drift mineur sur usageCount). Comme la condition garantit que
            // DataEntryUsage existe déjà avec usageCount>=1, l'upsert update
            // ne touche que lastUsedAt — recordLibraryUsage au DONE incrémentera
            // normalement, et un revert via DELETE WHERE usageCount=0 sera no-op.
            if (entry && !readOnly) {
              await tx.dataEntryUsage.upsert({
                where: { entryId_accountId: { entryId: entry.id, accountId } },
                update: { lastUsedAt: new Date() },
                create: { entryId: entry.id, accountId, usageCount: 0, lastUsedAt: new Date() },
              });
              claimState = { entryId: entry.id, campaignId, usagePolicy, claimType: "perAccountUsage", accountId, resolvedSetTag: entry.setTag, resolvedCategory: entry.category };
            }
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
            SELECT de.id, de.fields, de."setTag", de."category" FROM "DataEntry" de
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
            // Phase 8.M1 : skip claim si readOnly.
            if (!readOnly) {
              await tx.dataEntryUsage.upsert({
                where: { entryId_accountId: { entryId: rows[0].id, accountId } },
                update: { lastUsedAt: new Date() },
                create: { entryId: rows[0].id, accountId, usageCount: 0, lastUsedAt: new Date() },
              });
              claimState = { entryId: rows[0].id, campaignId, usagePolicy, claimType: "perAccountUsage", accountId, resolvedSetTag: rows[0].setTag, resolvedCategory: rows[0].category };
            }
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
            SELECT de.id, de.fields, de."setTag", de."category" FROM "DataEntry" de
            WHERE de."campaignId" = ${campaignId}
              AND de."usageCount" = 0
              AND de."usedInCycle" = false
              ${accessFilter}
            ORDER BY de."createdAt" ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1`);
          if (rows[0]) {
            entry = rows[0];
            // Phase 8.M1 : skip claim si readOnly.
            if (!readOnly) {
              await tx.dataEntry.update({ where: { id: rows[0].id }, data: { usedInCycle: true } });
              claimState = { entryId: rows[0].id, campaignId, usagePolicy, claimType: "usedInCycle", accountId, resolvedSetTag: rows[0].setTag, resolvedCategory: rows[0].category };
            }
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
  }

  if (!entry) return null;

  let fields: Record<string, string> = {};
  try {
    fields = JSON.parse(entry.fields) as Record<string, string>;
  } catch {
    fields = {};
  }

  return { entryId: entry.id, fields, claimState, resolvedSetTag, resolvedCategory };
}
