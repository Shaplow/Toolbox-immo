/**
 * MediaLibrary — cycle shared (2 comptes, curseur global)
 *
 * En scope "shared", le curseur est partagé (SHARED_CURSOR_ACCOUNT_ID = "__shared__").
 * Les 2 comptes avancent le même curseur global : l'asset sélectionné pour le compte A
 * n'est pas le même que celui sélectionné pour le compte B dans la même génération.
 *
 * Ce fichier teste selectMediaAsset (non-locking) pour valider la logique de base.
 * Le comportement de curseur partagé effectif (AccountLibraryCursor) est testé
 * dans rotation.media-revert.test.ts (sélection avec selectMediaAssetBySetSequence).
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

import { selectMediaAsset, SHARED_CURSOR_ACCOUNT_ID } from "@/lib/contentLibraryResolver";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAssetRow(id: string) {
  return { id, url: `https://r2.test/${id}.mp4`, filename: `${id}.mp4`, metadata: "{}" };
}

function setupLibrary(maxUsageCount: number | null = null, rotationMode = "auto") {
  mockMediaLibraryFindUnique.mockResolvedValue({ maxUsageCount, rotationMode });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MediaLibrary — shared cursor (SHARED_CURSOR_ACCOUNT_ID exporté)", () => {
  it("SHARED_CURSOR_ACCOUNT_ID est la valeur attendue", () => {
    expect(SHARED_CURSOR_ACCOUNT_ID).toBe("__shared__");
  });
});

describe("MediaLibrary — selectMediaAsset 2 comptes scope shared", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupLibrary(null, "auto");
  });

  it("compte A — sélectionne asset-A (premier dans le pool)", async () => {
    const assetA = makeAssetRow("asset-A");
    mockQueryRaw.mockResolvedValueOnce([assetA]);

    const result = await selectMediaAsset("lib-shared", undefined, {}, "account-A");
    expect(result?.id).toBe("asset-A");
  });

  it("compte B — sélectionne asset-B (le mock simule que A est déjà le plus utilisé)", async () => {
    const assetB = makeAssetRow("asset-B");
    mockQueryRaw.mockResolvedValueOnce([assetB]);

    const result = await selectMediaAsset("lib-shared", undefined, {}, "account-B");
    expect(result?.id).toBe("asset-B");
  });

  it("les 2 comptes peuvent sélectionner des assets différents (pas de collision dans le mock)", async () => {
    const assetA = makeAssetRow("asset-A");
    const assetB = makeAssetRow("asset-B");

    // Compte A
    mockQueryRaw.mockResolvedValueOnce([assetA]);
    const resultA = await selectMediaAsset("lib-shared", undefined, {}, "account-A");

    vi.clearAllMocks();
    setupLibrary();

    // Compte B
    mockQueryRaw.mockResolvedValueOnce([assetB]);
    const resultB = await selectMediaAsset("lib-shared", undefined, {}, "account-B");

    expect(resultA?.id).toBe("asset-A");
    expect(resultB?.id).toBe("asset-B");
    expect(resultA?.id).not.toBe(resultB?.id);
  });

  it("4 générations alternées A/B → toutes non nulles", async () => {
    const assets = [
      makeAssetRow("asset-A"),
      makeAssetRow("asset-B"),
      makeAssetRow("asset-A"),
      makeAssetRow("asset-B"),
    ];

    for (let i = 0; i < 4; i++) {
      vi.clearAllMocks();
      setupLibrary();
      mockQueryRaw.mockResolvedValueOnce([assets[i]]);

      const account = i % 2 === 0 ? "account-A" : "account-B";
      const result = await selectMediaAsset("lib-shared", undefined, {}, account);
      expect(result, `génération ${i + 1} compte=${account}`).not.toBeNull();
    }
  });

  it("maxUsageCount=1 (burn-once) — asset déjà utilisé non retourné (pool vide)", async () => {
    // Avec maxUsageCount=1, buildBurnFilter ajoute une clause WHERE usageCount < 1.
    // Après 1 utilisation, la DB ne retourne plus l'asset.
    setupLibrary(1, "auto");
    mockQueryRaw.mockResolvedValueOnce([]); // pool épuisé (tous usageCount >= 1)

    const result = await selectMediaAsset("lib-shared", undefined, {}, "account-A");
    expect(result).toBeNull();
  });

  it("rotationMode 'none' → null pour les 2 comptes", async () => {
    setupLibrary(null, "none");

    const resultA = await selectMediaAsset("lib-shared", undefined, {}, "account-A");
    const resultB = await selectMediaAsset("lib-shared", undefined, {}, "account-B");

    expect(resultA).toBeNull();
    expect(resultB).toBeNull();
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });
});
