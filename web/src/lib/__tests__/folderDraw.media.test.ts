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
import { SHARED_USAGE_ACCOUNT_ID, isReservedSetTag } from "@/lib/rotation/sentinels";

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

  it("le SQL de découverte trie has_unused DESC en premier, puis least-recently-served NULLS FIRST, tie-break createdAt puis setTag", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);
    await selectMediaAssetFromFolder("lib-1", "acc-1");
    const sql = sqlTextOfCall(0);
    // P8 (régression 21/08, commit 6b435b3 réintroduit après suppression au
    // refactor « dossiers simples » 86a18d0) : has_unused DESC doit être le
    // TOUT PREMIER critère de tri — sinon MAX(lastUsedAt) ignore les NULL et
    // un dossier « à moitié neuf » (1 asset servi + N neufs) est classé comme
    // entièrement consommé, resservant du déjà-vu devant du stock neuf.
    expect(sql).toContain("ORDER BY sub.has_unused DESC");
    expect(sql).toContain("sub.last_used ASC NULLS FIRST");
    expect(sql).toContain("sub.folder_created_at ASC NULLS LAST");
    expect(sql).toContain("LPAD");
    expect(sql.indexOf("has_unused DESC")).toBeLessThan(sql.indexOf("sub.last_used ASC NULLS FIRST"));
    // Ancienneté per-account via MediaAssetUsage (clé = accountId réel ici).
    expect(sql).toContain('MAX(mau."lastUsedAt")');
  });

  it("P8 — has_unused projeté via COUNT FILTER sur l'expression d'usage (per-account)", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);
    await selectMediaAssetFromFolder("lib-1", "acc-1");
    const sql = sqlTextOfCall(0);
    expect(sql).toContain('COUNT(*) FILTER (WHERE mau."lastUsedAt" IS NULL) > 0 AS has_unused');
    // Pas de filtre disabled dans le COUNT : le WHERE (accessFilter) l'exclut déjà.
    expect(sql).not.toContain('NOT ma."disabled" AND mau."lastUsedAt" IS NULL');
  });

  it("sans accountId (preview admin) : ancienneté globale (pas de JOIN usage), has_unused sur MediaAsset.lastUsedAt", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);
    await selectMediaAssetFromFolder("lib-1", undefined);
    const sql = sqlTextOfCall(0);
    expect(sql).toContain('MAX(ma."lastUsedAt")');
    expect(sql).not.toContain("MediaAssetUsage mau ON");
    expect(sql).toContain('COUNT(*) FILTER (WHERE ma."lastUsedAt" IS NULL) > 0 AS has_unused');
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
    await selectMediaAssetFromFolder("lib-1", "acc-1", undefined, undefined, undefined, SHARED_USAGE_ACCOUNT_ID);
    expect(sqlTextOfCall(0)).toContain('ma."usageCount" <');
  });

  it("minDuration est injecté dans le filtre (NULL toléré)", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);
    await selectMediaAssetFromFolder("lib-1", "acc-1", undefined, undefined, undefined, undefined, 12);
    expect(sqlTextOfCall(0)).toContain("ma.duration IS NULL OR ma.duration >=");
  });

  // Fix #2 (P8 rotation) : le défaut de clé d'usage se fixe DANS
  // selectMediaAssetFromFolder — la fonction charge déjà rotationScope, donc
  // aucun appelant ne devrait avoir à passer explicitement la sentinelle.
  // Corrige la redécouverte render-time (generateRender.ts) qui appelle
  // sans 6e argument (usageAccountId=undefined).
  it("P8 fix #2 — scope shared SANS usageAccountId explicite : ancienneté sous la sentinelle __shared__ par défaut", async () => {
    mockMediaLibraryFindUnique.mockResolvedValue({
      maxUsageCount: null,
      rotationScope: "shared",
      rotationMode: "auto",
    });
    mockQueryRaw.mockResolvedValueOnce([]);
    // Pas de 6e argument (usageAccountId) — c'est exactement l'appel de
    // generateRender.ts:1352 (redécouverte render-time).
    await selectMediaAssetFromFolder("lib-1", "acc-1");
    const params = (mockQueryRaw.mock.calls[0]?.[0] as { values?: unknown[] })?.values ?? [];
    // "acc-1" reste présent (accessFilter, visibilité — toujours le compte
    // réel) : seule l'ancienneté (le JOIN MediaAssetUsage) doit basculer sur
    // la sentinelle.
    expect(params).toContain(SHARED_USAGE_ACCOUNT_ID);
    expect(sqlTextOfCall(0)).toContain('MediaAssetUsage" mau ON');
  });

  it("P8 fix #2 — scope per_account SANS usageAccountId explicite : ancienneté sous le compte réel (comportement inchangé)", async () => {
    mockMediaLibraryFindUnique.mockResolvedValue({
      maxUsageCount: null,
      rotationScope: "per_account",
      rotationMode: "auto",
    });
    mockQueryRaw.mockResolvedValueOnce([]);
    await selectMediaAssetFromFolder("lib-1", "acc-1");
    const params = (mockQueryRaw.mock.calls[0]?.[0] as { values?: unknown[] })?.values ?? [];
    expect(params).toContain("acc-1");
    expect(params).not.toContain(SHARED_USAGE_ACCOUNT_ID);
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
    expect(r.prevMediaUsageStates[0]!.accountId).toBe(SHARED_USAGE_ACCOUNT_ID);
    expect(r.prevMediaUsageStates[0]!.prevLastUsedAt).toBeNull();
  });

  it("liste vide → aucun accès DB", async () => {
    const r = await advanceMediaUsageOnSubmit([], "acc-1");
    expect(r.prevMediaUsageStates).toEqual([]);
    expect(mockMediaAssetFindMany).not.toHaveBeenCalled();
  });

  // Fix #4 (P8 rotation) : accountId devient optionnel côté route (une
  // génération shared sans compte doit quand même claimer). route.ts:493
  // retire désormais `validatedAccountId` de la garde d'appel.
  it("P8 fix #4 — shared SANS accountId : claim quand même sous la sentinelle __shared__", async () => {
    mockMediaAssetFindMany.mockResolvedValue([
      { id: "a1", library: { rotationScope: "shared" } },
    ]);
    mockUsageFindUnique.mockResolvedValue(null);
    const r = await advanceMediaUsageOnSubmit(["a1"], undefined);
    expect(r.prevMediaUsageStates).toHaveLength(1);
    expect(r.prevMediaUsageStates[0]!.accountId).toBe(SHARED_USAGE_ACCOUNT_ID);
    expect(mockUsageUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetId_accountId: { assetId: "a1", accountId: SHARED_USAGE_ACCOUNT_ID } },
      }),
    );
  });

  it("P8 fix #4 — per_account SANS accountId : claim sauté (warn), aucune écriture pour cet asset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockMediaAssetFindMany.mockResolvedValue([
      { id: "a1", library: { rotationScope: "per_account" } },
    ]);
    const r = await advanceMediaUsageOnSubmit(["a1"], undefined);
    expect(r.prevMediaUsageStates).toEqual([]);
    expect(mockUsageUpsert).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("a1"));
    warn.mockRestore();
  });

  it("P8 fix #4 — mix shared + per_account SANS accountId : la lib shared claim, la lib per_account est sautée", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockMediaAssetFindMany.mockResolvedValue([
      { id: "a-shared", library: { rotationScope: "shared" } },
      { id: "a-per-account", library: { rotationScope: "per_account" } },
    ]);
    mockUsageFindUnique.mockResolvedValue(null);
    const r = await advanceMediaUsageOnSubmit(["a-shared", "a-per-account"], undefined);
    expect(r.prevMediaUsageStates).toHaveLength(1);
    expect(r.prevMediaUsageStates[0]!.assetId).toBe("a-shared");
    expect(r.prevMediaUsageStates[0]!.accountId).toBe(SHARED_USAGE_ACCOUNT_ID);
    expect(mockUsageUpsert).toHaveBeenCalledTimes(1);
    warn.mockRestore();
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
