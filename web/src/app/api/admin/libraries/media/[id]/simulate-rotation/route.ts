/**
 * GET /api/admin/libraries/media/[id]/simulate-rotation?accountId=X
 *
 * Simule l'ordre complet de la rotation auto pour un compte IG donné, **sans**
 * avancer le curseur ni écrire d'usage. Source unique de vérité pour la preview
 * UI du panel `MediaAssetsPanel` (vue Rotation + encart `NextGenPreview`).
 *
 * Replique mot pour mot la logique du resolver `selectMediaAssetBySetSequence`
 * en réutilisant `buildAccessFilter`, `buildBurnFilter`, `GROUP_DISCOVERY_ORDER_BY`
 * et `selectEligibleRotationGroups`. Tout filtrage (notamment `maxUsageCount`)
 * est appliqué AU NIVEAU SQL, donc la preview reflète exactement ce qui sortira
 * en prod.
 *
 * Réponse :
 * {
 *   rotationScope: "per_account" | "shared",
 *   cursor: { value, position, totalSlots } | null,  // override mode uniquement
 *   ordered: [
 *     { rank, key, setTag, category, accessibleCount, lastUsedAtForAccount },
 *     ...
 *   ],
 *   cycleSize: number,
 *   reason: string,
 * }
 *
 * Auth : médiathèque (ADMIN + VIDEASTE) — lecture seule (preview rotation).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { canAccessMediaLibrary } from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";
import {
  buildAccessFilter,
  buildBurnFilter,
  GROUP_DISCOVERY_ORDER_BY,
  selectEligibleRotationGroups,
  SHARED_CURSOR_ACCOUNT_ID,
} from "@/lib/contentLibraryResolver";

type Params = { params: Promise<{ id: string }> };

type GroupRow = {
  setTag: string | null;
  category: string | null;
  last_used: Date | null;
  group_created_at: Date | null;
  accessible_count: bigint;
};

type OrderedPack = {
  rank: number;
  key: string;
  setTag: string | null;
  category: string | null;
  accessibleCount: number;
  lastUsedAtForAccount: string | null;
};

const NONE = "__none__";
function toGroupKey(category: string | null, setTag: string | null): string {
  return `${category ?? NONE}::${setTag ?? NONE}`;
}

export async function GET(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !canAccessMediaLibrary(userContext.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: libraryId } = await params;
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId") ?? undefined;

  if (!accountId) {
    return NextResponse.json(
      { error: "Le paramètre accountId est requis" },
      { status: 400 }
    );
  }

  const library = await prisma.mediaLibrary.findUnique({
    where: { id: libraryId },
    select: {
      id: true,
      rotationScope: true,
      setSequence: true,
      maxUsageCount: true,
    },
  });
  if (!library) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }

  const account = await prisma.instagramAccount.findUnique({
    where: { id: accountId },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  const isShared = library.rotationScope === "shared";
  const cursorAccountId = isShared ? SHARED_CURSOR_ACCOUNT_ID : accountId;

  let sequence: string[] = [];
  try {
    sequence = (JSON.parse(library.setSequence) as string[]).filter(Boolean);
  } catch {
    sequence = [];
  }

  const cursorRow = await prisma.accountLibraryCursor.findUnique({
    where: { accountId_libraryId: { accountId: cursorAccountId, libraryId } },
    select: { cursor: true, lastUsedCategory: true, lastUsedSetTag: true, lastAdvancedAt: true },
  });
  const lastUsedCategory = cursorRow?.lastUsedCategory ?? null;
  const lastUsedSetTag = cursorRow?.lastUsedSetTag ?? null;
  const hasHistory = cursorRow?.lastAdvancedAt != null;

  const accessFilter = buildAccessFilter(accountId);
  const burnFilter = buildBurnFilter(library.maxUsageCount ?? null, accountId);

  // Group discovery — identique au resolver. Inclut accessible_count pour
  // l'UI (afficher le nombre d'assets dispos dans chaque pack).
  const groups: GroupRow[] = await prisma.$queryRaw`
    SELECT sub2."setTag", sub2."category", sub2.last_used, sub2.group_created_at, sub2.accessible_count
    FROM (
      SELECT sub1."setTag", sub1."category", sub1.last_used, sub1.group_created_at, sub1.accessible_count,
             MAX(sub1.last_used) OVER (PARTITION BY sub1."category") AS cat_last_used
      FROM (
        SELECT ma."setTag", ma."category",
               MAX(mau."lastUsedAt") AS last_used,
               MIN(ma."createdAt") AS group_created_at,
               COUNT(*) FILTER (WHERE NOT ma."disabled") AS accessible_count
        FROM "MediaAsset" ma
        LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = ${cursorAccountId}
        WHERE ma."libraryId" = ${libraryId}
          ${accessFilter}
          ${burnFilter}
        GROUP BY ma."setTag", ma."category"
        HAVING COUNT(*) FILTER (WHERE NOT ma."disabled") > 0
      ) sub1
    ) sub2
    ${GROUP_DISCOVERY_ORDER_BY}`;

  if (groups.length === 0) {
    return NextResponse.json({
      rotationScope: library.rotationScope ?? "per_account",
      cursor:
        sequence.length > 0
          ? {
              value: cursorRow?.cursor ?? 0,
              position: ((cursorRow?.cursor ?? 0) % sequence.length) + 1,
              totalSlots: sequence.length,
            }
          : null,
      ordered: [],
      cycleSize: 0,
      reason:
        library.maxUsageCount && library.maxUsageCount > 0
          ? `Aucun pack éligible — vérifie qu'au moins un asset n'a pas atteint maxUsageCount=${library.maxUsageCount}.`
          : "Aucun pack éligible — vérifie qu'au moins un asset accessible est actif.",
    });
  }

  // --- Override mode (setSequence non vide) ---
  if (sequence.length > 0) {
    const ordered = simulateOverride(sequence, groups, cursorRow?.cursor ?? 0);
    return NextResponse.json({
      rotationScope: library.rotationScope ?? "per_account",
      cursor: {
        value: cursorRow?.cursor ?? 0,
        position: ((cursorRow?.cursor ?? 0) % sequence.length) + 1,
        totalSlots: sequence.length,
      },
      ordered,
      cycleSize: ordered.length,
      reason: `Mode override · curseur=${cursorRow?.cursor ?? 0} · ${ordered.length} slot${ordered.length > 1 ? "s" : ""}`,
    });
  }

  // --- Auto mode (découverte dynamique avec exclusion catégorie/setTag) ---
  const ordered = simulateAuto(groups, lastUsedCategory, lastUsedSetTag, hasHistory);

  return NextResponse.json({
    rotationScope: library.rotationScope ?? "per_account",
    cursor: null,
    ordered,
    cycleSize: ordered.length,
    reason: hasHistory
      ? `Mode auto · dernière sortie ${lastUsedCategory ?? "—"}/${lastUsedSetTag ?? "—"} · ${ordered.length} pack${ordered.length > 1 ? "s" : ""}`
      : `Mode auto · jamais joué · ${ordered.length} pack${ordered.length > 1 ? "s" : ""}`,
  });
}

/**
 * Override mode : itère la séquence à partir du cursor courant, lookup chaque
 * setTag dans les groupes éligibles. Si un setTag n'a pas de groupe (asset
 * épuisé ou setTag inexistant), il est skip silencieusement.
 */
function simulateOverride(
  sequence: string[],
  groups: GroupRow[],
  startCursor: number,
): OrderedPack[] {
  // Indexe les groupes par setTag — un setTag peut avoir plusieurs categories ;
  // on garde le premier (= plus stale selon GROUP_DISCOVERY_ORDER_BY).
  const bySetTag = new Map<string, GroupRow>();
  for (const g of groups) {
    if (g.setTag !== null && !bySetTag.has(g.setTag)) {
      bySetTag.set(g.setTag, g);
    }
  }
  const ordered: OrderedPack[] = [];
  for (let k = 0; k < sequence.length; k++) {
    const slot = sequence[(startCursor + k) % sequence.length];
    const g = bySetTag.get(slot);
    if (!g) continue; // setTag absent ou tous assets épuisés
    ordered.push(toOrderedPack(g, ordered.length + 1));
  }
  return ordered;
}

/**
 * Auto mode : reproduit la boucle du useMemo client (avec virtualCatLastUsed)
 * mais en utilisant `selectEligibleRotationGroups` pour l'exclusion catégorie/
 * setTag — donc strictement aligné avec le resolver.
 */
function simulateAuto(
  initialGroups: GroupRow[],
  initialLastCategory: string | null,
  initialLastSetTag: string | null,
  initialHasHistory: boolean,
): OrderedPack[] {
  const ordered: OrderedPack[] = [];
  // virtualCatLastUsed : sentinelle pour faire remonter une catégorie picked
  // en queue de tri à chaque itération (simule l'effet "le resolver re-lit
  // catLastUsed après chaque génération").
  const virtualCatLastUsed = new Map<string | null, Date | string | null>();
  for (const g of initialGroups) {
    const prev = virtualCatLastUsed.get(g.category);
    if (prev == null && g.last_used != null) virtualCatLastUsed.set(g.category, g.last_used);
    else if (prev != null && g.last_used != null && g.last_used > (prev as Date)) {
      virtualCatLastUsed.set(g.category, g.last_used);
    } else if (!virtualCatLastUsed.has(g.category)) {
      virtualCatLastUsed.set(g.category, null);
    }
  }

  let remaining: GroupRow[] = [...initialGroups];
  let lastCategory: string | null = initialLastCategory;
  let lastSetTag: string | null = initialLastSetTag;
  let hasHistory = initialHasHistory;
  let virtualTick = 0;

  while (remaining.length > 0) {
    // Re-trier remaining selon virtualCatLastUsed + last_used + group_created_at
    remaining.sort((a, b) => compareGroups(a, b, virtualCatLastUsed));
    // Sélection éligible (exclusion catégorie ou setTag selon distinct count)
    const eligible = selectEligibleRotationGroups(
      remaining.map((g) => ({ setTag: g.setTag, category: g.category })),
      lastCategory,
      lastSetTag,
      hasHistory,
    );
    // selectEligibleRotationGroups peut retourner des paires (setTag, category)
    // détachées des rows. Re-link via clé pour retrouver le row originel.
    const eligibleKeys = new Set(eligible.map((e) => toGroupKey(e.category, e.setTag)));
    const pick = remaining.find((g) => eligibleKeys.has(toGroupKey(g.category, g.setTag))) ?? remaining[0];
    if (!pick) break;
    ordered.push(toOrderedPack(pick, ordered.length + 1));
    lastCategory = pick.category;
    lastSetTag = pick.setTag;
    hasHistory = true;
    // Avance virtualCatLastUsed pour la catégorie picked → tri suivant la fait reculer.
    virtualTick += 1;
    virtualCatLastUsed.set(pick.category, `__sim_${String(virtualTick).padStart(10, "0")}`);
    remaining = remaining.filter((g) => toGroupKey(g.category, g.setTag) !== toGroupKey(pick.category, pick.setTag));
  }

  return ordered;
}

function compareGroups(
  a: GroupRow,
  b: GroupRow,
  virtualCatLastUsed: Map<string | null, Date | string | null>,
): number {
  const catA = virtualCatLastUsed.get(a.category) ?? null;
  const catB = virtualCatLastUsed.get(b.category) ?? null;
  const catCmp = compareNullable(catA, catB);
  if (catCmp !== 0) return catCmp;
  const usedCmp = compareNullable(a.last_used, b.last_used);
  if (usedCmp !== 0) return usedCmp;
  const createdCmp = compareNullable(a.group_created_at, b.group_created_at, /*nullsLast*/ true);
  if (createdCmp !== 0) return createdCmp;
  // Numeric-aware tiebreaker on setTag (parity with SQL LPAD)
  const na = parseInt(a.setTag ?? "", 10);
  const nb = parseInt(b.setTag ?? "", 10);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  const setTagCmp = (a.setTag ?? "").localeCompare(b.setTag ?? "");
  if (setTagCmp !== 0) return setTagCmp;
  return (a.category ?? "").localeCompare(b.category ?? "");
}

function compareNullable(
  a: Date | string | null,
  b: Date | string | null,
  nullsLast = false,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return nullsLast ? 1 : -1;
  if (b == null) return nullsLast ? -1 : 1;
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

function toOrderedPack(g: GroupRow, rank: number): OrderedPack {
  return {
    rank,
    key: toGroupKey(g.category, g.setTag),
    setTag: g.setTag,
    category: g.category,
    accessibleCount: Number(g.accessible_count),
    lastUsedAtForAccount: g.last_used ? g.last_used.toISOString() : null,
  };
}
