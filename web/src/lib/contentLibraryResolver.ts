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
import { resolveRotationMode } from "@/lib/rotation/rotationMode";
import type {
  TemplateJSON, VideoBlock, MusicBlock, VideoSequenceSlot,
  MediaSelectionRule, MediaSelectionRuleConfig,
} from "@/types/template";
import {
  SHARED_USAGE_ACCOUNT_ID,
  SHARED_DATA_USAGE_ACCOUNT_ID,
} from "@/lib/rotation/sentinels";
import {
  estimateSequenceDuration,
  estimateSingleVideoDuration,
  resolveRequiredAudioDuration,
} from "@/lib/generate/estimateOutputDuration";

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
 *
 * Mirror croisé (A.3, P5 hardening 21/08) : `web/src/app/api/libraries/[libraryId]/assets/route.ts`
 * (picker « Changer » du form de génération) rejoue la MÊME sémantique
 * d'accès en Prisma ORM via `buildAssetsAccessWhere`
 * (`lib/generate/libraryAssetsQuery.ts`) — même repli strict (pool public
 * uniquement) quand `accountId` est absent. Une version antérieure de ce
 * fix relâchait ce filtre côté picker (A.2 : « montrer tout » plutôt que
 * replier sur le pool public), au motif que c'est une liste que l'user
 * choisit consciemment (revalidée au submit par `validateManualAssetSelection`) —
 * revert suite à revue de sécurité : ça exposait la vignette/lecture d'assets
 * restreints à un autre client à tout user authentifié ouvrant le picker
 * sans compte sélectionné, ce que `validateManualAssetSelection` ne referme
 * pas (elle bloque l'USAGE au submit, pas la preview). Garder les deux
 * fragments en phase si la sémantique d'accès change ici.
 */
export function buildAccessFilter(accountId: string | undefined): Prisma.Sql {
  return accountId
    ? Prisma.sql`AND ma."disabled" = false
        AND (NOT EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id)
        OR EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id AND acc."accountId" = ${accountId}))`
    : Prisma.sql`AND ma."disabled" = false
        AND NOT EXISTS (SELECT 1 FROM "MediaAssetAccess" acc WHERE acc."assetId" = ma.id)`;
}

/**
 * Découverte des dossiers (`setTag`) d'une bibliothèque média — modèle
 * « dossiers simples » (plan simplification, 2026-08).
 *
 * Un dossier = un `setTag` ; les assets sans setTag forment le dossier virtuel
 * `(sans dossier)` (`setTag IS NULL`), traité comme un dossier normal.
 *
 * Tri : le dossier servi le moins récemment d'abord —
 *   0. has_unused DESC (P8, régression 2026-08-21 : un dossier contenant au
 *      moins un asset jamais servi passe TOUJOURS devant, même si son
 *      MAX(lastUsedAt) est récent. Sans ce critère, `MAX()` ignore les NULL :
 *      un dossier « à moitié neuf » — 1 asset servi hier + 9 neufs — est
 *      classé comme entièrement consommé, et un dossier 100% consommé il y a
 *      3 semaines passe devant lui → on resert du déjà-vu alors que du stock
 *      neuf attend. Réintroduit du commit 6b435b3 (13/08), supprimé par
 *      inadvertance au refactor « dossiers simples » 86a18d0 (16/08). Pas de
 *      filtre `disabled` dans le COUNT : le WHERE (accessFilter) l'exclut déjà
 *      de la sous-requête.) ;
 *   1. MAX(lastUsedAt) ASC NULLS FIRST (parmi ceux à égalité sur has_unused,
 *      un dossier jamais servi passe devant ; après usage, son MAX devient
 *      récent → il redescend naturellement : anti-répétition douce sans aucun
 *      état de curseur) ;
 *   2. MIN(createdAt) ASC (parmi les jamais-servis, ordre d'upload) ;
 *   3. setTag ASC NULLS LAST (tiebreaker déterministe, LPAD numérique).
 *
 * @param usageAccountId Clé d'ancienneté `MediaAssetUsage` (compte réel, ou
 *                       sentinel `__shared__` pour les libs partagées). Absent =
 *                       pool global, l'ancienneté retombe sur `MediaAsset.lastUsedAt`.
 */
function buildFolderDiscoveryQuery(opts: {
  libraryId: string;
  usageAccountId?: string;
  accessFilter: Prisma.Sql;
  burnFilter: Prisma.Sql;
  tagFrag: Prisma.Sql;
}): Prisma.Sql {
  const { libraryId, usageAccountId, accessFilter, burnFilter, tagFrag } = opts;
  const lastUsedExpr = usageAccountId
    ? Prisma.sql`MAX(mau."lastUsedAt")`
    : Prisma.sql`MAX(ma."lastUsedAt")`;
  const usageJoin = usageAccountId
    ? Prisma.sql`LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${usageAccountId}`
    : Prisma.empty;
  // « Jamais servi » = aucune ligne d'usage pour ce compte (ou, sans clé
  // d'usage, MediaAsset.lastUsedAt lui-même directement).
  const unusedExpr = usageAccountId
    ? Prisma.sql`mau."lastUsedAt" IS NULL`
    : Prisma.sql`ma."lastUsedAt" IS NULL`;

  return Prisma.sql`
    SELECT sub."setTag"
    FROM (
      SELECT ma."setTag",
             ${lastUsedExpr} AS last_used,
             MIN(ma."createdAt") AS folder_created_at,
             COUNT(*) FILTER (WHERE ${unusedExpr}) > 0 AS has_unused
      FROM "MediaAsset" ma
      ${usageJoin}
      WHERE ma."libraryId" = ${libraryId}
        ${tagFrag}
        ${accessFilter}
        ${burnFilter}
      GROUP BY ma."setTag"
      HAVING COUNT(*) FILTER (WHERE NOT ma."disabled") > 0
    ) sub
    ORDER BY sub.has_unused DESC,
             sub.last_used ASC NULLS FIRST,
             sub.folder_created_at ASC NULLS LAST,
             CASE WHEN sub."setTag" ~ '^[0-9]+$' THEN LPAD(sub."setTag", 20, '0') ELSE sub."setTag" END ASC NULLS LAST`;
}

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
  /** Voir UsageScopeMode. Défaut "library" (scope-aware) ; l'audio passe "account". */
  usageScope: UsageScopeMode = "library",
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
      usageScope,
    });
    if (!picked) return null;

    // Claim immédiat : marque l'asset comme "déjà pris" pour les
    // concurrents qui attendent l'unlock (post-commit). Pour per_account :
    // upsert MediaAssetUsage avec lastUsedAt=now. Pour shared :
    // increment MediaAsset.usageCount.
    //
    // `picked.claimAccountId` est la clé sur laquelle la sélection vient de trier
    // (sentinelle __shared__ en scope shared, compte réel sinon). Le claim DOIT
    // stamper la même, sous peine de désynchroniser sélection et claim : c'est
    // exactement le bug qui figeait la rotation des libs shared entre le submit et
    // le DONE. Toutes les stratégies la renseignent désormais, plus seulement
    // theme_sequence.
    const claimAccountId = picked.claimAccountId ?? accountId;
    // Le claim ne stampe QUE `lastUsedAt` : il réserve l'asset (il redescend
    // immédiatement dans la pile pour les générations concurrentes) sans le
    // consommer. L'incrément de `usageCount` — celui qui pilote le burn-once —
    // appartient à `recordLibraryUsage`, au DONE.
    //
    // Avant, ce claim incrémentait déjà `usageCount`, et `recordLibraryUsage`
    // ré-incrémentait ensuite : +2 par render sur ce chemin contre +1 sur le
    // tirage par dossier. Avec `maxUsageCount = N`, la capacité réelle des
    // bibliothèques concernées était donc N/2, et les assets sortaient du pool
    // deux fois trop vite.
    if (claimAccountId) {
      await tx.mediaAssetUsage.upsert({
        where: { assetId_accountId: { assetId: picked.id, accountId: claimAccountId } },
        create: {
          assetId: picked.id,
          accountId: claimAccountId,
          usageCount: 0,
          lastUsedAt: new Date(),
        },
        update: {
          lastUsedAt: new Date(),
        },
      });
    } else {
      await tx.mediaAsset.update({
        where: { id: picked.id },
        data: {
          lastUsedAt: new Date(),
        },
      });
    }

    return { id: picked.id, url: picked.url, filename: picked.filename, metadata: picked.metadata };
  });
}

/**
 * Comment dériver la clé d'ancienneté (`MediaAssetUsage.accountId`) sur laquelle
 * la sélection trie ET le claim stampe.
 *
 * - `"library"` (défaut) : la clé suit le `rotationScope` de la bibliothèque —
 *   sentinelle `__shared__` en scope shared, compte réel en per_account. C'est
 *   déjà ce que fait `selectMediaAssetFromFolder`, et c'est indispensable pour
 *   que le claim posé au submit soit relu par la sélection suivante : sinon,
 *   sur une lib shared, on trie sur les colonnes globales de MediaAsset (écrites
 *   seulement au DONE) pendant que le claim écrit une ligne que personne ne lit,
 *   et la rotation reste figée pendant toute la durée d'un render.
 * - `"account"` : ancienne sémantique, toujours le compte réel. Conservé pour
 *   l'audio, dont le passage en scope-aware est un changement de comportement
 *   produit traité séparément (`rotationScope` est aujourd'hui silencieusement
 *   ignoré pour les bibliothèques audio).
 *
 * La visibilité (`buildAccessFilter`) utilise TOUJOURS le compte réel, jamais la
 * sentinelle — c'est une question de droits, pas d'ancienneté.
 */
export type UsageScopeMode = "library" | "account";

/** Clé d'ancienneté effective pour une bibliothèque donnée. */
function resolveUsageAccountId(
  mode: UsageScopeMode,
  rotationScope: string | null | undefined,
  accountId: string | undefined,
): string | undefined {
  if (mode === "account") return accountId;
  return rotationScope === "shared" ? SHARED_USAGE_ACCOUNT_ID : accountId;
}

/** Clé de burn-once : global (`ma.usageCount`) en shared, par compte sinon. */
function resolveBurnAccountId(
  mode: UsageScopeMode,
  rotationScope: string | null | undefined,
  accountId: string | undefined,
): string | undefined {
  if (mode === "account") return accountId;
  return rotationScope === "shared" ? undefined : accountId;
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
  usageScope?: UsageScopeMode;
}): Promise<{
  id: string; url: string; filename: string; metadata: Record<string, string | number | null>;
  /** Clé sous laquelle le claim (posé par le caller `selectAndClaimMediaAsset`)
   *  doit stamper `MediaAssetUsage.lastUsedAt`. Toujours renseignée quand une clé
   *  existe : elle DOIT être identique à celle sur laquelle la sélection vient de
   *  trier, sinon découverte et claim se désynchronisent et l'asset ne redescend
   *  jamais dans la pile. Absente uniquement quand il n'y a aucune clé (pas de
   *  compte et lib per_account) — le caller retombe alors sur le compteur global. */
  claimAccountId?: string;
} | null> {
  const { tx, libraryId, rule, formData, accountId, excludeAssetIds, minDuration } = args;
  const usageScope: UsageScopeMode = args.usageScope ?? "library";
  const config = normalizeRule(rule);
  const { strategy } = config;
  if (strategy === "manual") return null;

  const lib = await tx.mediaLibrary.findUnique({
    where: { id: libraryId },
    select: { maxUsageCount: true, rotationMode: true, rotationScope: true },
  });
  if (lib?.rotationMode === "none") return null;

  // Clés dérivées une seule fois, partagées par toutes les stratégies (la branche
  // theme_sequence les recalculait déjà pour son compte ; les branches régulières,
  // elles, prenaient le compte réel même sur une lib shared).
  const usageAccountId = resolveUsageAccountId(usageScope, lib?.rotationScope, accountId);
  const burnAccountId = resolveBurnAccountId(usageScope, lib?.rotationScope, accountId);

  const tagFrag = buildTagFragment(config, formData);
  const burnFilter = buildBurnFilter(lib?.maxUsageCount ?? null, burnAccountId);
  const accessFilter = buildAccessFilter(accountId);
  const excludeFrag = excludeAssetIds && excludeAssetIds.length > 0
    ? Prisma.sql`AND ma.id NOT IN (${Prisma.join(excludeAssetIds.map((id) => Prisma.sql`${id}`), ", ")})`
    : Prisma.sql``;
  const durationFrag = minDuration != null && minDuration > 0
    ? Prisma.sql`AND ma.duration >= ${minDuration}`
    : Prisma.sql``;

  type AssetRow = { id: string; url: string; filename: string; metadata: string };

  // Fix #7 (P8 rotation) : avant cette branche, un VideoBlock simple (hors
  // sequence template) avec la stratégie "theme_sequence" (ex.
  // resolveVideoBlockAsset → selectAndClaimMediaAsset) tombait dans le `else`
  // générique ci-dessous (least_used global, sans notion de dossier) — aucun
  // tirage par dossier, aucun warn, symptôme identique à #2. On branche ici le
  // même tirage par dossier que selectMediaAssetFromFolder (découverte +
  // pioche LRU intra-dossier), dans la MÊME transaction et sous le MÊME verrou
  // FOR UPDATE SKIP LOCKED que les autres stratégies — pas de CAS nécessaire,
  // la sérialisation est déjà garantie par le lock ligne. `claimAccountId` est
  // remonté au caller (`selectAndClaimMediaAsset`) pour que le claim stampe la
  // MÊME clé que la découverte (compte réel en per_account, sentinelle
  // __shared__ en shared) — sans ça, la découverte shared trierait sur
  // __shared__ mais le claim écrirait sous le compte réel : le dossier ne
  // redescendrait jamais dans la pile (même bug que #2, au niveau du claim).
  if (strategy === "theme_sequence") {
    // Burn-once dossier : même règle que selectMediaAssetFromFolder (compte
    // réel en per_account, global ma.usageCount en shared). minDuration est
    // baked dedans (pattern folder-draw établi) plutôt que ré-appliqué via
    // durationFrag, pour éviter une double condition redondante.
    const folderBurnFilter = buildBurnFilter(lib?.maxUsageCount ?? null, burnAccountId, minDuration);

    const folders = await tx.$queryRaw<{ setTag: string | null }[]>(
      buildFolderDiscoveryQuery({ libraryId, usageAccountId, accessFilter, burnFilter: folderBurnFilter, tagFrag }),
    );
    for (const folder of folders) {
      const setTagClause = folder.setTag !== null
        ? Prisma.sql`AND ma."setTag" = ${folder.setTag}`
        : Prisma.sql`AND ma."setTag" IS NULL`;
      const usageJoin = usageAccountId
        ? Prisma.sql`LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${usageAccountId}`
        : Prisma.sql``;
      const pickOrderClause = usageAccountId
        ? Prisma.sql`ORDER BY mau."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC`
        : Prisma.sql`ORDER BY ma."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC`;
      const rows = await tx.$queryRaw<AssetRow[]>(Prisma.sql`
        SELECT ma.id, ma.url, ma.filename, ma.metadata FROM "MediaAsset" ma
        ${usageJoin}
        WHERE ma."libraryId" = ${libraryId}
          ${setTagClause}
          ${tagFrag}
          ${excludeFrag}
          ${accessFilter}
          ${folderBurnFilter}
        ${pickOrderClause}
        LIMIT 1
        FOR UPDATE OF ma SKIP LOCKED`);
      if (rows[0]) {
        let metadata: Record<string, string | number | null> = {};
        try { metadata = JSON.parse(rows[0].metadata ?? "{}") as Record<string, string | number | null>; } catch { /* keep empty */ }
        return {
          id: rows[0].id, url: rows[0].url, filename: rows[0].filename, metadata,
          ...(usageAccountId ? { claimAccountId: usageAccountId } : {}),
        };
      }
    }
    return null;
  }

  // Ordering selon strategy. FOR UPDATE SKIP LOCKED appliqué à la fin.
  // Le tri porte sur `usageAccountId` (sentinelle __shared__ en scope shared), pas
  // sur `accountId` : c'est la clé que le claim va stamper juste après.
  let orderClause: Prisma.Sql;
  let joinClause: Prisma.Sql = Prisma.sql``;
  if (strategy === "random") {
    orderClause = Prisma.sql`ORDER BY RANDOM()`;
  } else if (strategy === "oldest_used") {
    if (usageAccountId) {
      joinClause = Prisma.sql`LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${usageAccountId}`;
      orderClause = Prisma.sql`ORDER BY mau."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC`;
    } else {
      orderClause = Prisma.sql`ORDER BY ma."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC`;
    }
  } else {
    if (usageAccountId) {
      joinClause = Prisma.sql`LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${usageAccountId}`;
      orderClause = Prisma.sql`ORDER BY COALESCE(mau."usageCount", 0) ASC, mau."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC`;
    } else {
      orderClause = Prisma.sql`ORDER BY ma."usageCount" ASC, ma."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC`;
    }
  }

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
  return {
    id: rows[0].id, url: rows[0].url, filename: rows[0].filename, metadata,
    // Remontée systématique (et plus seulement pour theme_sequence) : le claim doit
    // stamper la clé sur laquelle on vient de trier, y compris sur une lib shared.
    ...(usageAccountId ? { claimAccountId: usageAccountId } : {}),
  };
}

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
 *
 * Mirror croisé (A.3, P5 hardening 21/08) : `web/src/app/api/libraries/[libraryId]/assets/route.ts`
 * rejoue cette sémantique en Prisma ORM via `buildAssetsBurnWhere` +
 * `resolveBurnAccountId` (`lib/generate/libraryAssetsQuery.ts`) — même défaut
 * scope-aware que `selectMediaAssetFromFolder` (compteur global pour les libs
 * `shared`, jamais la sentinelle). Garder les deux fragments en phase si la
 * sémantique burn-once change ici.
 */
export function buildBurnFilter(maxUsageCount: number | null, accountId?: string, minDuration?: number): Prisma.Sql {
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
  /** Voir UsageScopeMode. Défaut "library" (scope-aware) ; l'audio passe "account". */
  usageScope: UsageScopeMode = "library",
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
    select: { maxUsageCount: true, rotationMode: true, rotationScope: true },
  });
  if (lib?.rotationMode === "none") return null;

  // La clé d'ancienneté se dérive ICI du scope de la bibliothèque, comme le fait
  // déjà selectMediaAssetFromFolder — les appelants n'ont plus à la calculer (et
  // n'ont plus à connaître la sentinelle). Sans ça, une lib shared triait sur les
  // colonnes globales de MediaAsset, écrites seulement au DONE, pendant que
  // advanceMediaUsageOnSubmit claimait sous __shared__ : la pile ne bougeait pas
  // entre le submit et la fin du render.
  const usageAccountId = resolveUsageAccountId(usageScope, lib?.rotationScope, accountId);
  const burnFilter = buildBurnFilter(lib?.maxUsageCount ?? null, resolveBurnAccountId(usageScope, lib?.rotationScope, accountId));

  // Access filter: toujours le compte RÉEL (droits de visibilité), jamais la sentinelle.
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
    if (usageAccountId) {
      const rows = await client.$queryRaw<AssetRow[]>(
        Prisma.sql`SELECT ma.id, ma.url, ma.filename, ma.metadata FROM "MediaAsset" ma
          LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${usageAccountId}
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
  if (usageAccountId) {
    const rows = await client.$queryRaw<AssetRow[]>(
      Prisma.sql`SELECT ma.id, ma.url, ma.filename, ma.metadata FROM "MediaAsset" ma
        LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${usageAccountId}
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
): Promise<{ id: string; url: string; filename: string; setTag: string | null; metadata: Record<string, string | number | null> } | null> {
  const accessFilter = buildAccessFilter(accountId);

  // Filter in PostgreSQL on the JSON metadata field: cast to text and use jsonb operator
  // NB : ne plus jamais SELECTionner ma.category ici — colonne morte (Phase 3),
  // droppée au deploy N+1 (le raw SQL casserait sans erreur de compilation).
  const rows = await prisma.$queryRaw<{ id: string; url: string; filename: string; setTag: string | null; metadata: string }[]>(
    Prisma.sql`SELECT ma.id, ma.url, ma.filename, ma."setTag", ma.metadata FROM "MediaAsset" ma
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
 * Sélection « dossier simple » — remplace l'ancienne stratégie theme_sequence
 * (curseurs + anti-répétition multi-niveaux, décommissionnés au plan
 * simplification 2026-08).
 *
 * @public — also used by generateSequenceRender for slot resolution at render time.
 *
 * Algo (zéro état, aucune écriture) :
 *   1. `rotationMode = "none"` → null (sélection metadata/manuelle uniquement).
 *   2. `pinnedSetTag` fourni (2e+ bloc de la même lib dans une génération,
 *      ex. paire intro/outro filmée ensemble) → pioche directement dans ce
 *      dossier, least-recently-used.
 *   3. Sinon : découverte des dossiers éligibles (≥1 asset actif passant
 *      accès/burn/tags/durée), ordonnés du moins récemment servi au plus
 *      récent (cf. buildFolderDiscoveryQuery), puis pioche least-recently-used
 *      dans le premier dossier qui a un asset éligible.
 *
 * L'anti-répétition découle du tri : servir un dossier rafraîchit son
 * MAX(lastUsedAt) (claim au submit via advanceMediaUsageOnSubmit + usage au
 * DONE via recordLibraryUsage) → il redescend dans la pile.
 */
export async function selectMediaAssetFromFolder(
  libraryId: string,
  accountId: string | undefined,
  tagFilter?: string,          // legacy single-tag filter (ignored when ruleConfig provided)
  pinnedSetTag?: string | null,
  ruleConfig?: MediaSelectionRuleConfig,
  /** MediaAssetUsage ordering key. Defaults to accountId.
   *  Set to SHARED_USAGE_ACCOUNT_ID for shared-scope libraries so all accounts
   *  share the same recency state. */
  usageAccountId?: string,
  /** Filtre les assets dont la durée est inférieure à minDuration (NULL permis). */
  minDuration?: number,
): Promise<{ id: string; url: string; filename: string; resolvedSetTag: string | null } | null> {
  const library = await prisma.mediaLibrary.findUnique({
    where: { id: libraryId },
    select: { maxUsageCount: true, rotationScope: true, rotationMode: true },
  });
  if (!library) return null;
  if (resolveRotationMode(library, "selectMediaAssetFromFolder").mode === "none") return null;

  const isSharedScope = library.rotationScope === "shared";

  // Fix #2 (P8 rotation) : clé d'ancienneté usage — compte réel explicite si
  // fourni par l'appelant, sinon dérivée du scope de LA BIBLIOTHÈQUE elle-même
  // (sentinelle __shared__ en shared, compte réel en per_account) plutôt que de
  // retomber bêtement sur `accountId`. Cette fonction charge déjà
  // `rotationScope` : le défaut se fixe donc ici, pas chez les appelants.
  // Sans ce défaut scope-aware, la redécouverte render-time
  // (generateRender.ts, usageAccountId=undefined) triait une lib shared sur le
  // compte réel — vide la plupart du temps — et resservait toujours le même
  // dossier.
  const effectiveUsageId = usageAccountId ?? (isSharedScope ? SHARED_USAGE_ACCOUNT_ID : accountId);

  // Burn-once — per_account : par compte réel ; shared : global (ma.usageCount).
  const burnAccountId = isSharedScope ? undefined : accountId;
  const burnFilter = buildBurnFilter(library.maxUsageCount ?? null, burnAccountId, minDuration);

  const tagFrag: Prisma.Sql = ruleConfig
    ? buildTagFragment(ruleConfig)
    : tagFilter
      ? Prisma.sql`AND lower(ma.tags) ILIKE ${`%"${tagFilter.toLowerCase()}"%`}`
      : Prisma.sql``;

  // Visibilité : toujours le compte réel (jamais la clé d'usage shared).
  const accessFilter: Prisma.Sql = buildAccessFilter(accountId);

  type AssetRow = { id: string; url: string; filename: string };

  // Pioche least-recently-used dans un dossier donné (setTag null = « (sans dossier) »).
  async function pickFromFolder(setTag: string | null): Promise<AssetRow | null> {
    const setTagClause = setTag !== null
      ? Prisma.sql`AND ma."setTag" = ${setTag}`
      : Prisma.sql`AND ma."setTag" IS NULL`;

    if (effectiveUsageId) {
      const rows = await prisma.$queryRaw<AssetRow[]>(Prisma.sql`
        SELECT ma.id, ma.url, ma.filename FROM "MediaAsset" ma
        LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${effectiveUsageId}
        WHERE ma."libraryId" = ${libraryId}
          ${setTagClause}
          ${tagFrag}
          ${accessFilter}
          ${burnFilter}
        ORDER BY mau."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`);
      return rows[0] ?? null;
    }
    const rows = await prisma.$queryRaw<AssetRow[]>(Prisma.sql`
      SELECT ma.id, ma.url, ma.filename FROM "MediaAsset" ma
      WHERE ma."libraryId" = ${libraryId}
        ${setTagClause}
        ${tagFrag}
        ${accessFilter}
        ${burnFilter}
      ORDER BY ma."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1`);
    return rows[0] ?? null;
  }

  // --- Dossier épinglé (2e+ bloc de la même lib dans une génération) ---
  if (pinnedSetTag !== undefined) {
    const row = await pickFromFolder(pinnedSetTag);
    return row ? { ...row, resolvedSetTag: pinnedSetTag } : null;
  }

  // --- Découverte + pioche dans le dossier le moins récemment servi ---
  const folders = await prisma.$queryRaw<{ setTag: string | null }[]>(
    buildFolderDiscoveryQuery({ libraryId, usageAccountId: effectiveUsageId, accessFilter, burnFilter, tagFrag }),
  );
  for (const folder of folders) {
    const row = await pickFromFolder(folder.setTag);
    if (row) return { ...row, resolvedSetTag: folder.setTag };
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
  /**
   * Returns the cursor/usage-ordering account ID:
   * - shared libraries → SHARED_USAGE_ACCOUNT_ID so all accounts advance the same cursor
   * - per-account libraries → real accountId
   * - no accountId at all → undefined (admin preview, no cursor)
   *
   * Note : `selectMediaAsset` et `selectMediaAssetFromFolder` savent désormais
   * dériver cette clé eux-mêmes depuis le `rotationScope` de la bibliothèque —
   * on leur passe le compte RÉEL. Cette fonction ne sert plus qu'aux appels
   * folder-draw qui la fournissent explicitement.
   */
  function effectiveCursorAccountId(libId: string): string | undefined {
    return libScopeMap.get(libId) === "shared" ? SHARED_USAGE_ACCOUNT_ID : accountId;
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
          // Compte RÉEL : selectMediaAsset dérive lui-même la clé d'ancienneté du
          // scope de la bibliothèque (sentinelle __shared__ en shared).
          accountId,
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
        let pinnedSetTag: string | null | undefined = undefined;
        for (const b of blocks) {
          const rule = normalizeRule(b.selectionRule);
          // Accès (2e arg) = TOUJOURS le compte réel : buildAccessFilter porte sur
          // la visibilité, pas sur l'ancienneté (6e arg). Passer la sentinelle ici
          // réduirait le pool prefill shared aux seuls assets sans restriction de
          // compte, alors que le render-time passe le compte réel — pools divergents
          // entre le formulaire et la vidéo finale.
          const suggestion = await selectMediaAssetFromFolder(
            libId,
            accountId,
            undefined,
            pinnedSetTag,
            rule,
            effectiveCursorAccountId(libId),
            (b as { minDuration?: number }).minDuration,
          );
          if (suggestion) {
            result.videoSuggestions[b.id] = {
              id: suggestion.id,
              url: suggestion.url,
              filename: suggestion.filename,
            };
            if (pinnedSetTag === undefined) {
              pinnedSetTag = suggestion.resolvedSetTag;
              if (suggestion.resolvedSetTag) {
                result.usedSetTagByLibrary![libId] = suggestion.resolvedSetTag;
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
            accountId,
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
        let pinnedSetTag: string | null | undefined = undefined;
        for (const s of slots) {
          const rule = normalizeRule(s.selectionRule);
          // Phase 4 : passe slot.maxDuration comme minimum requis pour l'asset.
          const slotMinDuration = s.maxDuration && s.maxDuration > 0 ? s.maxDuration : undefined;
          // Fix #5 (P8 rotation) : idem ci-dessus — compte réel en 2e arg.
          const suggestion = await selectMediaAssetFromFolder(
            libId,
            accountId,
            undefined,
            pinnedSetTag,
            rule,
            effectiveCursorAccountId(libId),
            slotMinDuration,
          );
          if (suggestion) {
            result.videoSuggestions[s.id] = {
              id: suggestion.id,
              url: suggestion.url,
              filename: suggestion.filename,
            };
            if (pinnedSetTag === undefined) {
              pinnedSetTag = suggestion.resolvedSetTag;
              if (suggestion.resolvedSetTag) {
                result.usedSetTagByLibrary![libId] = suggestion.resolvedSetTag;
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
    // Estimation de la durée de sortie, via le helper partagé avec le render-time
    // (lib/generate/estimateOutputDuration). Avant, deux estimations divergentes
    // coexistaient et toutes deux comptaient 0 pour un slot sans plafond — donc
    // `audioMinDuration = undefined`, donc aucun filtre de durée : c'est ainsi
    // qu'une piste de 20 s partait sur une vidéo de 60 s.
    const seq = template.videoSequence ?? [];
    const pickedIds = seq.length > 0
      ? seq.map((slot) => result.videoSuggestions[slot.id]?.id).filter((id): id is string => !!id)
      : Object.values(result.videoSuggestions).map((s) => s.id);
    const durationByAssetId = new Map<string, number | null>();
    if (pickedIds.length > 0) {
      const rows = await prisma.mediaAsset.findMany({
        where: { id: { in: [...new Set(pickedIds)] } },
        select: { id: true, duration: true },
      });
      for (const row of rows) durationByAssetId.set(row.id, row.duration);
    }

    const estimate = seq.length > 0
      ? estimateSequenceDuration(
          seq.map((slot) => ({
            id: slot.id,
            assetDuration: durationByAssetId.get(result.videoSuggestions[slot.id]?.id ?? "") ?? null,
            cap: slot.maxDuration,
          })),
          template.canvas?.maxDuration,
        )
      : estimateSingleVideoDuration(
          Object.entries(result.videoSuggestions).map(([blockId, suggestion]) => ({
            id: blockId,
            assetDuration: durationByAssetId.get(suggestion.id) ?? null,
          })),
          template.canvas?.maxDuration,
        );

    // `minDuration` du bloc ET durée estimée : les deux sont des planchers, on
    // prend le max. Le prefill ignorait purement et simplement `minDuration`,
    // alors que le builder le documente comme excluant les assets trop courts
    // « en AUTO et MANUEL ».
    const audioMinDuration = resolveRequiredAudioDuration(musicBlock, estimate);
    if (estimate.partial && audioMinDuration) {
      console.warn(
        `[resolveLibraryPrefill] durée estimée partielle (${estimate.seconds.toFixed(1)}s) — ` +
          `sources sans durée ni plafond : ${estimate.unknownSourceIds.join(", ")}. ` +
          `Filtre audio appliqué en borne inférieure.`,
      );
    }

    const audioLibraryId = musicBlock.libraryId;

    // Guard against stale template references: if the library was deleted, skip silently.
    const audioLibraryExists = await prisma.mediaLibrary.findUnique({
      where: { id: audioLibraryId },
      select: { id: true },
    });
    if (!audioLibraryExists) {
      console.warn(`[resolveLibraryPrefill] audioLibraryId=${audioLibraryId} introuvable — sélection audio ignorée`);
    } else {

    // L'audio reste volontairement sur l'ancienne sémantique (clé = compte réel).
    // `rotationScope` est aujourd'hui ignoré pour les bibliothèques audio — le
    // corriger change le comportement produit (burn-once global au lieu de par
    // compte), donc c'est un chantier séparé et annoncé.
    const audioUsageScope = "account" as const;

    // Read-only: just pick the best audio asset without stamping lastUsedAt.
    // The actual usage claim (MediaAssetUsage.lastUsedAt) is written at submission time
    // via advanceAudioUsageOnSubmit called from POST /api/renders.
    result.audioSuggestion = await selectMediaAsset(
      audioLibraryId,
      musicBlock.audioSelectionRule,
      formData,
      accountId,
      undefined,
      audioMinDuration,
      undefined,
      audioUsageScope,
    );
    } // end audioLibraryExists guard
  }

  // --- Data library ---
  // Phase 4 : résolution par libraryId direct. Les templates existants portent
  // encore `dataCampaignId` — on le résout en libraryId tant que la table
  // DataCampaign existe (drop N+1 : script one-shot de mise à jour des
  // TemplateJSON, cf. plan simplification).
  if (template.contentLibrary?.dataLibraryId || template.contentLibrary?.dataCampaignId) {
    let dataLibraryId: string | undefined = template.contentLibrary.dataLibraryId;
    if (!dataLibraryId && template.contentLibrary.dataCampaignId) {
      const campaign = await prisma.dataCampaign.findUnique({
        where: { id: template.contentLibrary.dataCampaignId },
        select: { libraryId: true },
      });
      dataLibraryId = campaign?.libraryId;
    }
    if (dataLibraryId) {
      // Read-only par nature : aucune écriture au SSR. Le claim d'usage
      // (advanceDataUsageOnSubmit) se fait à POST /api/renders.
      const dataSuggestion = await selectDataEntry(
        dataLibraryId,
        template.contentLibrary.dataSelectionRule,
        accountId,
      );
      if (dataSuggestion) {
        result.dataSuggestion = {
          entryId: dataSuggestion.entryId,
          fields: dataSuggestion.fields,
          resolvedSetTag: dataSuggestion.resolvedSetTag,
        };
      }
    }
  }

  return result;
}

/**
 * Claim d'usage des assets vidéo au moment du submit (POST /api/renders).
 *
 * Remplace l'avance de curseur (AccountLibraryCursor, décommissionné) : on
 * stampe `MediaAssetUsage.lastUsedAt = now` pour chaque asset servi, sous la
 * clé d'usage de la bibliothèque (compte réel en per_account, sentinel
 * `__shared__` en shared). C'est ce stamp qui fait redescendre le dossier dans
 * la pile du tirage — deux générations rapprochées ne resservent donc pas le
 * même dossier, même avant le DONE du premier render.
 *
 * `usageCount` n'est PAS incrémenté ici — il l'est au DONE par
 * recordLibraryUsage (même contrat que advanceAudioUsageOnSubmit).
 *
 * Retourne un snapshot par asset pour le revert conditionnel (render failure) :
 * même sémantique CAS que le revert audio dans revertAdvancesOnFailure.
 */
export type MediaUsageClaimState = {
  assetId: string;
  accountId: string;
  /** lastUsedAt avant notre écriture (null = la ligne n'existait pas). */
  prevLastUsedAt: string | null;
  /** lastUsedAt que NOUS avons écrit — condition de revert. */
  claimedLastUsedAt: string;
};

export async function advanceMediaUsageOnSubmit(
  videoAssetIds: string[],
  /** Fix #4 (P8 rotation) : optionnel — une lib `shared` claim quand même
   *  (sous la sentinelle), seule une lib `per_account` sans compte est
   *  réellement sautée. */
  accountId: string | undefined,
): Promise<{ prevMediaUsageStates: MediaUsageClaimState[] }> {
  const states: MediaUsageClaimState[] = [];
  if (videoAssetIds.length === 0) return { prevMediaUsageStates: states };

  // Résout la clé d'usage par asset selon le scope de SA bibliothèque.
  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: videoAssetIds } },
    select: { id: true, library: { select: { rotationScope: true } } },
  });
  const now = new Date();

  for (const asset of assets) {
    const usageAccountId =
      asset.library.rotationScope === "shared" ? SHARED_USAGE_ACCOUNT_ID : accountId;
    // Lib shared : usageAccountId toujours défini (sentinelle) → claim posé
    // même sans compte réel. Lib per_account sans compte : rien à claimer sous
    // — on avertit et on passe au suivant plutôt que d'écrire sous une clé
    // invalide ou de crasher.
    if (!usageAccountId) {
      console.warn(
        `[advanceMediaUsageOnSubmit] asset=${asset.id} lib per_account sans accountId — claim ignoré (l'asset ne redescendra pas dans la pile de rotation pour ce compte).`,
      );
      continue;
    }
    try {
      let prevLastUsedAt: string | null = null;
      await prisma.$transaction(async (tx) => {
        const prev = await tx.mediaAssetUsage.findUnique({
          where: { assetId_accountId: { assetId: asset.id, accountId: usageAccountId } },
          select: { lastUsedAt: true },
        });
        prevLastUsedAt = prev?.lastUsedAt?.toISOString() ?? null;
        await tx.mediaAssetUsage.upsert({
          where: { assetId_accountId: { assetId: asset.id, accountId: usageAccountId } },
          update: { lastUsedAt: now },
          create: { assetId: asset.id, accountId: usageAccountId, usageCount: 0, lastUsedAt: now },
        });
      });
      states.push({
        assetId: asset.id,
        accountId: usageAccountId,
        prevLastUsedAt,
        claimedLastUsedAt: now.toISOString(),
      });
    } catch (err) {
      console.warn(`[advanceMediaUsageOnSubmit] claim failed asset=${asset.id}:`, err);
    }
  }
  return { prevMediaUsageStates: states };
}

/**
 * Claim d'usage DataEntry au moment du submit (POST /api/renders).
 *
 * Plan simplification Phase 4 : remplace l'avance de curseur
 * (AccountDataLibraryCursor) et les claims par policy (usedInCycle /
 * DataEntryUsage usageCount=0) — même contrat que advanceMediaUsageOnSubmit :
 * on stampe `DataEntryUsage.lastUsedAt = now` sous la clé d'usage de la
 * bibliothèque (compte réel en per_account, sentinel `__shared__data__` en
 * shared). C'est ce stamp qui fait redescendre le dossier servi dans la pile
 * du tirage. `usageCount` est incrémenté au DONE par recordLibraryUsage ;
 * le burn-once (maxUsageCount) se fonde dessus.
 */
export type DataUsageClaimState = {
  entryId: string;
  accountId: string;
  prevLastUsedAt: string | null;
  claimedLastUsedAt: string;
};

export async function advanceDataUsageOnSubmit(
  entryId: string,
  accountId: string | undefined,
): Promise<{ prevDataUsageState: DataUsageClaimState } | null> {
  const entry = await prisma.dataEntry.findUnique({
    where: { id: entryId },
    select: { id: true, library: { select: { rotationMode: true, rotationScope: true } } },
  });
  if (!entry?.library) return null;
  if (entry.library.rotationMode === "none") return null;

  const usageAccountId =
    entry.library.rotationScope === "shared" ? SHARED_DATA_USAGE_ACCOUNT_ID : accountId;
  if (!usageAccountId) return null;

  const now = new Date();
  try {
    let prevLastUsedAt: string | null = null;
    await prisma.$transaction(async (tx) => {
      const prev = await tx.dataEntryUsage.findUnique({
        where: { entryId_accountId: { entryId, accountId: usageAccountId } },
        select: { lastUsedAt: true },
      });
      prevLastUsedAt = prev?.lastUsedAt?.toISOString() ?? null;
      await tx.dataEntryUsage.upsert({
        where: { entryId_accountId: { entryId, accountId: usageAccountId } },
        update: { lastUsedAt: now },
        create: { entryId, accountId: usageAccountId, usageCount: 0, lastUsedAt: now },
      });
    });
    return {
      prevDataUsageState: {
        entryId,
        accountId: usageAccountId,
        prevLastUsedAt,
        claimedLastUsedAt: now.toISOString(),
      },
    };
  } catch (err) {
    console.warn(`[advanceDataUsageOnSubmit] claim failed entry=${entryId}:`, err);
    return null;
  }
}

/**
 * Claim d'usage DataEntry au moment de l'AFFECTATION d'une légende (attache
 * `captionDataEntryId` sur un slot) — pas au submit d'un render. Une légende
 * assignée est déjà « consommée » : il n'y aura jamais de webhook DONE pour
 * la faire avancer via `recordLibraryUsage`, donc on écrit `usageCount` ET
 * `lastUsedAt` d'un coup ici, tel quel — réplique exacte du bloc DataEntry de
 * `recordLibraryUsage` (web/src/lib/recordLibraryUsage.ts). Sans l'écriture
 * `usageCount`, le burn-once (`maxUsageCount`) resterait inopérant pour les
 * légendes (contrairement à `advanceDataUsageOnSubmit`, qui ne stampe
 * volontairement que `lastUsedAt` en attendant le DONE d'un vrai render).
 *
 * Pas de revert : la consommation à l'affectation est finale (décision
 * produit). Best-effort — ne throw jamais, retourne `false` sur toute erreur
 * ou garde défensive (entry/lib introuvable, rotation désactivée).
 */
export async function claimDataEntryForCaption(
  entryId: string,
  accountId: string | null | undefined,
): Promise<boolean> {
  try {
    const entry = await prisma.dataEntry.findUnique({
      where: { id: entryId },
      select: { library: { select: { rotationMode: true, rotationScope: true } } },
    });
    if (!entry?.library) return false;
    if (resolveRotationMode(entry.library).mode === "none") return false;

    const isShared = entry.library.rotationScope === "shared";
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.dataEntry.update({
        where: { id: entryId },
        data: { usageCount: { increment: 1 }, lastUsedAt: now },
      });
      if (accountId) {
        await tx.dataEntryUsage.upsert({
          where: { entryId_accountId: { entryId, accountId } },
          update: { usageCount: { increment: 1 }, lastUsedAt: now },
          create: { entryId, accountId, usageCount: 1, lastUsedAt: now },
        });
      }
      // Scope shared : mirror exact de recordLibraryUsage — sans cette 2e
      // écriture sous la sentinelle, le LRU shared re-pioche toujours la
      // même entrée (le tri par dossier ne voit jamais cet usage).
      if (isShared) {
        await tx.dataEntryUsage.upsert({
          where: { entryId_accountId: { entryId, accountId: SHARED_DATA_USAGE_ACCOUNT_ID } },
          update: { usageCount: { increment: 1 }, lastUsedAt: now },
          create: { entryId, accountId: SHARED_DATA_USAGE_ACCOUNT_ID, usageCount: 1, lastUsedAt: now },
        });
      }
    });
    return true;
  } catch (err) {
    console.warn(`[claimDataEntryForCaption] claim failed entry=${entryId}:`, err);
    return false;
  }
}

/**
 * Stamps MediaAssetUsage.lastUsedAt for the submitted audio asset at form submission time.
 * Called from POST /api/renders. Returns the prev/claimed state for the CAS revert.
 * (Phase 3 : le verrou de sérialisation AccountLibraryCursor a été retiré —
 * l'upsert sur la contrainte unique (assetId, accountId) suffit, et le revert
 * CAS neutralise les courses résiduelles.)
 */
export async function advanceAudioUsageOnSubmit(
  audioAssetId: string,
  accountId: string,
  _audioLibraryId: string,
): Promise<{ prevAudioUsageState: { assetId: string; accountId: string; prevLastUsedAt: string | null; claimedLastUsedAt: string } } | null> {
  let prevUsage: { lastUsedAt: Date | null } | null = null;
  const now = new Date();
  await prisma.$transaction(async (tx) => {
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
    /** Dossier (setTag) de la fiche servie — trace. */
    resolvedSetTag?: string | null;
  } | null;
  /**
   * Libraries that used the folder-draw strategy (ex-theme_sequence) for this
   * prefill. Passed through usedAssets so the submit claims their usage.
   */
  setSequencedLibraryIds?: string[];
  /**
   * libraryId → resolved setTag (dossier) used in this generation.
   * Stored in Render.usedAssets for traceability.
   */
  usedSetTagByLibrary?: Record<string, string>;
  /**
   * Audio asset usage claim taken at submit time.
   * Used to conditionally revert MediaAssetUsage.lastUsedAt if the render fails.
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
 * Sélection « dossier simple » d'une DataEntry — plan simplification Phase 4.
 * Miroir exact de selectMediaAssetFromFolder : zéro état, aucune écriture.
 *
 * Les 4 policies dérivées (cycle/once × account/global), `usedInCycle`, les
 * curseurs AccountDataLibraryCursor et l'anti-répétition multi-niveaux sont
 * décommissionnés. Le burn-once vit dans `maxUsageCount` (usageCount per-key).
 *
 * @param libraryId  DataLibrary id (plus de campagne — DataEntry.libraryId direct).
 * @param rule       "manual" → null ; tout le reste → tirage dossier.
 * @param options.pinnedSetTag  Dossier épinglé (PatternTemplate.descriptionDataSetTag) :
 *   restreint le tirage à ce seul dossier, sans repli. Volontairement un objet
 *   et non un 4e positionnel `string | null` comme selectMediaAssetFromFolder —
 *   ici la valeur vient d'une colonne `String?` où `null` signifie « pas
 *   d'épinglage », alors que côté média `null` signifie « épingler le dossier
 *   sans nom ». L'objet rend la confusion impossible et exclut par construction
 *   le ciblage de `setTag IS NULL` (besoin inexistant côté légendes).
 */
export async function selectDataEntry(
  libraryId: string,
  rule: string | undefined,
  accountId: string | undefined,
  options?: { pinnedSetTag?: string | null },
): Promise<{ entryId: string; fields: Record<string, string>; resolvedSetTag: string | null } | null> {
  if (rule === "manual") return null;

  const library = await prisma.dataLibrary.findUnique({
    where: { id: libraryId },
    select: { rotationMode: true, rotationScope: true, maxUsageCount: true },
  });
  if (!library) return null;
  if (library.rotationMode === "none") return null;

  const isShared = library.rotationScope === "shared";
  const usageAccountId = isShared ? SHARED_DATA_USAGE_ACCOUNT_ID : accountId;
  const accessFilter = buildDataAccessFilter(accountId);

  // Burn-once : per_account → usage par clé ; shared → compteur global de l'entry.
  const maxUsage = library.maxUsageCount;
  const burnFilter = maxUsage != null && maxUsage > 0
    ? (isShared
        ? Prisma.sql`AND de."usageCount" < ${maxUsage}`
        : accountId
          ? Prisma.sql`AND COALESCE((SELECT deu2."usageCount" FROM "DataEntryUsage" deu2 WHERE deu2."entryId" = de.id AND deu2."accountId" = ${accountId}), 0) < ${maxUsage}`
          : Prisma.sql``)
    : Prisma.sql``;

  type EntryRow = { id: string; fields: string };

  /** Parse tolérant de la colonne `fields` (JSON corrompu → objet vide). */
  function parseRowFields(raw: string | null): Record<string, string> {
    try {
      return JSON.parse(raw ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  }

  async function pickFromFolder(setTag: string | null): Promise<EntryRow | null> {
    const setTagClause = setTag !== null
      ? Prisma.sql`AND de."setTag" = ${setTag}`
      : Prisma.sql`AND de."setTag" IS NULL`;
    if (usageAccountId) {
      const rows = await prisma.$queryRaw<EntryRow[]>(Prisma.sql`
        SELECT de.id, de.fields FROM "DataEntry" de
        LEFT JOIN "DataEntryUsage" deu ON deu."entryId" = de.id AND deu."accountId" = ${usageAccountId}
        WHERE de."libraryId" = ${libraryId}
          ${setTagClause}
          ${accessFilter}
          ${burnFilter}
        ORDER BY deu."lastUsedAt" ASC NULLS FIRST, de."createdAt" ASC LIMIT 1`);
      return rows[0] ?? null;
    }
    const rows = await prisma.$queryRaw<EntryRow[]>(Prisma.sql`
      SELECT de.id, de.fields FROM "DataEntry" de
      WHERE de."libraryId" = ${libraryId}
        ${setTagClause}
        ${accessFilter}
        ${burnFilter}
      ORDER BY de."lastUsedAt" ASC NULLS FIRST, de."createdAt" ASC LIMIT 1`);
    return rows[0] ?? null;
  }

  // --- Dossier épinglé (recette : PatternTemplate.descriptionDataSetTag) ---
  // Court-circuite la découverte : on ne sert QUE ce dossier. Vide, inexistant
  // ou épuisé (burn-once) ⇒ null, jamais de repli sur les autres dossiers —
  // sinon une recette « RTEXT12 » servirait du RTEXT7 à la première pénurie.
  const pinnedSetTag = options?.pinnedSetTag?.trim() || null;
  if (pinnedSetTag) {
    const row = await pickFromFolder(pinnedSetTag);
    if (!row) {
      console.warn(
        `[selectDataEntry] library=${libraryId} dossier épinglé "${pinnedSetTag}" vide, inexistant ou épuisé — aucun tirage (pas de repli inter-dossiers).`,
      );
      return null;
    }
    return { entryId: row.id, fields: parseRowFields(row.fields), resolvedSetTag: pinnedSetTag };
  }

  // Découverte des dossiers, du moins récemment servi au plus récent (même
  // tri que buildFolderDiscoveryQuery côté média, has_unused inclus — P8).
  const lastUsedExpr = usageAccountId
    ? Prisma.sql`MAX(deu."lastUsedAt")`
    : Prisma.sql`MAX(de."lastUsedAt")`;
  const usageJoin = usageAccountId
    ? Prisma.sql`LEFT JOIN "DataEntryUsage" deu ON deu."entryId" = de.id AND deu."accountId" = ${usageAccountId}`
    : Prisma.empty;
  // « Jamais servie » = aucune ligne d'usage pour ce compte (ou, sans clé
  // d'usage, DataEntry.lastUsedAt lui-même). Pas de filtre disabled : DataEntry
  // n'en a pas.
  const unusedExpr = usageAccountId
    ? Prisma.sql`deu."lastUsedAt" IS NULL`
    : Prisma.sql`de."lastUsedAt" IS NULL`;
  const folders = await prisma.$queryRaw<{ setTag: string | null }[]>(Prisma.sql`
    SELECT sub."setTag"
    FROM (
      SELECT de."setTag",
             ${lastUsedExpr} AS last_used,
             MIN(de."createdAt") AS folder_created_at,
             COUNT(*) FILTER (WHERE ${unusedExpr}) > 0 AS has_unused
      FROM "DataEntry" de
      ${usageJoin}
      WHERE de."libraryId" = ${libraryId}
        ${accessFilter}
        ${burnFilter}
      GROUP BY de."setTag"
      HAVING COUNT(*) > 0
    ) sub
    ORDER BY sub.has_unused DESC,
             sub.last_used ASC NULLS FIRST,
             sub.folder_created_at ASC NULLS LAST,
             CASE WHEN sub."setTag" ~ '^[0-9]+$' THEN LPAD(sub."setTag", 20, '0') ELSE sub."setTag" END ASC NULLS LAST`);

  for (const folder of folders) {
    const row = await pickFromFolder(folder.setTag);
    if (row) {
      return { entryId: row.id, fields: parseRowFields(row.fields), resolvedSetTag: folder.setTag };
    }
  }
  return null;
}
