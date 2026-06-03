/**
 * DataLibrary — once_global
 *
 * rotationScope="shared" + maxUsageCount=1 → policy "once_global".
 * Règle : chaque entry ne peut être utilisée QU'UNE seule fois, TOUS comptes confondus.
 * Après épuisement global (3 entries utilisées), tout appel retourne null
 * quel que soit le compte.
 *
 * Scénario : 3 entries, 2 comptes A et B, 4 générations totales → 4e null peu
 * importe le compte demandeur.
 *
 * La claim se fait via DataEntry.usedInCycle=true (SET atomique dans la tx).
 * Le revert se fait via SET usedInCycle=false WHERE usageCount=0.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma ───────────────────────────────────────────────────────────────
const mockQueryRaw = vi.fn();
const mockTransaction = vi.fn();
const mockDataCampaignFindUnique = vi.fn();
const mockDataEntryUsageCreate = vi.fn();
const mockDataEntryUsageUpsert = vi.fn();
const mockDataEntryUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    $transaction: (fn: (tx: unknown) => unknown) => mockTransaction(fn),
    dataCampaign: { findUnique: (...args: unknown[]) => mockDataCampaignFindUnique(...args) },
    dataEntryUsage: {
      create: (...args: unknown[]) => mockDataEntryUsageCreate(...args),
      upsert: (...args: unknown[]) => mockDataEntryUsageUpsert(...args),
    },
    dataEntry: { update: (...args: unknown[]) => mockDataEntryUpdate(...args) },
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
    dataEntry: { update: (...args: unknown[]) => mockDataEntryUpdate(...args) },
  };
}

function setupTransaction() {
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(makeTxProxy()));
}

function setupOnceGlobalCampaign() {
  // shared + maxUsageCount=1 → "once_global" policy
  mockDataCampaignFindUnique.mockResolvedValue({
    library: { id: "lib-once-global", rotationMode: "auto", rotationScope: "shared", maxUsageCount: 1 },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DataLibrary — once_global", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTransaction();
    setupOnceGlobalCampaign();
  });

  it("génération 1 (compte A) — retourne entry-A + claim usedInCycle=true", async () => {
    const entryA = { id: "entry-A", fields: JSON.stringify({ titre: "Bien A" }) };

    mockQueryRaw.mockResolvedValueOnce([{ setTag: "set-a", category: "CatA" }]); // discoverGroups
    mockQueryRaw.mockResolvedValueOnce([entryA]); // pickEntryFromGroup once_global
    mockDataEntryUpdate.mockResolvedValue({});

    const result = await selectDataEntry("campaign-once-global", undefined, "account-A", {
      lastUsedSetTag: null, lastUsedCategory: null, hasHistory: false,
    });

    expect(result?.entryId).toBe("entry-A");
    expect(result?.claimState?.claimType).toBe("usedInCycle");
    expect(mockDataEntryUpdate).toHaveBeenCalledOnce();
    // Vérifie l'argument du update : usedInCycle=true
    expect(mockDataEntryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { usedInCycle: true } }),
    );
  });

  it("génération 2 (compte B) — retourne entry-B (CatB, anti-répétition CatA)", async () => {
    const entryB = { id: "entry-B", fields: JSON.stringify({ titre: "Bien B" }) };

    mockQueryRaw.mockResolvedValueOnce([
      { setTag: "set-a", category: "CatA" },
      { setTag: "set-b", category: "CatB" },
    ]);
    mockQueryRaw.mockResolvedValueOnce([entryB]);
    mockDataEntryUpdate.mockResolvedValue({});

    const result = await selectDataEntry("campaign-once-global", undefined, "account-B", {
      lastUsedSetTag: "set-a", lastUsedCategory: "CatA", hasHistory: true,
    });

    expect(result?.entryId).toBe("entry-B");
    expect(result?.resolvedCategory).toBe("CatB");
    expect(result?.claimState?.claimType).toBe("usedInCycle");
  });

  it("génération 3 (compte A) — retourne entry-C (dernière entry disponible)", async () => {
    const entryC = { id: "entry-C", fields: "{}" };

    mockQueryRaw.mockResolvedValueOnce([{ setTag: "set-c", category: "CatC" }]);
    mockQueryRaw.mockResolvedValueOnce([entryC]);
    mockDataEntryUpdate.mockResolvedValue({});

    const result = await selectDataEntry("campaign-once-global", undefined, "account-A", {
      lastUsedSetTag: "set-b", lastUsedCategory: "CatB", hasHistory: true,
    });

    expect(result?.entryId).toBe("entry-C");
    expect(result?.claimState?.claimType).toBe("usedInCycle");
  });

  it("génération 4 (compte B) — pool globalement épuisé → retourne null", async () => {
    // discoverGroups once_global retourne [] (filtre AND usageCount=0 AND usedInCycle=false).
    // Le flat path once_global (2e $transaction) renvoie aussi [] → null final.
    mockQueryRaw.mockResolvedValueOnce([]); // discoverGroups → pool vide
    mockQueryRaw.mockResolvedValueOnce([]); // flat path tx.$queryRaw → pool vide aussi

    const result = await selectDataEntry("campaign-once-global", undefined, "account-B", {
      lastUsedSetTag: "set-c", lastUsedCategory: "CatC", hasHistory: true,
    });

    expect(result).toBeNull();
  });

  it("génération 4 bis (compte A) — pool globalement épuisé → retourne null aussi pour compte A", async () => {
    // Peu importe le compte : once_global est global
    mockQueryRaw.mockResolvedValueOnce([]); // discoverGroups
    mockQueryRaw.mockResolvedValueOnce([]); // flat path tx

    const result = await selectDataEntry("campaign-once-global", undefined, "account-A", {
      lastUsedSetTag: "set-c", lastUsedCategory: "CatC", hasHistory: true,
    });

    expect(result).toBeNull();
  });

  it("sans accountId + once_global → flat path (queryOne), filtre usageCount=0 AND usedInCycle=false", async () => {
    // Sans accountId, la politique "shared+1" = "once_global" mais flat path (pas de tx locking)
    const entryA = { id: "entry-A", fields: "{}" };
    mockQueryRaw.mockResolvedValueOnce([entryA]);

    const result = await selectDataEntry("campaign-once-global", undefined, undefined, undefined);
    expect(result?.entryId).toBe("entry-A");
    // Pas de claimState sans accountId + no prevCursorState
  });

  it("rotationMode 'none' → retourne null immédiatement", async () => {
    mockDataCampaignFindUnique.mockResolvedValue({
      library: { id: "lib-none", rotationMode: "none", rotationScope: "shared", maxUsageCount: 1 },
    });

    const result = await selectDataEntry("campaign-none", undefined, "account-A");
    expect(result).toBeNull();
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });
});
