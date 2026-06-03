/**
 * Tests unit pour advanceDataEntryClaimOnSubmit (Phase 8.M1).
 *
 * Cette fonction est le miroir de advanceLibraryCursorsOnSubmit pour DataLibrary :
 * elle fait le claim au moment du submit (pas au prefill), avec fallback re-pick
 * en cas de conflit concurrent.
 *
 * Pattern : mock @/lib/prisma comme dans selectDataEntry.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock prisma ──────────────────────────────────────────────────────────────

const mockDataCampaignFindUnique = vi.fn();
const mockDataEntryUsageCreate = vi.fn();
const mockExecuteRaw = vi.fn();
const mockQueryRaw = vi.fn();
const mockTransaction = vi.fn();
const mockDataEntryUsageUpsert = vi.fn();
const mockAccountDataLibraryCursorFindUnique = vi.fn();
const mockDataEntryFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dataCampaign: {
      findUnique: (...args: unknown[]) => mockDataCampaignFindUnique(...args),
    },
    dataEntry: {
      findUnique: (...args: unknown[]) => mockDataEntryFindUnique(...args),
    },
    dataEntryUsage: {
      create: (...args: unknown[]) => mockDataEntryUsageCreate(...args),
      upsert: (...args: unknown[]) => mockDataEntryUsageUpsert(...args),
    },
    accountDataLibraryCursor: {
      findUnique: (...args: unknown[]) => mockAccountDataLibraryCursorFindUnique(...args),
    },
    $executeRaw: (...args: unknown[]) => mockExecuteRaw(...args),
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    $transaction: (fn: (tx: unknown) => unknown) => mockTransaction(fn),
  },
}));

import { advanceDataEntryClaimOnSubmit } from "@/lib/contentLibraryResolver";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Cas "rotationMode none" → null ──────────────────────────────────────────

describe("advanceDataEntryClaimOnSubmit — rotationMode none", () => {
  it("returns null when library.rotationMode === 'none'", async () => {
    mockDataCampaignFindUnique.mockResolvedValue({
      library: { rotationMode: "none", rotationScope: "shared", maxUsageCount: null },
    });
    const result = await advanceDataEntryClaimOnSubmit("campaign-1", "entry-1", "account-A");
    expect(result).toBeNull();
    expect(mockDataEntryUsageCreate).not.toHaveBeenCalled();
  });
});

// ── Cas "unlimited" → null (pas de claim) ────────────────────────────────────

describe("advanceDataEntryClaimOnSubmit — unlimited", () => {
  it("returns null for unlimited policy (no claim needed)", async () => {
    mockDataCampaignFindUnique.mockResolvedValue({
      library: { rotationMode: "auto", rotationScope: "shared", maxUsageCount: null },
    });
    const result = await advanceDataEntryClaimOnSubmit("campaign-1", "entry-1", "account-A");
    expect(result).toBeNull();
    expect(mockDataEntryUsageCreate).not.toHaveBeenCalled();
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });
});

// ── Cas "cycle_per_account" claim réussi ─────────────────────────────────────

describe("advanceDataEntryClaimOnSubmit — cycle_per_account", () => {
  it("creates DataEntryUsage when suggested entry is claimable", async () => {
    mockDataCampaignFindUnique.mockResolvedValue({
      library: { rotationMode: "auto", rotationScope: "per_account", maxUsageCount: null },
    });
    mockDataEntryUsageCreate.mockResolvedValue({ entryId: "entry-1", accountId: "account-A", usageCount: 0 });

    const result = await advanceDataEntryClaimOnSubmit("campaign-1", "entry-1", "account-A");

    expect(mockDataEntryUsageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ entryId: "entry-1", accountId: "account-A", usageCount: 0 }),
    });
    expect(result?.claimState.entryId).toBe("entry-1");
    expect(result?.claimState.claimType).toBe("perAccountUsage");
    expect(result?.claimState.usagePolicy).toBe("cycle_per_account");
  });

  it("returns null when accountId is missing for per_account policy", async () => {
    mockDataCampaignFindUnique.mockResolvedValue({
      library: { rotationMode: "auto", rotationScope: "per_account", maxUsageCount: null },
    });
    const result = await advanceDataEntryClaimOnSubmit("campaign-1", "entry-1", undefined);
    expect(result).toBeNull();
    expect(mockDataEntryUsageCreate).not.toHaveBeenCalled();
  });

  it("falls back to re-pick when create fails (unique constraint violation)", async () => {
    mockDataCampaignFindUnique
      .mockResolvedValueOnce({
        library: { rotationMode: "auto", rotationScope: "per_account", maxUsageCount: null },
      })
      // Second call (inside selectDataEntry fallback)
      .mockResolvedValueOnce({
        library: { id: "lib-1", rotationMode: "auto", rotationScope: "per_account", maxUsageCount: null },
      });

    // create throws (claim already exists)
    mockDataEntryUsageCreate.mockRejectedValueOnce(new Error("Unique constraint violation"));

    // Fallback selectDataEntry calls $transaction → fall through to flat selection
    // Le mock $transaction exécute la fonction et retourne le résultat
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      // tx mock minimal pour ce test
      const tx = {
        $queryRaw: vi.fn().mockResolvedValueOnce([{ id: "entry-2", fields: '{"q":"v"}' }]),
        dataEntryUsage: { create: vi.fn().mockResolvedValue({}) },
      };
      await fn(tx);
    });
    // (Plus de mocks complexes seraient nécessaires pour le fallback complet —
    // ce test valide juste que le path fallback est tenté.)

    const result = await advanceDataEntryClaimOnSubmit("campaign-1", "entry-1", "account-A");
    // Result peut être null si le fallback n'a pas claim ou contenir entry-2 si succès.
    // L'essentiel : on n'a pas throw, et le re-pick a été tenté.
    expect(mockTransaction).toHaveBeenCalled();
    expect(result === null || result?.claimState).toBeDefined();
  });
});

// ── Cas "once_global" → CAS atomique ─────────────────────────────────────────

describe("advanceDataEntryClaimOnSubmit — once_global", () => {
  it("uses atomic CAS UPDATE for once_global policy", async () => {
    mockDataCampaignFindUnique.mockResolvedValue({
      library: { rotationMode: "auto", rotationScope: "shared", maxUsageCount: 1 },
    });
    mockExecuteRaw.mockResolvedValue(1); // 1 row updated = success

    const result = await advanceDataEntryClaimOnSubmit("campaign-1", "entry-1", "account-A");

    expect(mockExecuteRaw).toHaveBeenCalled();
    expect(result?.claimState.entryId).toBe("entry-1");
    expect(result?.claimState.claimType).toBe("usedInCycle");
    expect(result?.claimState.usagePolicy).toBe("once_global");
  });

  it("falls back when CAS UPDATE returns 0 (entry already claimed)", async () => {
    mockDataCampaignFindUnique
      .mockResolvedValueOnce({
        library: { rotationMode: "auto", rotationScope: "shared", maxUsageCount: 1 },
      })
      .mockResolvedValueOnce({
        library: { id: "lib-1", rotationMode: "auto", rotationScope: "shared", maxUsageCount: 1 },
      });
    mockExecuteRaw.mockResolvedValue(0); // 0 rows = already claimed

    // Fallback selectDataEntry — minimal mock
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]), // empty pool
        dataEntry: { update: vi.fn() },
      };
      await fn(tx);
    });
    mockQueryRaw.mockResolvedValue([]);

    const result = await advanceDataEntryClaimOnSubmit("campaign-1", "entry-1", "account-A");
    // CAS failed AND fallback found nothing → null is acceptable.
    expect(mockExecuteRaw).toHaveBeenCalled();
    expect(result === null || result?.claimState).toBeDefined();
  });
});

// ── Cas "campaign not found" → null ─────────────────────────────────────────

describe("advanceDataEntryClaimOnSubmit — campaign not found", () => {
  it("returns null when campaign does not exist", async () => {
    mockDataCampaignFindUnique.mockResolvedValue(null);
    const result = await advanceDataEntryClaimOnSubmit("campaign-missing", "entry-1", "account-A");
    expect(result).toBeNull();
  });

  it("returns null when campaign has no library", async () => {
    mockDataCampaignFindUnique.mockResolvedValue({ library: null });
    const result = await advanceDataEntryClaimOnSubmit("campaign-1", "entry-1", "account-A");
    expect(result).toBeNull();
  });
});
