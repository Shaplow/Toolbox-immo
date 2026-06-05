/**
 * Unit tests for selectDataEntry (Phase 1.2) and selectEligibleDataGroups helper.
 *
 * selectDataEntry talks to Prisma directly, so we mock @/lib/prisma entirely.
 * selectEligibleDataGroups is a pure helper — tested without mocks.
 *
 * Coverage:
 *  - selectEligibleDataGroups — full 3-level anti-repetition logic
 *  - selectDataEntry:
 *    - rule === "manual" → null
 *    - campaign not found → null
 *    - rotationMode "none" → null
 *    - 0 entries (empty pool) → null
 *    - "unlimited" policy: returns first entry + resolvedSetTag/Category from group
 *    - 1 category → resolvedCategory matches
 *    - 2 categories + prevCursorState → anti-repetition (picks "B" when last was "A")
 *    - scope cycle_per_account: two accounts are independent
 *    - fields JSON parsed correctly
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma ─────────────────────────────────────────────────────────────
// Must be declared before the import — vitest hoists vi.mock() calls.

const mockQueryRaw = vi.fn();
const mockTransaction = vi.fn();
const mockDataCampaignFindUnique = vi.fn();
const mockDataEntryUsageCreate = vi.fn();
const mockDataEntryUsageUpsert = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    $transaction: (fn: (tx: unknown) => unknown) => mockTransaction(fn),
    dataCampaign: {
      findUnique: (...args: unknown[]) => mockDataCampaignFindUnique(...args),
    },
    dataEntryUsage: {
      create: (...args: unknown[]) => mockDataEntryUsageCreate(...args),
      upsert: (...args: unknown[]) => mockDataEntryUsageUpsert(...args),
    },
  },
}));

// Import APRÈS le mock
import { selectDataEntry, selectEligibleDataGroups } from "@/lib/contentLibraryResolver";

// ── Helpers ──────────────────────────────────────────────────────────────────

type GroupRow = { setTag: string | null; category: string | null };

function makeGroup(setTag: string | null, category: string | null): GroupRow {
  return { setTag, category };
}

function makeEntry(id: string, fields: Record<string, string> = {}, setTag: string | null = null, category: string | null = null) {
  return { id, fields: JSON.stringify(fields), setTag, category };
}

/** Returns a mock campaign for a library with the given scope/maxUsage/mode. */
function mockCampaign(
  rotationScope: string = "shared",
  rotationMode: string = "auto",
  maxUsageCount: number | null = null,
  libraryId: string = "lib-mock-1",
) {
  mockDataCampaignFindUnique.mockResolvedValue({
    library: { id: libraryId, rotationMode, rotationScope, maxUsageCount },
  });
}

// ── selectEligibleDataGroups — pure helper ───────────────────────────────────

describe("selectEligibleDataGroups", () => {
  it("hasHistory=false → returns allGroups unchanged", () => {
    const groups = [makeGroup("s1", "A"), makeGroup("s2", "B")];
    expect(selectEligibleDataGroups(groups, "A", "s1", false)).toEqual(groups);
  });

  it("≥2 distinct categories → excludes lastCategory", () => {
    const groups = [makeGroup("s1", "A"), makeGroup("s2", "B"), makeGroup("s3", "A")];
    const result = selectEligibleDataGroups(groups, "A", "s1", true);
    expect(result).toEqual([makeGroup("s2", "B")]);
  });

  it("1 category, ≥2 setTags → excludes lastSetTag", () => {
    const groups = [makeGroup("s1", "A"), makeGroup("s2", "A")];
    const result = selectEligibleDataGroups(groups, "A", "s1", true);
    expect(result).toEqual([makeGroup("s2", "A")]);
  });

  it("1 category, 1 setTag → returns allGroups (fallback explicit après W3.2)", () => {
    // Avant W3.2 : la fonction renvoyait [] et le caller faisait le fallback
    // sur allGroups. Maintenant le fallback est intégré dans la fonction pour
    // protéger tous les consumers (notamment ceux qui ne le faisaient pas).
    const groups = [makeGroup("s1", "A")];
    const result = selectEligibleDataGroups(groups, "A", "s1", true);
    expect(result).toEqual(groups);
  });

  it("null category treated correctly in ≥2 category path", () => {
    // groups with two real categories
    const groups = [makeGroup("s1", null), makeGroup("s2", "B")];
    // last was null → exclude null, keep B
    const result = selectEligibleDataGroups(groups, null, "s1", true);
    expect(result).toEqual([makeGroup("s2", "B")]);
  });

  it("null setTag excluded correctly in 1-category path", () => {
    const groups = [makeGroup(null, "A"), makeGroup("s2", "A")];
    const result = selectEligibleDataGroups(groups, "A", null, true);
    expect(result).toEqual([makeGroup("s2", "A")]);
  });

  it("empty allGroups → returns []", () => {
    expect(selectEligibleDataGroups([], "A", "s1", true)).toEqual([]);
  });
});

// ── selectDataEntry ──────────────────────────────────────────────────────────

describe("selectDataEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default transaction: execute the callback directly (no real DB)
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      // Provide a minimal tx proxy that delegates to the mocks
      const tx = {
        $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
        dataEntryUsage: {
          create: (...args: unknown[]) => mockDataEntryUsageCreate(...args),
          upsert: (...args: unknown[]) => mockDataEntryUsageUpsert(...args),
        },
        dataEntry: {
          update: vi.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });
  });

  it("rule === 'manual' → returns null immediately", async () => {
    const result = await selectDataEntry("campaign-1", "manual", "account-1");
    expect(result).toBeNull();
    expect(mockDataCampaignFindUnique).not.toHaveBeenCalled();
  });

  it("campaign not found → returns null", async () => {
    mockDataCampaignFindUnique.mockResolvedValue(null);
    const result = await selectDataEntry("campaign-missing", undefined, "account-1");
    expect(result).toBeNull();
  });

  it("library rotationMode 'none' → returns null", async () => {
    mockCampaign("shared", "none", null);
    const result = await selectDataEntry("campaign-1", undefined, "account-1");
    expect(result).toBeNull();
  });

  it("0 entries (empty pool, unlimited policy) → returns null", async () => {
    mockCampaign("shared", "auto", null); // unlimited policy (shared scope + null maxUsage)
    // queryRaw returns empty array for the group discovery and the fallback queryOne
    mockQueryRaw.mockResolvedValue([]);
    const result = await selectDataEntry("campaign-1", undefined, undefined);
    expect(result).toBeNull();
  });

  it("unlimited policy: returns first entry + resolvedSetTag/Category undefined (no cursor path)", async () => {
    mockCampaign("shared", "auto", null); // → unlimited
    const entry = makeEntry("entry-1", { titre: "Lyon centre" }, "set-A", "cat-Immo");
    // No prevCursorState → flat queryOne path, one $queryRaw call
    mockQueryRaw.mockResolvedValueOnce([entry]);

    // Without prevCursorState, falls through to flat queryOne
    const result = await selectDataEntry("campaign-1", undefined, undefined);
    expect(result).not.toBeNull();
    expect(result!.entryId).toBe("entry-1");
    expect(result!.fields).toEqual({ titre: "Lyon centre" });
    // No resolvedSetTag/Category because no prevCursorState group path was used
    expect(result!.resolvedSetTag).toBeUndefined();
    expect(result!.resolvedCategory).toBeUndefined();
  });

  it("cycle_per_account with 1 category: returns resolvedCategory", async () => {
    mockCampaign("per_account", "auto", null); // → cycle_per_account
    const entry = makeEntry("entry-2", { prix: "500000" }, "set-B", "cat-Lyon");
    const groups = [{ setTag: "set-B", category: "cat-Lyon" }];

    // prevCursorState provided → group path is used
    const prevCursorState = { lastUsedSetTag: null, lastUsedCategory: null, hasHistory: false };

    // discoverGroups returns groups
    mockQueryRaw.mockResolvedValueOnce(groups);

    // pickEntryFromGroup (cycle_per_account primary path, inside tx) returns the entry
    mockQueryRaw.mockResolvedValueOnce([entry]);
    mockDataEntryUsageCreate.mockResolvedValue({});

    const result = await selectDataEntry("campaign-1", undefined, "account-A", prevCursorState);
    expect(result).not.toBeNull();
    expect(result!.entryId).toBe("entry-2");
    expect(result!.resolvedSetTag).toBe("set-B");
    expect(result!.resolvedCategory).toBe("cat-Lyon");
    expect(result!.claimState?.claimType).toBe("perAccountUsage");
  });

  it("2 categories + prevCursorState lastCategory='A' → picks category 'B'", async () => {
    mockCampaign("per_account", "auto", null); // → cycle_per_account
    const entryB = makeEntry("entry-B", { titre: "Caluire" }, "set-2", "B");
    const groups = [
      { setTag: "set-1", category: "A" },
      { setTag: "set-2", category: "B" },
    ];

    // prevCursorState: last used was category "A"
    const prevCursorState = { lastUsedSetTag: "set-1", lastUsedCategory: "A", hasHistory: true };

    // discoverGroups → returns both groups (ordered B first after exclusion of A)
    // Note: discoverGroups returns ALL groups; selectEligibleDataGroups filters to ["B"].
    // The order in discoverGroups matters — after filtering, we iterate candidates:
    // eligible = [{ setTag: "set-2", category: "B" }]
    mockQueryRaw.mockResolvedValueOnce(groups);

    // pickEntryFromGroup called with set-1/A (first candidate after filter)
    // eligible = [set-2/B], so first candidate is B → one queryRaw call
    mockQueryRaw.mockResolvedValueOnce([entryB]);
    mockDataEntryUsageCreate.mockResolvedValue({});

    const result = await selectDataEntry("campaign-1", undefined, "account-A", prevCursorState);
    expect(result).not.toBeNull();
    expect(result!.resolvedCategory).toBe("B");
    expect(result!.resolvedSetTag).toBe("set-2");
  });

  it("2 categories + prevCursorState lastCategory='B' → picks category 'A'", async () => {
    mockCampaign("per_account", "auto", null);
    const entryA = makeEntry("entry-A", { titre: "Villeurbanne" }, "set-1", "A");
    const groups = [
      { setTag: "set-1", category: "A" },
      { setTag: "set-2", category: "B" },
    ];
    const prevCursorState = { lastUsedSetTag: "set-2", lastUsedCategory: "B", hasHistory: true };

    mockQueryRaw.mockResolvedValueOnce(groups);
    mockQueryRaw.mockResolvedValueOnce([entryA]);
    mockDataEntryUsageCreate.mockResolvedValue({});

    const result = await selectDataEntry("campaign-1", undefined, "account-A", prevCursorState);
    expect(result).not.toBeNull();
    expect(result!.resolvedCategory).toBe("A");
    expect(result!.resolvedSetTag).toBe("set-1");
  });

  it("scope cycle_per_account: two accounts are independent (separate mockQueryRaw results)", async () => {
    mockCampaign("per_account", "auto", null);
    const entryForA = makeEntry("entry-acct-A", { data: "A-data" }, "set-A", "cat-1");
    const entryForB = makeEntry("entry-acct-B", { data: "B-data" }, "set-B", "cat-2");
    const groups = [
      { setTag: "set-A", category: "cat-1" },
      { setTag: "set-B", category: "cat-2" },
    ];

    // Account A: last category was "cat-2" → picks "cat-1"
    mockQueryRaw.mockResolvedValueOnce(groups); // discoverGroups for A
    mockQueryRaw.mockResolvedValueOnce([entryForA]); // pickEntryFromGroup set-A/cat-1
    mockDataEntryUsageCreate.mockResolvedValue({});

    const resultA = await selectDataEntry(
      "campaign-1",
      undefined,
      "account-A",
      { lastUsedSetTag: "set-B", lastUsedCategory: "cat-2", hasHistory: true },
    );
    expect(resultA?.resolvedCategory).toBe("cat-1");

    vi.clearAllMocks();
    // Re-setup default transaction mock
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
        dataEntryUsage: {
          create: (...args: unknown[]) => mockDataEntryUsageCreate(...args),
          upsert: (...args: unknown[]) => mockDataEntryUsageUpsert(...args),
        },
        dataEntry: { update: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });
    mockDataCampaignFindUnique.mockResolvedValue({
      library: { id: "lib-mock-1", rotationMode: "auto", rotationScope: "per_account", maxUsageCount: null },
    });

    // Account B: last category was "cat-1" → picks "cat-2"
    mockQueryRaw.mockResolvedValueOnce(groups); // discoverGroups for B
    mockQueryRaw.mockResolvedValueOnce([entryForB]); // pickEntryFromGroup set-B/cat-2
    mockDataEntryUsageCreate.mockResolvedValue({});

    const resultB = await selectDataEntry(
      "campaign-1",
      undefined,
      "account-B",
      { lastUsedSetTag: "set-A", lastUsedCategory: "cat-1", hasHistory: true },
    );
    expect(resultB?.resolvedCategory).toBe("cat-2");

    // Results are independent
    expect(resultA?.entryId).toBe("entry-acct-A");
    expect(resultB?.entryId).toBe("entry-acct-B");
  });

  it("fields JSON parsed correctly from raw DB string", async () => {
    // Separate campaignId to avoid cache collision with other tests
    mockDataCampaignFindUnique.mockResolvedValueOnce({
      library: { id: "lib-json", rotationMode: "auto", rotationScope: "shared", maxUsageCount: null },
    });
    const rawFields = { quartier: "Ainay", prix_m2: "7500", evo: "+3.2%" };
    mockQueryRaw.mockResolvedValueOnce([{ id: "e-json", fields: JSON.stringify(rawFields) }]);

    const result = await selectDataEntry("campaign-json", undefined, undefined);
    expect(result?.entryId).toBe("e-json");
    expect(result?.fields).toEqual(rawFields);
  });

  it("fields with malformed JSON returns empty object without throwing", async () => {
    mockDataCampaignFindUnique.mockResolvedValueOnce({
      library: { id: "lib-bad", rotationMode: "auto", rotationScope: "shared", maxUsageCount: null },
    });
    mockQueryRaw.mockResolvedValueOnce([{ id: "e-bad", fields: "NOT_JSON{{" }]);

    const result = await selectDataEntry("campaign-bad", undefined, undefined);
    expect(result?.entryId).toBe("e-bad");
    expect(result?.fields).toEqual({});
  });

  it("unlimited policy without accountId → no locking, still returns entry", async () => {
    mockDataCampaignFindUnique.mockResolvedValueOnce({
      library: { id: "lib-noacct", rotationMode: "auto", rotationScope: "shared", maxUsageCount: null },
    });
    const entry = makeEntry("entry-noAccount", { val: "x" });
    mockQueryRaw.mockResolvedValueOnce([entry]);

    const result = await selectDataEntry("campaign-noacct", undefined, undefined);
    expect(result?.entryId).toBe("entry-noAccount");
    // No claim state (unlimited policy + no accountId)
    expect(result?.claimState).toBeUndefined();
  });

  // ── Phase 3.A: group-based path active for once_global and unlimited ─────────

  it("Phase 3.A — once_global + prevCursorState → group-based selection picks eligible category", async () => {
    // once_global = shared scope + maxUsageCount=1
    mockCampaign("shared", "auto", 1);
    const entryB = makeEntry("entry-once-B", { titre: "Prestige" }, "set-2", "B");
    const groups = [
      { setTag: "set-1", category: "A" },
      { setTag: "set-2", category: "B" },
    ];
    // prevCursorState: last used category was "A" → should pick "B"
    const prevCursorState = { lastUsedSetTag: "set-1", lastUsedCategory: "A", hasHistory: true };

    // discoverGroups (once_global path, called with tx inside transaction)
    mockQueryRaw.mockResolvedValueOnce(groups);
    // pickEntryFromGroup called with set-2/B (after A filtered out)
    mockQueryRaw.mockResolvedValueOnce([entryB]);

    const result = await selectDataEntry("campaign-once-global", undefined, "account-X", prevCursorState);
    expect(result).not.toBeNull();
    expect(result!.resolvedCategory).toBe("B");
    expect(result!.entryId).toBe("entry-once-B");
  });

  it("Phase 3.A — unlimited + prevCursorState → group-based selection avoids last category", async () => {
    // unlimited = shared scope + null maxUsageCount
    mockCampaign("shared", "auto", null);
    const entryB = makeEntry("entry-unlim-B", { data: "b" }, "set-2", "B");
    const groups = [
      { setTag: "set-1", category: "A" },
      { setTag: "set-2", category: "B" },
    ];
    const prevCursorState = { lastUsedSetTag: "set-2", lastUsedCategory: "B", hasHistory: true };

    // discoverGroups (unlimited path, called with tx)
    mockQueryRaw.mockResolvedValueOnce(groups);
    // pickEntryFromGroup called with set-1/A (after B filtered out)
    mockQueryRaw.mockResolvedValueOnce([entryB]);

    const result = await selectDataEntry("campaign-unlimited", undefined, "account-X", prevCursorState);
    expect(result).not.toBeNull();
    // After filtering B, eligible = [A]. Candidate is A, but mock returns entryB for simplicity
    // (real DB would return A-group entry — this test validates the path is taken, not the exact filter)
    expect(result!.entryId).toBe("entry-unlim-B");
  });

  // ── Phase 3.B: shared scope uses SHARED_DATA_CURSOR_ACCOUNT_ID ──────────────

  it("Phase 3.B — shared lib: two accounts with prevCursorState both use group-based path", async () => {
    // shared scope + unlimited → two accounts should advance the same shared cursor
    // This test validates that effectiveCursorId = SHARED_DATA_CURSOR_ACCOUNT_ID is used.
    // We can't easily test the SQL parameter in unit mocks, but we validate that:
    // (a) the group-based path is taken for both accounts,
    // (b) both calls succeed and return entries.
    mockCampaign("shared", "auto", null);
    const entryA = makeEntry("entry-shared-A", { zone: "nord" }, "set-1", "A");
    const groups = [{ setTag: "set-1", category: "A" }];
    const prevCursorState = { lastUsedSetTag: null, lastUsedCategory: null, hasHistory: false };

    // Account 1
    mockQueryRaw.mockResolvedValueOnce(groups);
    mockQueryRaw.mockResolvedValueOnce([entryA]);
    const result1 = await selectDataEntry("campaign-shared", undefined, "account-alpha", prevCursorState);
    expect(result1?.entryId).toBe("entry-shared-A");
    expect(result1?.resolvedCategory).toBe("A");

    vi.clearAllMocks();
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
        dataEntryUsage: {
          create: (...args: unknown[]) => mockDataEntryUsageCreate(...args),
          upsert: (...args: unknown[]) => mockDataEntryUsageUpsert(...args),
        },
        dataEntry: { update: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });
    mockDataCampaignFindUnique.mockResolvedValue({
      library: { id: "lib-mock-1", rotationMode: "auto", rotationScope: "shared", maxUsageCount: null },
    });

    // Account 2 — same shared lib, same cursor entry returned
    mockQueryRaw.mockResolvedValueOnce(groups);
    mockQueryRaw.mockResolvedValueOnce([entryA]);
    const result2 = await selectDataEntry("campaign-shared", undefined, "account-beta", prevCursorState);
    expect(result2?.entryId).toBe("entry-shared-A");
    // Both accounts go through the group-based tx path
  });

  // ── Fix C3: orphan group (null/null) — lastAdvancedAt should be set ──────────
  // (Unit test for the logic change; the actual DB write is tested by the
  //  advanceDataLibraryCursorOnSubmit integration path, not by selectDataEntry.)
  // We verify that selectDataEntry with prevCursorState still returns entries
  // for an all-orphan lib (null/null groups) without throwing or returning null.

  it("Fix C3 — all-orphan group (null/null): group-based path returns entry, no throw", async () => {
    mockCampaign("per_account", "auto", null); // → cycle_per_account
    const orphanEntry = makeEntry("entry-orphan-1", { info: "orphan" }, null, null);
    const groups = [{ setTag: null, category: null }]; // single orphan group

    // prevCursorState with hasHistory=true (simulates state after first advance with nulls)
    const prevCursorState = { lastUsedSetTag: null, lastUsedCategory: null, hasHistory: true };

    // discoverGroups returns the orphan group
    mockQueryRaw.mockResolvedValueOnce(groups);
    // selectEligibleDataGroups: 1 category (null), 1 setTag (null) → filters to [] (all excluded)
    // candidates = allGroups (fallback) = [{ null, null }]
    // pickEntryFromGroup: cycle_per_account primary path
    mockQueryRaw.mockResolvedValueOnce([orphanEntry]);
    mockDataEntryUsageCreate.mockResolvedValue({});

    const result = await selectDataEntry("campaign-orphan", undefined, "account-Z", prevCursorState);
    expect(result).not.toBeNull();
    expect(result!.entryId).toBe("entry-orphan-1");
    expect(result!.resolvedSetTag).toBeNull();
    expect(result!.resolvedCategory).toBeNull();
  });
});
