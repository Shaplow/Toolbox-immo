/**
 * DataLibrary — revert admin (revertRenderUsage)
 *
 * Teste le chemin ADMIN ("Annuler l'impact rotation" sur /listings →
 * POST /api/admin/renders/[id]/revert-usage → revertRenderUsage()), à ne pas
 * confondre avec le chemin ERROR (revertLibraryCursors, couvert par
 * rotation.data-revert-on-error.test.ts).
 *
 * Régression visée : avant le fix, revertRenderUsage rembobinait les compteurs
 * DataEntry / DataEntryUsage mais OUBLIAIT le curseur AccountDataLibraryCursor
 * (lastUsedSetTag / lastUsedCategory / lastAdvancedAt). Conséquence : après un
 * revert admin d'un render data, le curseur restait avancé d'un cran sur les
 * compteurs rembobinés → le groupe reverté était sauté à la génération
 * suivante. Le curseur média (AccountLibraryCursor) lui était déjà reverté ;
 * c'est l'asymétrie que ces tests verrouillent.
 *
 * Architecture du test : revertRenderUsage lit render.findUnique, décrémente via
 * dataEntry/dataEntryUsage.update, puis fait un UPDATE CAS du curseur data via
 * $executeRaw. On vérifie summary.cursors + les appels $executeRaw via spies.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma ───────────────────────────────────────────────────────────────
const mockRenderFindUnique = vi.fn();
const mockDataEntryFindUnique = vi.fn();
const mockDataEntryUpdate = vi.fn();
const mockDataEntryUsageFindUnique = vi.fn();
const mockDataEntryUsageUpdate = vi.fn();
const mockExecuteRaw = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    render: { findUnique: (...args: unknown[]) => mockRenderFindUnique(...args) },
    dataEntry: {
      findUnique: (...args: unknown[]) => mockDataEntryFindUnique(...args),
      update: (...args: unknown[]) => mockDataEntryUpdate(...args),
    },
    dataEntryUsage: {
      findUnique: (...args: unknown[]) => mockDataEntryUsageFindUnique(...args),
      update: (...args: unknown[]) => mockDataEntryUsageUpdate(...args),
    },
    $executeRaw: (...args: unknown[]) => mockExecuteRaw(...args),
  },
}));

import { revertRenderUsage } from "@/lib/recordLibraryUsage";

// ── Fixtures ───────────────────────────────────────────────────────────────────

/** usedAssets d'un render data avec snapshot de curseur DataLibrary. */
function makeDataRenderUsedAssets({
  entryId = "entry-A",
  libraryId = "datalib-1",
  cursorAccountId = "account-1",
  prevLastUsedSetTag = null as string | null,
  prevLastUsedCategory = null as string | null,
  claimedSetTag = "set-a" as string | null,
  claimedCategory = "CatA" as string | null,
  withCursorSnapshot = true,
} = {}) {
  return JSON.stringify({
    dataEntryId: entryId,
    ...(withCursorSnapshot
      ? {
          prevDataLibraryCursorState: {
            libraryId,
            accountId: cursorAccountId,
            prevLastUsedSetTag,
            prevLastUsedCategory,
            claimedSetTag,
            claimedCategory,
          },
        }
      : {}),
  });
}

function primeDataEntryMocks() {
  // Superset couvrant les deux findUnique de la section DataEntry :
  // 1) select usageCount/lastUsedAt, 2) select campaign.library.rotationScope.
  mockDataEntryFindUnique.mockResolvedValue({
    usageCount: 1,
    lastUsedAt: new Date("2026-06-17T00:00:00.000Z"),
    campaign: { library: { rotationScope: "per_account" } },
  });
  mockDataEntryUpdate.mockResolvedValue({});
  mockDataEntryUsageFindUnique.mockResolvedValue(null); // pas de ligne per-account → update skippé
  mockDataEntryUsageUpdate.mockResolvedValue({});
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("revertRenderUsage — revert curseur AccountDataLibraryCursor (chemin admin)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeDataEntryMocks();
  });

  it("snapshot présent + CAS OK → curseur reverté (summary.cursors reverted=true)", async () => {
    mockRenderFindUnique.mockResolvedValue({
      status: "DONE",
      accountId: "account-1",
      usedAssets: makeDataRenderUsedAssets({ libraryId: "datalib-1" }),
    });
    mockExecuteRaw.mockResolvedValue(1); // 1 row → curseur rembobiné

    const summary = await revertRenderUsage("render-data-1");

    // Le bloc média n'a pas de snapshot → un seul $executeRaw (le curseur data).
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    expect(summary.cursors).toEqual([{ libraryId: "datalib-1", reverted: true }]);
    // Le compteur DataEntry est aussi rembobiné (pas une régression).
    expect(summary.assets.some((a) => a.type === "dataEntry")).toBe(true);
  });

  it("CAS rate (curseur déjà ré-avancé par une gen suivante) → reverted=false + skippedReason", async () => {
    mockRenderFindUnique.mockResolvedValue({
      status: "DONE",
      accountId: "account-1",
      usedAssets: makeDataRenderUsedAssets({ libraryId: "datalib-2" }),
    });
    mockExecuteRaw.mockResolvedValue(0); // 0 row → CAS no-op

    const summary = await revertRenderUsage("render-data-cas");

    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    expect(summary.cursors).toHaveLength(1);
    expect(summary.cursors[0].reverted).toBe(false);
    expect(summary.cursors[0].skippedReason).toBeTruthy();
  });

  it("render data SANS snapshot curseur → aucun UPDATE curseur, summary.cursors vide", async () => {
    mockRenderFindUnique.mockResolvedValue({
      status: "DONE",
      accountId: "account-1",
      usedAssets: makeDataRenderUsedAssets({ withCursorSnapshot: false }),
    });

    const summary = await revertRenderUsage("render-data-no-snap");

    expect(mockExecuteRaw).not.toHaveBeenCalled();
    expect(summary.cursors).toHaveLength(0);
    // Les compteurs DataEntry sont quand même rembobinés.
    expect(summary.assets.some((a) => a.type === "dataEntry")).toBe(true);
  });

  it("lib shared → l'UPDATE utilise l'accountId du snapshot (sentinel), pas render.accountId", async () => {
    mockRenderFindUnique.mockResolvedValue({
      status: "DONE",
      accountId: "account-real", // accountId réel du render
      usedAssets: makeDataRenderUsedAssets({
        libraryId: "datalib-shared",
        cursorAccountId: "__shared__data__", // SHARED_DATA_CURSOR_ACCOUNT_ID
        claimedSetTag: "set-x",
        claimedCategory: "CatX",
      }),
    });
    mockExecuteRaw.mockResolvedValue(1);

    const summary = await revertRenderUsage("render-data-shared");

    expect(summary.cursors).toEqual([{ libraryId: "datalib-shared", reverted: true }]);
    // L'UPDATE doit cibler la ligne sentinel, pas l'accountId réel du render.
    const sqlArg = mockExecuteRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sqlArg.values).toContain("__shared__data__");
    expect(sqlArg.values).not.toContain("account-real");
  });
});
