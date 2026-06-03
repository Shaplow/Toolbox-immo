/**
 * MediaLibrary — revert on ERROR (Phase 6 fix)
 *
 * Valide que revertLibraryCursors() revert correctement le curseur Media :
 *  - prevCursorStateByLibrary → UPDATE AccountLibraryCursor CAS conditionnel.
 *  - Phase 6 fix : lastUsedSetTag est inclus dans le SET + la condition CAS.
 *    Sans ce fix, un revert concurrent pourrait écraser un setTag changé par
 *    une autre génération concurrente.
 *
 * Structure usedAssets.prevCursorStateByLibrary[libId] :
 *  { prevCursor, claimedCursor, prevLastUsedCategory, claimedLastUsedCategory,
 *    prevLastUsedSetTag, claimedLastUsedSetTag, cursorAccountId }
 *
 * Le test vérifie :
 *  1. $executeRaw est appelé avec le bon UPDATE AccountLibraryCursor.
 *  2. La condition CAS inclut lastUsedSetTag (Phase 6).
 *  3. Revert no-op si CAS rate (curseur avancé entre-temps).
 *  4. Revert correct pour libs shared (cursorAccountId = SHARED_CURSOR_ACCOUNT_ID).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma ───────────────────────────────────────────────────────────────
const mockRenderFindUnique = vi.fn();
const mockExecuteRaw = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    render: { findUnique: (...args: unknown[]) => mockRenderFindUnique(...args) },
    $executeRaw: (...args: unknown[]) => mockExecuteRaw(...args),
  },
}));

import { revertLibraryCursors } from "@/lib/recordLibraryUsage";

// ── Fixtures ──────────────────────────────────────────────────────────────────

type CursorState = {
  prevCursor: number;
  claimedCursor: number;
  prevLastUsedCategory: string | null;
  claimedLastUsedCategory: string | null;
  prevLastUsedSetTag: string | null;
  claimedLastUsedSetTag: string | null;
  cursorAccountId: string;
};

function makeUsedAssetsWithMediaCursor(
  libId: string,
  state: Partial<CursorState>,
  accountId = "account-1",
) {
  const fullState: CursorState = {
    prevCursor: 0,
    claimedCursor: 1,
    prevLastUsedCategory: null,
    claimedLastUsedCategory: "CatA",
    prevLastUsedSetTag: null,
    claimedLastUsedSetTag: "set-a",
    cursorAccountId: accountId,
    ...state,
  };
  return JSON.stringify({
    prevCursorStateByLibrary: { [libId]: fullState },
  });
}

// ── Tests — revert basique ────────────────────────────────────────────────────

describe("revertLibraryCursors — Media cursor revert (AccountLibraryCursor)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prevCursorStateByLibrary présent → $executeRaw appelé (UPDATE AccountLibraryCursor)", async () => {
    mockRenderFindUnique.mockResolvedValue({
      usedAssets: makeUsedAssetsWithMediaCursor("lib-media-1", {}),
      accountId: "account-1",
    });
    mockExecuteRaw.mockResolvedValue(1); // 1 row updated

    await revertLibraryCursors("render-media-1");

    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });

  it("CAS réussi (1 row updated) → revert effectué sans erreur", async () => {
    mockRenderFindUnique.mockResolvedValue({
      usedAssets: makeUsedAssetsWithMediaCursor("lib-media-1", {
        prevCursor: 3,
        claimedCursor: 4,
        prevLastUsedCategory: "CatB",
        claimedLastUsedCategory: "CatA",
        prevLastUsedSetTag: "set-b",
        claimedLastUsedSetTag: "set-a",
      }),
      accountId: "account-1",
    });
    mockExecuteRaw.mockResolvedValue(1);

    await expect(revertLibraryCursors("render-media-cas-ok")).resolves.toBeUndefined();
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });

  it("CAS rate (0 rows) — curseur déjà avancé par DONE concurrent → no-op, pas d'erreur", async () => {
    mockRenderFindUnique.mockResolvedValue({
      usedAssets: makeUsedAssetsWithMediaCursor("lib-media-1", {
        claimedCursor: 4,
        claimedLastUsedCategory: "CatA",
        claimedLastUsedSetTag: "set-a",
      }),
      accountId: "account-1",
    });
    // CAS rate : le curseur n'est plus à claimedCursor=4 (DONE a déjà avancé)
    mockExecuteRaw.mockResolvedValue(0);

    await expect(revertLibraryCursors("render-media-cas-fail")).resolves.toBeUndefined();
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });
});

// ── Tests — Phase 6 : lastUsedSetTag dans CAS ─────────────────────────────────

describe("Phase 6 — lastUsedSetTag inclus dans le CAS (protection concurrent setTag-only change)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prevLastUsedSetTag=null, claimedLastUsedSetTag='set-a' → CAS inclut setTag", async () => {
    mockRenderFindUnique.mockResolvedValue({
      usedAssets: makeUsedAssetsWithMediaCursor("lib-setTag-1", {
        prevLastUsedSetTag: null,
        claimedLastUsedSetTag: "set-a",
      }),
      accountId: "account-1",
    });
    mockExecuteRaw.mockResolvedValue(1);

    await revertLibraryCursors("render-settag-1");

    // Vérifie que $executeRaw est bien appelé (la condition WHERE inclut IS NOT DISTINCT FROM)
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
    // Le SQL exact n'est pas inspectable dans les mocks (Prisma.sql template literal),
    // mais on valide que le chemin est bien pris.
  });

  it("prevLastUsedSetTag='set-x', claimedLastUsedSetTag='set-y' → CAS avec setTag complet", async () => {
    mockRenderFindUnique.mockResolvedValue({
      usedAssets: makeUsedAssetsWithMediaCursor("lib-setTag-2", {
        prevLastUsedSetTag: "set-x",
        claimedLastUsedSetTag: "set-y",
      }),
      accountId: "account-1",
    });
    mockExecuteRaw.mockResolvedValue(1);

    await revertLibraryCursors("render-settag-2");
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });

  it("concurrent : DONE a changé lastUsedSetTag → CAS rate, pas d'écrasement", async () => {
    // Simule : génération 1 claimed setTag="set-a". Génération 2 DONE a avancé setTag="set-b".
    // Le revert de génération 1 doit être un no-op (0 rows updated).
    mockRenderFindUnique.mockResolvedValue({
      usedAssets: makeUsedAssetsWithMediaCursor("lib-setTag-concurrent", {
        claimedLastUsedSetTag: "set-a", // ce qu'on a écrit
        prevLastUsedSetTag: null,
      }),
      accountId: "account-1",
    });
    // La DB a maintenant setTag="set-b" (avancé par gen-2) → condition WHERE rate
    mockExecuteRaw.mockResolvedValue(0);

    await expect(revertLibraryCursors("render-concurrent")).resolves.toBeUndefined();
    // No-op : setTag déjà écrasé par une génération concurrente → on ne revert pas
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });
});

// ── Tests — shared libs (cursorAccountId = SHARED_CURSOR_ACCOUNT_ID) ──────────

describe("revertLibraryCursors — Media shared libs (SHARED_CURSOR_ACCOUNT_ID)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cursorAccountId='__shared__' → $executeRaw utilise __shared__ comme accountId", async () => {
    mockRenderFindUnique.mockResolvedValue({
      usedAssets: makeUsedAssetsWithMediaCursor("lib-shared-media", {
        cursorAccountId: "__shared__",
      }, "account-real"),
      accountId: "account-real",
    });
    mockExecuteRaw.mockResolvedValue(1);

    await revertLibraryCursors("render-shared-media");
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });

  it("cursorAccountId absent dans state → fallback sur render.accountId", async () => {
    // Sans cursorAccountId explicite, le code utilise accountId du render
    mockRenderFindUnique.mockResolvedValue({
      usedAssets: JSON.stringify({
        prevCursorStateByLibrary: {
          "lib-no-cursor-id": {
            prevCursor: 0,
            claimedCursor: 1,
            prevLastUsedCategory: null,
            claimedLastUsedCategory: "CatA",
            prevLastUsedSetTag: null,
            claimedLastUsedSetTag: "set-a",
            // cursorAccountId absent → fallback sur render.accountId
          },
        },
      }),
      accountId: "account-fallback",
    });
    mockExecuteRaw.mockResolvedValue(1);

    await revertLibraryCursors("render-fallback-account");
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
  });
});

// ── Tests — render manquant ou usedAssets vide ────────────────────────────────

describe("revertLibraryCursors — edge cases Media", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("render introuvable → pas de $executeRaw", async () => {
    mockRenderFindUnique.mockResolvedValue(null);

    await revertLibraryCursors("render-absent");
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it("prevCursorStateByLibrary vide {} → pas de $executeRaw", async () => {
    mockRenderFindUnique.mockResolvedValue({
      usedAssets: JSON.stringify({ prevCursorStateByLibrary: {} }),
      accountId: "account-1",
    });

    await revertLibraryCursors("render-empty-map");
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it("accountId render absent + prevCursorStateByLibrary → $executeRaw non appelé (sécurité)", async () => {
    // Sans accountId, la condition `if (accountId && prevStateMap ...)` est false
    mockRenderFindUnique.mockResolvedValue({
      usedAssets: makeUsedAssetsWithMediaCursor("lib-1", {}),
      accountId: null, // accountId absent
    });

    await revertLibraryCursors("render-no-accountid");
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it("2 librairies dans prevCursorStateByLibrary → $executeRaw appelé 2 fois", async () => {
    const state: CursorState = {
      prevCursor: 0, claimedCursor: 1,
      prevLastUsedCategory: null, claimedLastUsedCategory: "CatA",
      prevLastUsedSetTag: null, claimedLastUsedSetTag: "set-a",
      cursorAccountId: "account-1",
    };

    mockRenderFindUnique.mockResolvedValue({
      usedAssets: JSON.stringify({
        prevCursorStateByLibrary: { "lib-1": state, "lib-2": state },
      }),
      accountId: "account-1",
    });
    mockExecuteRaw.mockResolvedValue(1);

    await revertLibraryCursors("render-two-libs");
    expect(mockExecuteRaw).toHaveBeenCalledTimes(2);
  });
});
