/**
 * Tirage « dossier simple » (plan simplification Phase 3) —
 * selectMediaAssetFromFolder + advanceMediaUsageOnSubmit.
 *
 * Remplace les 15 fichiers rotation.*.test.ts (curseurs/anti-répétition
 * décommissionnés). Prisma mocké au niveau module — le tri SQL lui-même
 * (least-recently-used NULLS FIRST) est validé par inspection du SQL généré ;
 * la sémantique bout-en-bout se vérifie en manuel (cf. plan Phase 3).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQueryRaw = vi.fn();
const mockMediaLibraryFindUnique = vi.fn();
const mockMediaAssetFindMany = vi.fn();
const mockUsageFindUnique = vi.fn();
const mockUsageUpsert = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    mediaLibrary: { findUnique: (...args: unknown[]) => mockMediaLibraryFindUnique(...args) },
    mediaAsset: { findMany: (...args: unknown[]) => mockMediaAssetFindMany(...args) },
    mediaAssetUsage: {
      findUnique: (...args: unknown[]) => mockUsageFindUnique(...args),
      upsert: (...args: unknown[]) => mockUsageUpsert(...args),
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        mediaAssetUsage: {
          findUnique: (...args: unknown[]) => mockUsageFindUnique(...args),
          upsert: (...args: unknown[]) => mockUsageUpsert(...args),
        },
      }),
  },
}));

import {
  selectMediaAssetFromFolder,
  advanceMediaUsageOnSubmit,
} from "@/lib/contentLibraryResolver";
import { SHARED_CURSOR_ACCOUNT_ID, isReservedSetTag } from "@/lib/rotation/sentinels";

function makeAssetRow(id: string) {
  return { id, url: `https://r2.test/${id}.mp4`, filename: `${id}.mp4` };
}

/** Extrait le texte SQL d'un appel $queryRaw (Prisma.Sql template). */
function sqlTextOfCall(callIndex: number): string {
  const arg = mockQueryRaw.mock.calls[callIndex]?.[0] as { strings?: string[] } | undefined;
  return (arg?.strings ?? []).join(" ");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMediaLibraryFindUnique.mockResolvedValue({
    maxUsageCount: null,
    rotationScope: "per_account",
    rotationMode: "auto",
  });
});

describe("selectMediaAssetFromFolder — flux de tirage", () => {
  it("rotationMode='none' → null sans aucune query", async () => {
    mockMediaLibraryFindUnique.mockResolvedValue({
      maxUsageCount: null,
      rotationScope: "per_account",
      rotationMode: "none",
    });
    const r = await selectMediaAssetFromFolder("lib-1", "acc-1");
    expect(r).toBeNull();
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it("bibliothèque inexistante → null", async () => {
    mockMediaLibraryFindUnique.mockResolvedValue(null);
    expect(await selectMediaAssetFromFolder("lib-ghost", "acc-1")).toBeNull();
  });

  it("legacy rotationMode='override' est lu comme auto (tirage normal)", async () => {
    mockMediaLibraryFindUnique.mockResolvedValue({
      maxUsageCount: null,
      rotationScope: "per_account",
      rotationMode: "override",
    });
    mockQueryRaw
      .mockResolvedValueOnce([{ setTag: "intro-01" }]) // découverte dossiers
      .mockResolvedValueOnce([makeAssetRow("a1")]); // pick
    const r = await selectMediaAssetFromFolder("lib-1", "acc-1");
    expect(r?.id).toBe("a1");
  });

  it("pinnedSetTag → pioche directe dans le dossier, sans découverte", async () => {
    mockQueryRaw.mockResolvedValueOnce([makeAssetRow("a-intro")]);
    const r = await selectMediaAssetFromFolder("lib-1", "acc-1", undefined, "tournage-03");
    expect(r).toEqual({ ...makeAssetRow("a-intro"), resolvedSetTag: "tournage-03" });
    // Une seule query (pick) — pas de découverte de dossiers.
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(sqlTextOfCall(0)).toContain('ma."setTag" =');
  });

  it("pinnedSetTag=null → dossier « (sans dossier) » (setTag IS NULL)", async () => {
    mockQueryRaw.mockResolvedValueOnce([makeAssetRow("orphan-1")]);
    const r = await selectMediaAssetFromFolder("lib-1", "acc-1", undefined, null);
    expect(r?.resolvedSetTag).toBeNull();
    expect(sqlTextOfCall(0)).toContain('ma."setTag" IS NULL');
  });

  it("découverte : sert le premier dossier de la liste (le moins récemment servi)", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ setTag: "B" }, { setTag: "A" }]) // ordre du SQL = ancienneté
      .mockResolvedValueOnce([makeAssetRow("b1")]);
    const r = await selectMediaAssetFromFolder("lib-1", "acc-1");
    expect(r).toEqual({ ...makeAssetRow("b1"), resolvedSetTag: "B" });
  });

  it("dossier en tête sans asset éligible → passe au suivant", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ setTag: "B" }, { setTag: "A" }])
      .mockResolvedValueOnce([]) // B vide (course avec un claim concurrent)
      .mockResolvedValueOnce([makeAssetRow("a1")]);
    const r = await selectMediaAssetFromFolder("lib-1", "acc-1");
    expect(r).toEqual({ ...makeAssetRow("a1"), resolvedSetTag: "A" });
  });

  it("aucun dossier éligible → null", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);
    expect(await selectMediaAssetFromFolder("lib-1", "acc-1")).toBeNull();
  });

  it("le SQL de découverte trie least-recently-served NULLS FIRST, tie-break createdAt puis setTag", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);
    await selectMediaAssetFromFolder("lib-1", "acc-1");
    const sql = sqlTextOfCall(0);
    expect(sql).toContain("ORDER BY sub.last_used ASC NULLS FIRST");
    expect(sql).toContain("sub.folder_created_at ASC NULLS LAST");
    expect(sql).toContain("LPAD");
    // Ancienneté per-account via MediaAssetUsage (clé = accountId réel ici).
    expect(sql).toContain('MAX(mau."lastUsedAt")');
  });

  it("sans accountId (preview admin) : ancienneté globale (pas de JOIN usage)", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);
    await selectMediaAssetFromFolder("lib-1", undefined);
    const sql = sqlTextOfCall(0);
    expect(sql).toContain('MAX(ma."lastUsedAt")');
    expect(sql).not.toContain("MediaAssetUsage mau ON");
  });

  it("burn-once per_account : le filtre d'usage max apparaît dans la découverte", async () => {
    mockMediaLibraryFindUnique.mockResolvedValue({
      maxUsageCount: 2,
      rotationScope: "per_account",
      rotationMode: "auto",
    });
    mockQueryRaw.mockResolvedValueOnce([]);
    await selectMediaAssetFromFolder("lib-1", "acc-1");
    expect(sqlTextOfCall(0)).toContain('FROM "MediaAssetUsage" mau2');
  });

  it("burn-once shared : le filtre porte sur le compteur global de l'asset", async () => {
    mockMediaLibraryFindUnique.mockResolvedValue({
      maxUsageCount: 1,
      rotationScope: "shared",
      rotationMode: "auto",
    });
    mockQueryRaw.mockResolvedValueOnce([]);
    await selectMediaAssetFromFolder("lib-1", "acc-1", undefined, undefined, undefined, SHARED_CURSOR_ACCOUNT_ID);
    expect(sqlTextOfCall(0)).toContain('ma."usageCount" <');
  });

  it("minDuration est injecté dans le filtre (NULL toléré)", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);
    await selectMediaAssetFromFolder("lib-1", "acc-1", undefined, undefined, undefined, undefined, 12);
    expect(sqlTextOfCall(0)).toContain("ma.duration IS NULL OR ma.duration >=");
  });
});

describe("advanceMediaUsageOnSubmit — claim au submit", () => {
  it("per_account : claim sous le compte réel, snapshot prev/claimed", async () => {
    mockMediaAssetFindMany.mockResolvedValue([
      { id: "a1", library: { rotationScope: "per_account" } },
    ]);
    mockUsageFindUnique.mockResolvedValue({ lastUsedAt: new Date("2026-08-01T00:00:00Z") });
    const r = await advanceMediaUsageOnSubmit(["a1"], "acc-1");
    expect(r.prevMediaUsageStates).toHaveLength(1);
    const s = r.prevMediaUsageStates[0]!;
    expect(s.accountId).toBe("acc-1");
    expect(s.prevLastUsedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(s.claimedLastUsedAt).toBeTruthy();
    expect(mockUsageUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetId_accountId: { assetId: "a1", accountId: "acc-1" } },
      }),
    );
  });

  it("shared : claim sous la sentinelle __shared__", async () => {
    mockMediaAssetFindMany.mockResolvedValue([
      { id: "a1", library: { rotationScope: "shared" } },
    ]);
    mockUsageFindUnique.mockResolvedValue(null);
    const r = await advanceMediaUsageOnSubmit(["a1"], "acc-1");
    expect(r.prevMediaUsageStates[0]!.accountId).toBe(SHARED_CURSOR_ACCOUNT_ID);
    expect(r.prevMediaUsageStates[0]!.prevLastUsedAt).toBeNull();
  });

  it("liste vide → aucun accès DB", async () => {
    const r = await advanceMediaUsageOnSubmit([], "acc-1");
    expect(r.prevMediaUsageStates).toEqual([]);
    expect(mockMediaAssetFindMany).not.toHaveBeenCalled();
  });
});

describe("isReservedSetTag — préfixe pack_ réservé (H.2)", () => {
  it("détecte les dossiers auto-générés historiques", () => {
    expect(isReservedSetTag("pack_1734567")).toBe(true);
    expect(isReservedSetTag("tournage-03")).toBe(false);
    expect(isReservedSetTag(null)).toBe(false);
    expect(isReservedSetTag(undefined)).toBe(false);
  });
});
