/**
 * Tirage « dossier simple » DataEntry (plan simplification Phase 4) —
 * selectDataEntry + advanceDataUsageOnSubmit.
 *
 * Remplace selectDataEntry.test.ts / advanceDataEntryClaim.test.ts (policies
 * par campagne, usedInCycle, curseurs — décommissionnés). Miroir de
 * folderDraw.media.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQueryRaw = vi.fn();
const mockDataLibraryFindUnique = vi.fn();
const mockDataEntryFindUnique = vi.fn();
const mockUsageFindUnique = vi.fn();
const mockUsageUpsert = vi.fn();
const mockDataEntryUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    dataLibrary: { findUnique: (...args: unknown[]) => mockDataLibraryFindUnique(...args) },
    dataEntry: {
      findUnique: (...args: unknown[]) => mockDataEntryFindUnique(...args),
      update: (...args: unknown[]) => mockDataEntryUpdate(...args),
    },
    dataEntryUsage: {
      findUnique: (...args: unknown[]) => mockUsageFindUnique(...args),
      upsert: (...args: unknown[]) => mockUsageUpsert(...args),
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        dataEntry: {
          update: (...args: unknown[]) => mockDataEntryUpdate(...args),
        },
        dataEntryUsage: {
          findUnique: (...args: unknown[]) => mockUsageFindUnique(...args),
          upsert: (...args: unknown[]) => mockUsageUpsert(...args),
        },
      }),
  },
}));

import {
  selectDataEntry,
  advanceDataUsageOnSubmit,
  claimDataEntryForCaption,
} from "@/lib/contentLibraryResolver";
import { SHARED_DATA_USAGE_ACCOUNT_ID } from "@/lib/rotation/sentinels";

function sqlTextOfCall(callIndex: number): string {
  const arg = mockQueryRaw.mock.calls[callIndex]?.[0] as { strings?: string[] } | undefined;
  return (arg?.strings ?? []).join(" ");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDataLibraryFindUnique.mockResolvedValue({
    rotationMode: "auto",
    rotationScope: "per_account",
    maxUsageCount: null,
  });
});

describe("selectDataEntry — tirage dossier", () => {
  it("rule='manual' → null sans accès DB", async () => {
    expect(await selectDataEntry("lib-1", "manual", "acc-1")).toBeNull();
    expect(mockDataLibraryFindUnique).not.toHaveBeenCalled();
  });

  it("rotationMode='none' → null", async () => {
    mockDataLibraryFindUnique.mockResolvedValue({
      rotationMode: "none",
      rotationScope: "per_account",
      maxUsageCount: null,
    });
    expect(await selectDataEntry("lib-1", undefined, "acc-1")).toBeNull();
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it("sert le premier dossier de la liste et parse les fields", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ setTag: "quartiers" }, { setTag: null }])
      .mockResolvedValueOnce([{ id: "e1", fields: '{"quartier":"Marais"}' }]);
    const r = await selectDataEntry("lib-1", "not_used_in_cycle", "acc-1");
    expect(r).toEqual({
      entryId: "e1",
      fields: { quartier: "Marais" },
      resolvedSetTag: "quartiers",
    });
  });

  it("dossier de tête vide → passe au suivant (« (sans dossier) »)", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ setTag: "A" }, { setTag: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "e2", fields: "{}" }]);
    const r = await selectDataEntry("lib-1", undefined, "acc-1");
    expect(r?.entryId).toBe("e2");
    expect(r?.resolvedSetTag).toBeNull();
    expect(sqlTextOfCall(2)).toContain('de."setTag" IS NULL');
  });

  it("fields JSON corrompu → objet vide (pas de throw)", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ setTag: "A" }])
      .mockResolvedValueOnce([{ id: "e1", fields: "{invalid" }]);
    const r = await selectDataEntry("lib-1", undefined, "acc-1");
    expect(r?.fields).toEqual({});
  });

  it("découverte triée least-recently-served NULLS FIRST (usage per-account)", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);
    await selectDataEntry("lib-1", undefined, "acc-1");
    const sql = sqlTextOfCall(0);
    expect(sql).toContain("ORDER BY sub.last_used ASC NULLS FIRST");
    expect(sql).toContain('MAX(deu."lastUsedAt")');
  });

  it("scope shared : ancienneté via la sentinelle __shared__data__, burn global", async () => {
    mockDataLibraryFindUnique.mockResolvedValue({
      rotationMode: "auto",
      rotationScope: "shared",
      maxUsageCount: 2,
    });
    mockQueryRaw.mockResolvedValueOnce([]);
    await selectDataEntry("lib-1", undefined, "acc-1");
    const sql = sqlTextOfCall(0);
    expect(sql).toContain('de."usageCount" <');
    // La clé d'usage est la sentinelle, pas le compte réel.
    const params = (mockQueryRaw.mock.calls[0]?.[0] as { values?: unknown[] })?.values ?? [];
    expect(params).toContain(SHARED_DATA_USAGE_ACCOUNT_ID);
  });

  it("burn-once per_account : filtre sur DataEntryUsage du compte réel", async () => {
    mockDataLibraryFindUnique.mockResolvedValue({
      rotationMode: "auto",
      rotationScope: "per_account",
      maxUsageCount: 1,
    });
    mockQueryRaw.mockResolvedValueOnce([]);
    await selectDataEntry("lib-1", undefined, "acc-1");
    expect(sqlTextOfCall(0)).toContain('FROM "DataEntryUsage" deu2');
  });
});

describe("advanceDataUsageOnSubmit — claim au submit", () => {
  it("per_account : stamp sous le compte réel avec snapshot", async () => {
    mockDataEntryFindUnique.mockResolvedValue({
      id: "e1",
      library: { rotationMode: "auto", rotationScope: "per_account" },
    });
    mockUsageFindUnique.mockResolvedValue({ lastUsedAt: new Date("2026-08-01T00:00:00Z") });
    const r = await advanceDataUsageOnSubmit("e1", "acc-1");
    expect(r?.prevDataUsageState.accountId).toBe("acc-1");
    expect(r?.prevDataUsageState.prevLastUsedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(mockUsageUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entryId_accountId: { entryId: "e1", accountId: "acc-1" } },
      }),
    );
  });

  it("shared : stamp sous la sentinelle __shared__data__ même avec un compte", async () => {
    mockDataEntryFindUnique.mockResolvedValue({
      id: "e1",
      library: { rotationMode: "auto", rotationScope: "shared" },
    });
    mockUsageFindUnique.mockResolvedValue(null);
    const r = await advanceDataUsageOnSubmit("e1", "acc-1");
    expect(r?.prevDataUsageState.accountId).toBe(SHARED_DATA_USAGE_ACCOUNT_ID);
    expect(r?.prevDataUsageState.prevLastUsedAt).toBeNull();
  });

  it("rotationMode='none' → pas de claim", async () => {
    mockDataEntryFindUnique.mockResolvedValue({
      id: "e1",
      library: { rotationMode: "none", rotationScope: "per_account" },
    });
    expect(await advanceDataUsageOnSubmit("e1", "acc-1")).toBeNull();
    expect(mockUsageUpsert).not.toHaveBeenCalled();
  });

  it("per_account sans accountId → pas de claim (preview admin)", async () => {
    mockDataEntryFindUnique.mockResolvedValue({
      id: "e1",
      library: { rotationMode: "auto", rotationScope: "per_account" },
    });
    expect(await advanceDataUsageOnSubmit("e1", undefined)).toBeNull();
  });

  it("entry supprimée entre prefill et submit → null silencieux", async () => {
    mockDataEntryFindUnique.mockResolvedValue(null);
    expect(await advanceDataUsageOnSubmit("e-ghost", "acc-1")).toBeNull();
  });
});

describe("claimDataEntryForCaption — claim final à l'affectation d'une légende", () => {
  it("per_account : incrémente usageCount+lastUsedAt global ET la ligne compte réel", async () => {
    mockDataEntryFindUnique.mockResolvedValue({
      library: { rotationMode: "auto", rotationScope: "per_account" },
    });
    const ok = await claimDataEntryForCaption("e1", "acc-1");
    expect(ok).toBe(true);
    expect(mockDataEntryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "e1" },
        data: expect.objectContaining({ usageCount: { increment: 1 } }),
      }),
    );
    expect(mockUsageUpsert).toHaveBeenCalledTimes(1);
    expect(mockUsageUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entryId_accountId: { entryId: "e1", accountId: "acc-1" } },
      }),
    );
  });

  it("shared : double upsert — compte réel ET sentinelle __shared__data__", async () => {
    mockDataEntryFindUnique.mockResolvedValue({
      library: { rotationMode: "auto", rotationScope: "shared" },
    });
    const ok = await claimDataEntryForCaption("e1", "acc-1");
    expect(ok).toBe(true);
    expect(mockUsageUpsert).toHaveBeenCalledTimes(2);
    expect(mockUsageUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entryId_accountId: { entryId: "e1", accountId: "acc-1" } },
      }),
    );
    expect(mockUsageUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entryId_accountId: { entryId: "e1", accountId: SHARED_DATA_USAGE_ACCOUNT_ID } },
      }),
    );
  });

  it("sans compte : seul le compteur global est écrit, aucun upsert DataEntryUsage", async () => {
    mockDataEntryFindUnique.mockResolvedValue({
      library: { rotationMode: "auto", rotationScope: "per_account" },
    });
    const ok = await claimDataEntryForCaption("e1", undefined);
    expect(ok).toBe(true);
    expect(mockDataEntryUpdate).toHaveBeenCalledTimes(1);
    expect(mockUsageUpsert).not.toHaveBeenCalled();
  });

  it("rotationMode='none' → false, aucune écriture", async () => {
    mockDataEntryFindUnique.mockResolvedValue({
      library: { rotationMode: "none", rotationScope: "per_account" },
    });
    const ok = await claimDataEntryForCaption("e1", "acc-1");
    expect(ok).toBe(false);
    expect(mockDataEntryUpdate).not.toHaveBeenCalled();
    expect(mockUsageUpsert).not.toHaveBeenCalled();
  });

  it("entry introuvable → false sans throw", async () => {
    mockDataEntryFindUnique.mockResolvedValue(null);
    expect(await claimDataEntryForCaption("e-ghost", "acc-1")).toBe(false);
  });

  it("erreur DB → false sans throw (best-effort)", async () => {
    mockDataEntryFindUnique.mockRejectedValue(new Error("db down"));
    await expect(claimDataEntryForCaption("e1", "acc-1")).resolves.toBe(false);
  });
});
