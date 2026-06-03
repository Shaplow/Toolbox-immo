/**
 * DataLibrary — once_per_account
 *
 * rotationScope="per_account" + maxUsageCount=1 → policy "once_per_account".
 * Règle : chaque entry ne peut être utilisée QU'UNE seule fois par compte.
 * Après épuisement, selectDataEntry retourne null.
 *
 * Scénario : 3 entries, 1 compte, 5 générations → 4e retourne null (pool épuisé).
 * (Avec prevCursorState fourni, le groupe-based path est pris en 1-3.
 *  La 4e + 5e invocation n'ont plus d'entries disponibles → null.)
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

function setupOncePerAccountCampaign() {
  // per_account + maxUsageCount=1 → "once_per_account" policy
  mockDataCampaignFindUnique.mockResolvedValue({
    library: { id: "lib-once-pa", rotationMode: "auto", rotationScope: "per_account", maxUsageCount: 1 },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DataLibrary — once_per_account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTransaction();
    setupOncePerAccountCampaign();
  });

  it("génération 1 — retourne entry-A (première disponible)", async () => {
    const entryA = { id: "entry-A", fields: JSON.stringify({ titre: "Bien A" }) };

    mockQueryRaw.mockResolvedValueOnce([{ setTag: "set-a", category: "CatA" }]); // discoverGroups
    mockQueryRaw.mockResolvedValueOnce([entryA]); // pickEntryFromGroup once_per_account
    mockDataEntryUsageUpsert.mockResolvedValue({});

    const result = await selectDataEntry("campaign-once-pa", undefined, "account-1", {
      lastUsedSetTag: null, lastUsedCategory: null, hasHistory: false,
    });

    expect(result?.entryId).toBe("entry-A");
    expect(result?.claimState?.claimType).toBe("perAccountUsage");
    expect(mockDataEntryUsageUpsert).toHaveBeenCalledOnce();
  });

  it("génération 2 — retourne entry-B (CatB, anti-répétition CatA)", async () => {
    const entryB = { id: "entry-B", fields: JSON.stringify({ titre: "Bien B" }) };

    mockQueryRaw.mockResolvedValueOnce([
      { setTag: "set-a", category: "CatA" },
      { setTag: "set-b", category: "CatB" },
    ]);
    mockQueryRaw.mockResolvedValueOnce([entryB]);
    mockDataEntryUsageUpsert.mockResolvedValue({});

    const result = await selectDataEntry("campaign-once-pa", undefined, "account-1", {
      lastUsedSetTag: "set-a", lastUsedCategory: "CatA", hasHistory: true,
    });

    expect(result?.entryId).toBe("entry-B");
    expect(result?.resolvedCategory).toBe("CatB");
  });

  it("génération 3 — retourne entry-C (seule restante)", async () => {
    const entryC = { id: "entry-C", fields: JSON.stringify({ titre: "Bien C" }) };

    mockQueryRaw.mockResolvedValueOnce([{ setTag: "set-c", category: "CatC" }]);
    mockQueryRaw.mockResolvedValueOnce([entryC]);
    mockDataEntryUsageUpsert.mockResolvedValue({});

    const result = await selectDataEntry("campaign-once-pa", undefined, "account-1", {
      lastUsedSetTag: "set-b", lastUsedCategory: "CatB", hasHistory: true,
    });

    expect(result?.entryId).toBe("entry-C");
  });

  it("génération 4 — pool épuisé pour ce compte → retourne null", async () => {
    // discoverGroups retourne [] → transaction group-based ne trouve rien.
    // Ensuite le flat path once_per_account est tenté (2e $transaction), renvoie aussi [].
    mockQueryRaw.mockResolvedValueOnce([]); // discoverGroups → aucun groupe éligible
    mockQueryRaw.mockResolvedValueOnce([]); // flat path tx.$queryRaw → aucune entry non-utilisée

    const result = await selectDataEntry("campaign-once-pa", undefined, "account-1", {
      lastUsedSetTag: "set-c", lastUsedCategory: "CatC", hasHistory: true,
    });

    expect(result).toBeNull();
  });

  it("génération 5 — pool toujours épuisé → retourne null", async () => {
    // Même comportement : group-based vide + flat vide
    mockQueryRaw.mockResolvedValueOnce([]); // discoverGroups
    mockQueryRaw.mockResolvedValueOnce([]); // flat tx

    const result = await selectDataEntry("campaign-once-pa", undefined, "account-1", {
      lastUsedSetTag: "set-c", lastUsedCategory: "CatC", hasHistory: true,
    });

    expect(result).toBeNull();
  });

  it("sans prevCursorState — flat path once_per_account avec accountId → upsert claim", async () => {
    // Sans prevCursorState, le flat path s'exécute (tx directe)
    const entryA = { id: "entry-A", fields: "{}" };
    mockQueryRaw.mockResolvedValueOnce([entryA]);
    mockDataEntryUsageUpsert.mockResolvedValue({});

    const result = await selectDataEntry("campaign-once-pa", undefined, "account-1", undefined);
    expect(result?.entryId).toBe("entry-A");
    expect(mockDataEntryUsageUpsert).toHaveBeenCalledOnce();
  });

  it("compte B isolé du compte A — compte B peut encore sélectionner des entries", async () => {
    // Le scope per_account isole les comptes : compte B peut utiliser les 3 entries
    // même si compte A les a toutes consommées.
    const entryA = { id: "entry-A", fields: "{}" };

    mockQueryRaw.mockResolvedValueOnce([{ setTag: "set-a", category: "CatA" }]);
    mockQueryRaw.mockResolvedValueOnce([entryA]);
    mockDataEntryUsageUpsert.mockResolvedValue({});

    const result = await selectDataEntry("campaign-once-pa", undefined, "account-B", {
      lastUsedSetTag: null, lastUsedCategory: null, hasHistory: false,
    });

    expect(result?.entryId).toBe("entry-A");
    expect(result?.claimState?.accountId).toBe("account-B");
  });
});
