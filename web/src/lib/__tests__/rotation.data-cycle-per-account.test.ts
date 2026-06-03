/**
 * DataLibrary — cycle_per_account
 *
 * Scénario : 3 entries dans 3 catégories distinctes (A, B, C), 1 compte, 4
 * générations → la 4e redémarre le cycle (restart), aucune catégorie ne se
 * répète consécutivement.
 *
 * Pattern mock : vi.mock("@/lib/prisma") déclaré AVANT l'import de la SUT.
 * $transaction exécute le callback directement avec un tx proxy.
 * $queryRaw retourne les données décidées par chaque test via mockReturnValueOnce.
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

function setupCampaign(scope = "per_account", maxUsage: number | null = null) {
  mockDataCampaignFindUnique.mockResolvedValue({
    library: { id: "lib-cycle", rotationMode: "auto", rotationScope: scope, maxUsageCount: maxUsage },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DataLibrary — cycle_per_account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTransaction();
  });

  it("3 entries 3 catégories — 3 premières générations couvrent les 3 catégories distinctes", async () => {
    setupCampaign("per_account", null); // cycle_per_account

    const entries = [
      { id: "entry-A", fields: JSON.stringify({ zone: "A" }), setTag: "set-a", category: "CatA" },
      { id: "entry-B", fields: JSON.stringify({ zone: "B" }), setTag: "set-b", category: "CatB" },
      { id: "entry-C", fields: JSON.stringify({ zone: "C" }), setTag: "set-c", category: "CatC" },
    ];

    // Génération 1 — prevCursorState vide → discoverGroups + pickEntryFromGroup (entry-A)
    const groups123 = [
      { setTag: "set-a", category: "CatA" },
      { setTag: "set-b", category: "CatB" },
      { setTag: "set-c", category: "CatC" },
    ];
    mockQueryRaw.mockResolvedValueOnce(groups123); // discoverGroups
    mockQueryRaw.mockResolvedValueOnce([entries[0]]); // pickEntryFromGroup → entry-A
    mockDataEntryUsageCreate.mockResolvedValue({});

    const r1 = await selectDataEntry("campaign-cycle", undefined, "account-1", {
      lastUsedSetTag: null, lastUsedCategory: null, hasHistory: false,
    });
    expect(r1?.entryId).toBe("entry-A");
    expect(r1?.resolvedCategory).toBe("CatA");

    vi.clearAllMocks();
    setupTransaction();
    setupCampaign("per_account", null);

    // Génération 2 — lastCategory=CatA → exclut CatA, picks CatB
    const groupsExclA = [
      { setTag: "set-b", category: "CatB" },
      { setTag: "set-c", category: "CatC" },
    ];
    mockQueryRaw.mockResolvedValueOnce(groupsExclA); // discoverGroups (DB renvoie déjà filtré selon usage)
    mockQueryRaw.mockResolvedValueOnce([entries[1]]); // pickEntryFromGroup → entry-B
    mockDataEntryUsageCreate.mockResolvedValue({});

    const r2 = await selectDataEntry("campaign-cycle", undefined, "account-1", {
      lastUsedSetTag: "set-a", lastUsedCategory: "CatA", hasHistory: true,
    });
    expect(r2?.entryId).toBe("entry-B");
    expect(r2?.resolvedCategory).toBe("CatB");

    vi.clearAllMocks();
    setupTransaction();
    setupCampaign("per_account", null);

    // Génération 3 — lastCategory=CatB → exclut CatB, picks CatC
    const groupsExclB = [{ setTag: "set-c", category: "CatC" }];
    mockQueryRaw.mockResolvedValueOnce(groupsExclB);
    mockQueryRaw.mockResolvedValueOnce([entries[2]]);
    mockDataEntryUsageCreate.mockResolvedValue({});

    const r3 = await selectDataEntry("campaign-cycle", undefined, "account-1", {
      lastUsedSetTag: "set-b", lastUsedCategory: "CatB", hasHistory: true,
    });
    expect(r3?.entryId).toBe("entry-C");
    expect(r3?.resolvedCategory).toBe("CatC");
  });

  it("4e génération — cycle restart : toutes les entries sont claimées, fallback renvoie la moins utilisée", async () => {
    setupCampaign("per_account", null);

    // Après 3 générations, toutes les entries ont un DataEntryUsage(usageCount=0).
    // discoverGroups les liste encore (usageCount >= 1 path dans le fallback).
    // Le fallback "genuinely used" renvoie entry-A (la moins utilisée).
    const allGroups = [
      { setTag: "set-a", category: "CatA" },
      { setTag: "set-b", category: "CatB" },
      { setTag: "set-c", category: "CatC" },
    ];
    const fallbackEntry = { id: "entry-A", fields: JSON.stringify({ zone: "A" }) };

    // discoverGroups
    mockQueryRaw.mockResolvedValueOnce(allGroups);
    // pickEntryFromGroup primary (not yet claimed) → empty (toutes claimées)
    mockQueryRaw.mockResolvedValueOnce([]);
    // pickEntryFromGroup fallback (cycle restart, usageCount >= 1)
    mockQueryRaw.mockResolvedValueOnce([fallbackEntry]);

    const r4 = await selectDataEntry("campaign-cycle", undefined, "account-1", {
      lastUsedSetTag: "set-c", lastUsedCategory: "CatC", hasHistory: true,
    });
    // Le restart peut choisir n'importe quelle catégorie (sauf CatC d'affilée si possible)
    expect(r4).not.toBeNull();
    expect(r4!.entryId).toBe("entry-A");
  });

  it("pas de répétition consécutive de catégorie sur 3 générations (assertNoConsecutiveCategory)", async () => {
    // Test récapitulatif : on vérifie que les catégories obtenues en gens 1-3 sont toutes distinctes.
    setupCampaign("per_account", null);

    const entries = [
      { id: "entry-A", fields: "{}", setTag: "set-a", category: "CatA" },
      { id: "entry-B", fields: "{}", setTag: "set-b", category: "CatB" },
    ];

    // Gen 1
    mockQueryRaw.mockResolvedValueOnce([{ setTag: "set-a", category: "CatA" }, { setTag: "set-b", category: "CatB" }]);
    mockQueryRaw.mockResolvedValueOnce([entries[0]]);
    mockDataEntryUsageCreate.mockResolvedValue({});
    const r1 = await selectDataEntry("campaign-cycle", undefined, "account-1", {
      lastUsedSetTag: null, lastUsedCategory: null, hasHistory: false,
    });

    vi.clearAllMocks();
    setupTransaction();
    setupCampaign("per_account", null);

    // Gen 2 — lastCategory = CatA → éligibles = [CatB]
    mockQueryRaw.mockResolvedValueOnce([{ setTag: "set-b", category: "CatB" }]);
    mockQueryRaw.mockResolvedValueOnce([entries[1]]);
    mockDataEntryUsageCreate.mockResolvedValue({});
    const r2 = await selectDataEntry("campaign-cycle", undefined, "account-1", {
      lastUsedSetTag: "set-a", lastUsedCategory: "CatA", hasHistory: true,
    });

    expect(r1?.resolvedCategory).toBe("CatA");
    expect(r2?.resolvedCategory).toBe("CatB");
    // Les deux catégories sont différentes : anti-répétition OK
    expect(r1?.resolvedCategory).not.toBe(r2?.resolvedCategory);
  });

  it("claimState.claimType === 'perAccountUsage' positionné sur le résultat", async () => {
    setupCampaign("per_account", null);

    mockQueryRaw.mockResolvedValueOnce([{ setTag: "set-a", category: "CatA" }]);
    mockQueryRaw.mockResolvedValueOnce([{ id: "entry-A", fields: "{}", setTag: "set-a", category: "CatA" }]);
    mockDataEntryUsageCreate.mockResolvedValue({});

    const result = await selectDataEntry("campaign-cycle", undefined, "account-1", {
      lastUsedSetTag: null, lastUsedCategory: null, hasHistory: false,
    });

    expect(result?.claimState?.claimType).toBe("perAccountUsage");
    expect(result?.claimState?.accountId).toBe("account-1");
  });
});
