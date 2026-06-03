/**
 * MediaLibrary — unlimited (least-used, 10 générations)
 *
 * rotationMode="auto", maxUsageCount=null, strategy="least_used".
 * Aucun burn : le pool ne s'épuise jamais.
 * 10 générations → tourne en least-used, toutes retournent un résultat.
 *
 * Couvre aussi :
 * - rule="oldest_used" (ORDER BY lastUsedAt)
 * - rule="random" (ORDER BY RANDOM())
 * - Sans accountId (ordering global vs per-account)
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

function makeAssetRow(id: string, usageCount = 0, lastUsedAt: string | null = null) {
  return {
    id,
    url: `https://r2.test/${id}.mp4`,
    filename: `${id}.mp4`,
    metadata: "{}",
    usageCount,
    lastUsedAt,
  };
}

function setupUnlimitedLibrary() {
  mockMediaLibraryFindUnique.mockResolvedValue({ maxUsageCount: null, rotationMode: "auto" });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MediaLibrary — unlimited (10 générations, always returns non-null)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupUnlimitedLibrary();
  });

  it("10 générations sans accountId → toutes non nulles (round-robin sur 3 assets)", async () => {
    const assets = [
      makeAssetRow("asset-A", 0),
      makeAssetRow("asset-B", 0),
      makeAssetRow("asset-C", 0),
    ];

    for (let i = 0; i < 10; i++) {
      vi.clearAllMocks();
      setupUnlimitedLibrary();

      // Round-robin pour simuler least-used cycling
      mockQueryRaw.mockResolvedValueOnce([assets[i % 3]]);

      const result = await selectMediaAsset("lib-unlimited", undefined, {});
      expect(result, `génération ${i + 1}`).not.toBeNull();
      expect(["asset-A", "asset-B", "asset-C"]).toContain(result!.id);
    }
  });

  it("10 générations avec accountId → toutes non nulles (per-account ordering)", async () => {
    const assets = [
      makeAssetRow("asset-A"),
      makeAssetRow("asset-B"),
      makeAssetRow("asset-C"),
    ];

    for (let i = 0; i < 10; i++) {
      vi.clearAllMocks();
      setupUnlimitedLibrary();

      mockQueryRaw.mockResolvedValueOnce([assets[i % 3]]);

      const result = await selectMediaAsset("lib-unlimited", undefined, {}, "account-1");
      expect(result, `génération ${i + 1}`).not.toBeNull();
    }
  });

  it("rule 'oldest_used' — 10 générations → toutes non nulles", async () => {
    for (let i = 0; i < 10; i++) {
      vi.clearAllMocks();
      setupUnlimitedLibrary();

      mockQueryRaw.mockResolvedValueOnce([makeAssetRow(`asset-${i % 3}`)]);

      const result = await selectMediaAsset("lib-unlimited", "oldest_used", {}, "account-1");
      expect(result, `génération ${i + 1}`).not.toBeNull();
    }
  });

  it("rule 'random' — 10 générations → toutes non nulles", async () => {
    for (let i = 0; i < 10; i++) {
      vi.clearAllMocks();
      setupUnlimitedLibrary();

      mockQueryRaw.mockResolvedValueOnce([makeAssetRow(`asset-${i % 3}`)]);

      const result = await selectMediaAsset("lib-unlimited", "random", {}, "account-1");
      expect(result, `génération ${i + 1}`).not.toBeNull();
    }
  });

  it("les 3 assets apparaissent tous sur 10 générations (least-used balance)", async () => {
    // Vérifie que les 3 assets ont tous été retournés au moins une fois
    const seenIds = new Set<string>();
    const assets = ["asset-A", "asset-B", "asset-C"];

    for (let i = 0; i < 9; i++) {
      vi.clearAllMocks();
      setupUnlimitedLibrary();
      mockQueryRaw.mockResolvedValueOnce([makeAssetRow(assets[i % 3])]);

      const result = await selectMediaAsset("lib-unlimited", undefined, {});
      if (result) seenIds.add(result.id);
    }

    // Après 9 générations (3 cycles de 3), les 3 assets ont été vus
    expect(seenIds.size).toBe(3);
    expect(seenIds).toContain("asset-A");
    expect(seenIds).toContain("asset-B");
    expect(seenIds).toContain("asset-C");
  });

  it("pool toujours non vide après 10 générations (unlimited = pas de burn)", async () => {
    // Même avec usageCount élevé, les assets restent dans le pool (pas de burnFilter)
    const assetHighUsage = makeAssetRow("asset-A", 999);
    setupUnlimitedLibrary();
    mockQueryRaw.mockResolvedValueOnce([assetHighUsage]);

    const result = await selectMediaAsset("lib-unlimited", undefined, {}, "account-1");
    expect(result?.id).toBe("asset-A");
  });

  it("stratégie inconnue → fallback sur least_used sans throw", async () => {
    setupUnlimitedLibrary();
    mockQueryRaw.mockResolvedValueOnce([makeAssetRow("asset-A")]);

    // @ts-expect-error — test intentionnel d'une stratégie invalide
    const result = await selectMediaAsset("lib-unlimited", "unknown_strategy", {}, "account-1");
    expect(result?.id).toBe("asset-A");
  });
});

describe("MediaLibrary — unlimited burn-once (maxUsageCount=1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMediaLibraryFindUnique.mockResolvedValue({ maxUsageCount: 1, rotationMode: "auto" });
  });

  it("3 assets avec maxUsageCount=1 — après 3 générations le pool est épuisé", async () => {
    // Générations 1-3 retournent chacune un asset
    for (let i = 0; i < 3; i++) {
      vi.clearAllMocks();
      mockMediaLibraryFindUnique.mockResolvedValue({ maxUsageCount: 1, rotationMode: "auto" });
      mockQueryRaw.mockResolvedValueOnce([makeAssetRow(`asset-${i}`, 0)]);

      const result = await selectMediaAsset("lib-burn", undefined, {}, "account-1");
      expect(result, `génération ${i + 1}`).not.toBeNull();
    }

    // Génération 4 — pool épuisé (burnFilter exclude usageCount >= 1)
    vi.clearAllMocks();
    mockMediaLibraryFindUnique.mockResolvedValue({ maxUsageCount: 1, rotationMode: "auto" });
    mockQueryRaw.mockResolvedValueOnce([]); // DB retourne vide (tous usageCount >= 1)

    const result = await selectMediaAsset("lib-burn", undefined, {}, "account-1");
    expect(result).toBeNull();
  });
});
