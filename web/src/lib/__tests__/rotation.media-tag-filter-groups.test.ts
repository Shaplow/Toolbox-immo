/**
 * MediaLibrary — le filtre par tag s'applique AUSSI à la découverte des groupes.
 *
 * Non-régression : `tagFrag` n'était injecté que dans la requête de sélection de
 * l'asset, jamais dans les 3 requêtes de découverte/classement des groupes.
 * L'ancienneté d'un groupe était donc calculée tous tags confondus — un groupe
 * dont les assets « RPI » étaient épuisés remontait en tête du classement grâce
 * à ses « RVA4 » jamais servis, et la génération RPI ressortait un asset déjà
 * utilisé.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const mockQueryRaw = vi.fn();
const mockMediaLibraryFindUnique = vi.fn();
const mockCursorFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    mediaLibrary: { findUnique: (...args: unknown[]) => mockMediaLibraryFindUnique(...args) },
    accountLibraryCursor: { findUnique: (...args: unknown[]) => mockCursorFindUnique(...args) },
  },
}));

import { selectMediaAssetBySetSequence, buildGroupDiscoveryQuery } from "@/lib/contentLibraryResolver";

const ASSET = { id: "asset-A", url: "https://r2.test/a.mp4", filename: "a.mp4" };
const TAG_FRAGMENT = 'lower(ma.tags) ILIKE';

/** Concatène le SQL d'un `Prisma.Sql` pour inspection. */
function sqlText(arg: unknown): string {
  const sql = arg as Prisma.Sql;
  return Array.isArray(sql?.strings) ? sql.strings.join("?") : String(arg);
}

describe("buildGroupDiscoveryQuery", () => {
  const base = {
    libraryId: "lib-1",
    accessFilter: Prisma.empty,
    burnFilter: Prisma.empty,
  };

  it("injecte le fragment de tag dans le WHERE de la découverte", () => {
    const q = buildGroupDiscoveryQuery({
      ...base,
      usageAccountId: "account-1",
      tagFrag: Prisma.sql`AND lower(ma.tags) ILIKE ${'%"rpi"%'}`,
    });
    expect(sqlText(q)).toContain(TAG_FRAGMENT);
  });

  it("aliase toujours MediaAsset en `ma`, y compris sans compte", () => {
    // Le chemin sans compte utilisait auparavant des colonnes nues, ce qui
    // rendait `tagFrag` et `burnFilter` (qui référencent `ma.`) inapplicables.
    const q = buildGroupDiscoveryQuery({ ...base, tagFrag: Prisma.empty });
    const text = sqlText(q);
    expect(text).toContain('FROM "MediaAsset" ma');
    expect(text).toContain('ma."libraryId"');
  });

  it("ordonne par usage du compte quand il est fourni, par agrégat global sinon", () => {
    const withAccount = sqlText(buildGroupDiscoveryQuery({ ...base, usageAccountId: "account-1", tagFrag: Prisma.empty }));
    expect(withAccount).toContain('"MediaAssetUsage" mau');
    expect(withAccount).toContain('MAX(mau."lastUsedAt")');

    const global = sqlText(buildGroupDiscoveryQuery({ ...base, tagFrag: Prisma.empty }));
    expect(global).not.toContain('"MediaAssetUsage" mau');
    expect(global).toContain('MAX(ma."lastUsedAt")');
  });

  it("ne projette `accessible_count` que sur demande", () => {
    expect(sqlText(buildGroupDiscoveryQuery({ ...base, tagFrag: Prisma.empty }))).not.toContain("accessible_count");
    expect(
      sqlText(buildGroupDiscoveryQuery({ ...base, tagFrag: Prisma.empty, withAccessibleCount: true })),
    ).toContain("accessible_count");
  });
});

describe("selectMediaAssetBySetSequence — le tag filtre les 3 chemins de découverte", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCursorFindUnique.mockResolvedValue(null);
    mockMediaLibraryFindUnique.mockResolvedValue({
      setSequence: "[]",
      maxUsageCount: null,
      rotationScope: "per_account",
      rotationMode: "auto",
    });
  });

  it("chemin readOnly avec compte : la découverte porte le fragment de tag", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ setTag: "grp-1", category: "cat-1" }])
      .mockResolvedValueOnce([ASSET]);

    await selectMediaAssetBySetSequence(
      "lib-1", "account-1", "RPI", undefined, undefined, undefined, undefined, true,
    );

    expect(sqlText(mockQueryRaw.mock.calls[0][0])).toContain(TAG_FRAGMENT);
  });

  it("chemin sans compte (preview admin) : la découverte porte aussi le fragment", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ setTag: "grp-1", category: "cat-1" }])
      .mockResolvedValueOnce([ASSET]);

    await selectMediaAssetBySetSequence(
      "lib-1", undefined, "RPI", undefined, undefined, undefined, undefined, true,
    );

    expect(sqlText(mockQueryRaw.mock.calls[0][0])).toContain(TAG_FRAGMENT);
  });

  it("sans tag, la découverte reste inchangée", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ setTag: "grp-1", category: "cat-1" }])
      .mockResolvedValueOnce([ASSET]);

    await selectMediaAssetBySetSequence(
      "lib-1", "account-1", undefined, undefined, undefined, undefined, undefined, true,
    );

    expect(sqlText(mockQueryRaw.mock.calls[0][0])).not.toContain(TAG_FRAGMENT);
  });
});
