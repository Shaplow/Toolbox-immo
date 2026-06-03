/**
 * DataLibrary — unlimited
 *
 * rotationScope="shared" + maxUsageCount=null → policy "unlimited".
 * Règle : aucune contrainte de burn. Toujours "least used" en premier.
 * Le pool ne s'épuise jamais.
 *
 * Scénario : 3 entries, 1 compte, 10 générations → la rotation tourne
 * en least-used et les 3 entries apparaissent au fil du temps.
 *
 * Note : en "unlimited", prevCursorState active le groupe-based path (Phase 3.A),
 * ce qui applique l'anti-répétition catégorie même sans limite de burn.
 * Sans prevCursorState, le flat queryOne est pris.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma ───────────────────────────────────────────────────────────────
const mockQueryRaw = vi.fn();
const mockTransaction = vi.fn();
const mockDataCampaignFindUnique = vi.fn();
const mockDataEntryUsageCreate = vi.fn();
const mockDataEntryUsageUpsert = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    $transaction: (fn: (tx: unknown) => unknown) => mockTransaction(fn),
    dataCampaign: { findUnique: (...args: unknown[]) => mockDataCampaignFindUnique(...args) },
    dataEntryUsage: {
      create: (...args: unknown[]) => mockDataEntryUsageCreate(...args),
      upsert: (...args: unknown[]) => mockDataEntryUsageUpsert(...args),
    },
  },
}));

import { selectDataEntry } from "@/lib/contentLibraryResolver";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTxProxy() {
  return {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    dataEntryUsage: {
      create: (...args: unknown[]) => mockDataEntryUsageCreate(...args),
      upsert: (...args: unknown[]) => mockDataEntryUsageUpsert(...args),
    },
    dataEntry: { update: vi.fn().mockResolvedValue({}) },
  };
}

function setupTransaction() {
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(makeTxProxy()));
}

function setupUnlimitedCampaign() {
  // shared + null maxUsageCount → "unlimited" policy
  mockDataCampaignFindUnique.mockResolvedValue({
    library: { id: "lib-unlimited", rotationMode: "auto", rotationScope: "shared", maxUsageCount: null },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DataLibrary — unlimited (least-used, no burn)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTransaction();
    setupUnlimitedCampaign();
  });

  it("sans prevCursorState → flat path (queryOne), toujours renvoie une entry", async () => {
    const entry = { id: "entry-A", fields: JSON.stringify({ zone: "centre" }) };
    mockQueryRaw.mockResolvedValueOnce([entry]);

    const result = await selectDataEntry("campaign-unlimited", undefined, "account-1", undefined);
    expect(result?.entryId).toBe("entry-A");
    // En unlimited sans prevCursorState : pas de claimState
    expect(result?.claimState).toBeUndefined();
  });

  it("avec prevCursorState → group-based path + anti-répétition catégorie", async () => {
    const entryB = { id: "entry-B", fields: JSON.stringify({ zone: "nord" }) };

    // discoverGroups retourne 2 groupes ; lastCategory=CatA → eligible=[CatB]
    mockQueryRaw.mockResolvedValueOnce([
      { setTag: "set-a", category: "CatA" },
      { setTag: "set-b", category: "CatB" },
    ]);
    mockQueryRaw.mockResolvedValueOnce([entryB]); // pickEntryFromGroup unlimited

    const result = await selectDataEntry("campaign-unlimited", undefined, "account-1", {
      lastUsedSetTag: "set-a", lastUsedCategory: "CatA", hasHistory: true,
    });

    expect(result?.entryId).toBe("entry-B");
    expect(result?.resolvedCategory).toBe("CatB");
  });

  it("10 générations sans prevCursorState → toutes non nulles (pool infini)", async () => {
    const entries = [
      { id: "entry-A", fields: "{}" },
      { id: "entry-B", fields: "{}" },
      { id: "entry-C", fields: "{}" },
    ];

    for (let i = 0; i < 10; i++) {
      vi.clearAllMocks();
      setupTransaction();
      setupUnlimitedCampaign();

      // Round-robin sur les 3 entries pour simuler least-used cycling
      mockQueryRaw.mockResolvedValueOnce([entries[i % 3]]);

      const result = await selectDataEntry("campaign-unlimited", undefined, "account-1", undefined);
      expect(result, `génération ${i + 1}`).not.toBeNull();
    }
  });

  it("10 générations avec prevCursorState → anti-répétition appliquée, toutes non nulles", async () => {
    const groupsAB = [
      { setTag: "set-a", category: "CatA" },
      { setTag: "set-b", category: "CatB" },
    ];
    const entries: Record<string, { id: string; fields: string }> = {
      CatA: { id: "entry-A", fields: "{}" },
      CatB: { id: "entry-B", fields: "{}" },
    };

    let lastCat: string | null = null;
    let lastSet: string | null = null;
    let hasHistory = false;

    for (let i = 0; i < 10; i++) {
      vi.clearAllMocks();
      setupTransaction();
      setupUnlimitedCampaign();

      // La DB renvoie les groupes selon l'ordre (least-used first), on simule l'alternance
      const expectedCat = lastCat === "CatA" ? "CatB" : "CatA";
      const expectedEntry = entries[expectedCat];

      // discoverGroups
      mockQueryRaw.mockResolvedValueOnce(groupsAB);
      // pickEntryFromGroup (unlimited path, no locking)
      mockQueryRaw.mockResolvedValueOnce([expectedEntry]);

      const result = await selectDataEntry("campaign-unlimited", undefined, "account-1", {
        lastUsedSetTag: lastSet,
        lastUsedCategory: lastCat,
        hasHistory,
      });

      expect(result, `génération ${i + 1}`).not.toBeNull();
      // Anti-répétition : catégorie alterne
      if (hasHistory && lastCat !== null) {
        expect(result?.resolvedCategory).not.toBe(lastCat);
      }

      lastCat = result?.resolvedCategory ?? null;
      lastSet = result?.resolvedSetTag ?? null;
      hasHistory = true;
    }
  });

  it("pool vide (0 entries dans la lib) → retourne null même en unlimited", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);

    const result = await selectDataEntry("campaign-unlimited", undefined, "account-1", undefined);
    expect(result).toBeNull();
  });

  it("pool vide avec prevCursorState → discoverGroups vide → flat path vide → null", async () => {
    // discoverGroups retourne [] → group-based tx ne set pas entry.
    // Flat unlimited path (queryOne sans tx) renvoie aussi [] → null final.
    mockQueryRaw.mockResolvedValueOnce([]); // discoverGroups → vide
    mockQueryRaw.mockResolvedValueOnce([]); // flat queryOne (unlimited sans tx) → vide

    const result = await selectDataEntry("campaign-unlimited", undefined, "account-1", {
      lastUsedSetTag: null, lastUsedCategory: null, hasHistory: false,
    });

    expect(result).toBeNull();
  });

  it("rule='manual' → retourne null sans appel prisma", async () => {
    const result = await selectDataEntry("campaign-unlimited", "manual", "account-1");
    expect(result).toBeNull();
    expect(mockDataCampaignFindUnique).not.toHaveBeenCalled();
  });
});
