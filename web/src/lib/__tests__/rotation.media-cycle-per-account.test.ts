/**
 * MediaLibrary — cycle per_account (via selectMediaAsset)
 *
 * selectMediaAsset est la fonction non-locking de sélection Media.
 * Elle utilise prisma.$queryRaw directement (pas de transaction).
 *
 * Scénario : 3 assets, 1 compte, 4 générations → least-used cycling.
 *
 * Note architecturale : le cycle réel avec claim est fait par selectAndClaimMediaAsset
 * (qui pose un FOR UPDATE SKIP LOCKED dans une tx). Les tests ici couvrent la logique
 * de sélection de selectMediaAsset (sans lock) pour valider la logique least-used.
 * Les tests de selectAndClaimMediaAsset + curseur avancé sont dans rotation.media-revert.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma ───────────────────────────────────────────────────────────────
const mockQueryRaw = vi.fn();
const mockMediaLibraryFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    mediaLibrary: { findUnique: (...args: unknown[]) => mockMediaLibraryFindUnique(...args) },
  },
}));

import { selectMediaAsset } from "@/lib/contentLibraryResolver";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAssetRow(id: string, usageCount = 0) {
  return {
    id,
    url: `https://r2.test/${id}.mp4`,
    filename: `${id}.mp4`,
    metadata: "{}",
    usageCount,
  };
}

function setupLibrary(maxUsageCount: number | null = null, rotationMode = "auto") {
  mockMediaLibraryFindUnique.mockResolvedValue({ maxUsageCount, rotationMode });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MediaLibrary — selectMediaAsset cycle per_account (least-used ordering)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupLibrary(null, "auto");
  });

  it("3 assets — génération 1 retourne asset-A (moins utilisé, usageCount=0)", async () => {
    const assetA = makeAssetRow("asset-A", 0);
    mockQueryRaw.mockResolvedValueOnce([assetA]);

    const result = await selectMediaAsset("lib-1", undefined, {}, "account-1");
    expect(result?.id).toBe("asset-A");
  });

  it("3 assets — génération 2 après asset-A utilisé → retourne asset-B (nouveau moins utilisé)", async () => {
    const assetB = makeAssetRow("asset-B", 0);
    mockQueryRaw.mockResolvedValueOnce([assetB]);

    const result = await selectMediaAsset("lib-1", undefined, {}, "account-1");
    expect(result?.id).toBe("asset-B");
  });

  it("3 assets — génération 3 → retourne asset-C", async () => {
    const assetC = makeAssetRow("asset-C", 0);
    mockQueryRaw.mockResolvedValueOnce([assetC]);

    const result = await selectMediaAsset("lib-1", undefined, {}, "account-1");
    expect(result?.id).toBe("asset-C");
  });

  it("génération 4 — cycle restart : retourne asset-A (usageCount=1, le moins utilisé)", async () => {
    // Tous les assets ont été utilisés 1 fois → least-used = asset-A (usageCount=1, oldest lastUsedAt)
    const assetA = makeAssetRow("asset-A", 1);
    mockQueryRaw.mockResolvedValueOnce([assetA]);

    const result = await selectMediaAsset("lib-1", undefined, {}, "account-1");
    expect(result?.id).toBe("asset-A");
  });

  it("pool vide → retourne null", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);

    const result = await selectMediaAsset("lib-1", undefined, {}, "account-1");
    expect(result).toBeNull();
  });

  it("rotationMode 'none' → retourne null immédiatement", async () => {
    setupLibrary(null, "none");
    const result = await selectMediaAsset("lib-none", undefined, {}, "account-1");
    expect(result).toBeNull();
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it("rule 'manual' → retourne null sans appel DB", async () => {
    const result = await selectMediaAsset("lib-1", "manual", {}, "account-1");
    expect(result).toBeNull();
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it("metadata est correctement parsé depuis le JSON de la DB", async () => {
    const assetWithMeta = {
      id: "asset-meta",
      url: "https://r2.test/meta.mp4",
      filename: "meta.mp4",
      metadata: JSON.stringify({ quartier: "Ainay", prix_m2: 7500 }),
    };
    mockQueryRaw.mockResolvedValueOnce([assetWithMeta]);

    const result = await selectMediaAsset("lib-1", undefined, {}, "account-1");
    expect(result?.id).toBe("asset-meta");
    expect(result?.metadata).toEqual({ quartier: "Ainay", prix_m2: 7500 });
  });

  it("metadata malformé → metadata retourné comme objet vide (pas de throw)", async () => {
    mockQueryRaw.mockResolvedValueOnce([{
      id: "asset-bad",
      url: "https://r2.test/bad.mp4",
      filename: "bad.mp4",
      metadata: "NOT_JSON{{",
    }]);

    const result = await selectMediaAsset("lib-1", undefined, {}, "account-1");
    expect(result?.id).toBe("asset-bad");
    expect(result?.metadata).toEqual({});
  });

  it("rule 'oldest_used' avec accountId → utilise JOIN MediaAssetUsage dans la query", async () => {
    const assetOld = makeAssetRow("asset-old", 5);
    mockQueryRaw.mockResolvedValueOnce([assetOld]);

    const result = await selectMediaAsset("lib-1", "oldest_used", {}, "account-1");
    expect(result?.id).toBe("asset-old");
    // La query utilisée est celle avec LEFT JOIN MediaAssetUsage mau / ORDER BY lastUsedAt ASC
    expect(mockQueryRaw).toHaveBeenCalledOnce();
  });
});

describe("MediaLibrary — selectMediaAsset sans accountId (shared-style)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupLibrary(null, "auto");
  });

  it("sans accountId → utilise usageCount global (MediaAsset.usageCount)", async () => {
    const assetA = makeAssetRow("asset-A", 0);
    mockQueryRaw.mockResolvedValueOnce([assetA]);

    const result = await selectMediaAsset("lib-1", undefined, {});
    expect(result?.id).toBe("asset-A");
  });

  it("sans accountId, pool vide → retourne null", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);
    const result = await selectMediaAsset("lib-1", undefined, {});
    expect(result).toBeNull();
  });
});
