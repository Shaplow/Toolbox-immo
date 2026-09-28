/**
 * Tirage en lot — branchements batch dans le résolveur (plan « lancer les
 * rendus depuis le calendrier », étape 3, `lib/rotation/batchUsage.ts`).
 *
 * Même technique de mock que `folderDraw.media.test.ts` / `folderDraw.data.test.ts`
 * (Prisma mocké au niveau module, SQL inspecté via `.strings`/`.values` du
 * fragment `Prisma.Sql`). Contrat central vérifié ici :
 *   1. sans `opts.batchUsage`, le SQL émis par `selectMediaAsset`,
 *      `selectMediaAssetFromFolder` et `selectDataEntry` est identique à
 *      celui d'avant ce paramètre (aucune trace d'`unnest`/`vu.`) ;
 *   2. une vue posée mais SANS entrée pour la clé (`entriesFor` → null)
 *      retombe sur le même SQL — seule une entrée non-null change le texte ;
 *   3. avec une entrée, la jointure `unnest`, le tri effectif et la garde
 *      burn-once virtuelle apparaissent, avec les bons paramètres ;
 *   4. `resolveLibraryPrefill` propage la vue à ses appels et construit
 *      `usageKeyByPick`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQueryRaw = vi.fn();
const mockMediaLibraryFindUnique = vi.fn();
const mockMediaLibraryFindMany = vi.fn();
const mockMediaAssetFindMany = vi.fn();
const mockDataLibraryFindUnique = vi.fn();
const mockInstagramAccountFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    mediaLibrary: {
      findUnique: (...args: unknown[]) => mockMediaLibraryFindUnique(...args),
      findMany: (...args: unknown[]) => mockMediaLibraryFindMany(...args),
    },
    mediaAsset: { findMany: (...args: unknown[]) => mockMediaAssetFindMany(...args) },
    dataLibrary: { findUnique: (...args: unknown[]) => mockDataLibraryFindUnique(...args) },
    instagramAccount: { findMany: (...args: unknown[]) => mockInstagramAccountFindMany(...args) },
  },
}));

import {
  selectMediaAsset,
  selectMediaAssetFromFolder,
  selectDataEntry,
  resolveLibraryPrefill,
} from "@/lib/contentLibraryResolver";
import { createBatchUsageLedger, type BatchUsageView } from "@/lib/rotation/batchUsage";
import type { TemplateJSON } from "@/types/template";

function sqlTextOfCall(callIndex: number): string {
  const arg = mockQueryRaw.mock.calls[callIndex]?.[0] as { strings?: string[] } | undefined;
  return (arg?.strings ?? []).join(" ");
}
function paramsOfCall(callIndex: number): unknown[] {
  const arg = mockQueryRaw.mock.calls[callIndex]?.[0] as { values?: unknown[] } | undefined;
  return arg?.values ?? [];
}
function makeAssetRow(id: string) {
  return { id, url: `https://r2.test/${id}.mp4`, filename: `${id}.mp4`, metadata: "{}" };
}

/** Vue qui répond toujours `null` — équivaut à ne rien enregistrer. */
const EMPTY_VIEW: BatchUsageView = { entriesFor: () => null };

beforeEach(() => {
  vi.clearAllMocks();
  mockMediaLibraryFindUnique.mockResolvedValue({
    maxUsageCount: null,
    rotationScope: "per_account",
    rotationMode: "auto",
  });
});

describe("selectMediaAsset — SQL identique sans entrée batch", () => {
  it("sans opts → aucune trace de vu./unnest (least_used, per_account)", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);
    await selectMediaAsset("lib-1", "least_used", undefined, "acc-1");
    const sql = sqlTextOfCall(0);
    expect(sql).not.toContain("unnest");
    expect(sql).not.toContain("vu.");
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it("avec opts.batchUsage mais entriesFor → null (rien enregistré) → même SQL, un seul appel", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);
    await selectMediaAsset("lib-1", "least_used", undefined, "acc-1", undefined, undefined, undefined, "library", { batchUsage: EMPTY_VIEW });
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(sqlTextOfCall(0)).not.toContain("unnest");
  });

  it("least_used avec entrée → jointure unnest + tri effectif + burn virtuel", async () => {
    const ledger = createBatchUsageLedger();
    ledger.record("lib-1", "acc-1", "asset-x");
    mockMediaLibraryFindUnique.mockResolvedValue({ maxUsageCount: 3, rotationScope: "per_account", rotationMode: "auto" });
    mockQueryRaw.mockResolvedValueOnce([makeAssetRow("asset-y")]);
    const r = await selectMediaAsset("lib-1", "least_used", undefined, "acc-1", undefined, undefined, undefined, "library", { batchUsage: ledger });
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    const sql = sqlTextOfCall(0);
    expect(sql).toContain("LEFT JOIN unnest(");
    expect(sql).toContain("AS vu(asset_id, seq, n) ON vu.asset_id = ma.id");
    expect(sql).toContain("CASE WHEN vu.asset_id IS NOT NULL THEN TIMESTAMP '9999-01-01'");
    expect(sql).toContain("COALESCE(vu.n, 0)");
    expect(sql).toContain("vu.n IS NULL OR");
    expect(paramsOfCall(0)).toContain(3); // maxUsageCount injecté dans le burn virtuel
    expect(r?.usageKey).toBe("acc-1");
  });

  it("random avec entrée → NOT IN sur les ids du lot, repli sans exclusion si vide", async () => {
    const ledger = createBatchUsageLedger();
    ledger.record("lib-1", "acc-1", "asset-x");
    mockQueryRaw
      .mockResolvedValueOnce([]) // 1re tentative (avec exclusion batch) : vide
      .mockResolvedValueOnce([makeAssetRow("asset-x")]); // repli sans l'exclusion batch
    const r = await selectMediaAsset("lib-1", "random", undefined, "acc-1", undefined, undefined, undefined, "library", { batchUsage: ledger });
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    expect(sqlTextOfCall(0)).toContain("ma.id NOT IN");
    expect(sqlTextOfCall(1)).not.toContain("NOT IN");
    expect(r?.id).toBe("asset-x");
  });

  it("random avec entrée → une ligne trouvée dès la 1re tentative n'appelle pas le repli", async () => {
    const ledger = createBatchUsageLedger();
    ledger.record("lib-1", "acc-1", "asset-x");
    mockQueryRaw.mockResolvedValueOnce([makeAssetRow("asset-z")]);
    const r = await selectMediaAsset("lib-1", "random", undefined, "acc-1", undefined, undefined, undefined, "library", { batchUsage: ledger });
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(r?.id).toBe("asset-z");
  });

  it("oldest_used avec entrée → même CASE effectif que least_used", async () => {
    const ledger = createBatchUsageLedger();
    ledger.record("lib-1", "acc-1", "asset-x");
    mockQueryRaw.mockResolvedValueOnce([makeAssetRow("asset-y")]);
    await selectMediaAsset("lib-1", "oldest_used", undefined, "acc-1", undefined, undefined, undefined, "library", { batchUsage: ledger });
    expect(sqlTextOfCall(0)).toContain("CASE WHEN vu.asset_id IS NOT NULL THEN TIMESTAMP '9999-01-01'");
  });

  it("scope shared : la clé batch est la sentinelle __shared__, pas le compte réel", async () => {
    mockMediaLibraryFindUnique.mockResolvedValue({ maxUsageCount: null, rotationScope: "shared", rotationMode: "auto" });
    const ledger = createBatchUsageLedger();
    ledger.record("lib-1", "__shared__", "asset-x");
    mockQueryRaw.mockResolvedValueOnce([makeAssetRow("asset-y")]);
    const r = await selectMediaAsset("lib-1", "least_used", undefined, "acc-1", undefined, undefined, undefined, "library", { batchUsage: ledger });
    expect(sqlTextOfCall(0)).toContain("unnest");
    expect(r?.usageKey).toBe("__shared__");
  });

  it("random : maxUsageCount=1, pool de 2 déjà servis par le lot → le repli garde la garde virtuelle, jamais de dépassement", async () => {
    // fix random-fallback-no-virtual-burn / random-fallback-bypasses-virtual-burn :
    // pool de 2 assets (A, B), maxUsageCount=1, 3e ligne du lot. Le NOT IN vide
    // le pool (A et B déjà retenus), le repli doit alors garder la jointure
    // batch + le burn-once VIRTUEL (real usageCount reste à 0 jusqu'au DONE) —
    // jamais reservir A ou B une 2e fois.
    mockMediaLibraryFindUnique.mockResolvedValue({ maxUsageCount: 1, rotationScope: "per_account", rotationMode: "auto" });
    const ledger = createBatchUsageLedger();
    ledger.record("lib-1", "acc-1", "asset-a");
    ledger.record("lib-1", "acc-1", "asset-b");
    mockQueryRaw
      .mockResolvedValueOnce([]) // 1re tentative (NOT IN sur A,B) : pool épuisé
      .mockResolvedValueOnce([]); // repli SOUS garde virtuelle : rien non plus (real+virtuel >= max pour A et B)
    const r = await selectMediaAsset("lib-1", "random", undefined, "acc-1", undefined, undefined, undefined, "library", { batchUsage: ledger });
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    expect(sqlTextOfCall(0)).toContain("ma.id NOT IN");
    const fallbackSql = sqlTextOfCall(1);
    expect(fallbackSql).not.toContain("NOT IN");
    expect(fallbackSql).toContain("LEFT JOIN unnest(");
    expect(fallbackSql).toContain("vu.n IS NULL OR");
    expect(paramsOfCall(1)).toContain(1); // maxUsageCount injecté dans le burn virtuel
    expect(r).toBeNull(); // jamais un dépassement silencieux du plafond réel+virtuel
  });

  it("usageKey renvoyé même SANS vue (utile à resolveLibraryPrefill)", async () => {
    mockQueryRaw.mockResolvedValueOnce([makeAssetRow("asset-y")]);
    const r = await selectMediaAsset("lib-1", "least_used", undefined, "acc-1");
    expect(r?.usageKey).toBe("acc-1");
  });
});

describe("selectMediaAssetFromFolder — SQL identique sans entrée batch", () => {
  it("sans opts → aucune trace de vu./unnest", async () => {
    mockQueryRaw.mockResolvedValueOnce([{ setTag: "A" }]).mockResolvedValueOnce([{ id: "a1", url: "u", filename: "f" }]);
    await selectMediaAssetFromFolder("lib-1", "acc-1");
    expect(sqlTextOfCall(0)).not.toContain("unnest");
    expect(sqlTextOfCall(1)).not.toContain("unnest");
  });

  it("vue posée mais entriesFor → null → même SQL", async () => {
    mockQueryRaw.mockResolvedValueOnce([{ setTag: "A" }]).mockResolvedValueOnce([{ id: "a1", url: "u", filename: "f" }]);
    await selectMediaAssetFromFolder("lib-1", "acc-1", undefined, undefined, undefined, undefined, undefined, { batchUsage: EMPTY_VIEW });
    expect(sqlTextOfCall(0)).not.toContain("unnest");
    expect(sqlTextOfCall(1)).not.toContain("unnest");
  });

  it("découverte + pioche avec entrée → jointure batch dans les DEUX requêtes, has_unused effectif", async () => {
    const ledger = createBatchUsageLedger();
    ledger.record("lib-1", "acc-1", "asset-in-folder-A");
    mockQueryRaw
      .mockResolvedValueOnce([{ setTag: "A" }])
      .mockResolvedValueOnce([{ id: "a-fresh", url: "u", filename: "f" }]);
    const r = await selectMediaAssetFromFolder("lib-1", "acc-1", undefined, undefined, undefined, undefined, undefined, { batchUsage: ledger });
    expect(sqlTextOfCall(0)).toContain("unnest");
    expect(sqlTextOfCall(0)).toContain('AND vu.asset_id IS NULL)) > 0 AS has_unused');
    expect(sqlTextOfCall(1)).toContain("unnest");
    expect(r?.usageKey).toBe("acc-1");
  });

  it("dossier épinglé avec entrée → jointure batch dans la pioche, une seule requête", async () => {
    const ledger = createBatchUsageLedger();
    ledger.record("lib-1", "acc-1", "asset-x");
    mockQueryRaw.mockResolvedValueOnce([{ id: "a1", url: "u", filename: "f" }]);
    const r = await selectMediaAssetFromFolder("lib-1", "acc-1", undefined, "tournage-03", undefined, undefined, undefined, { batchUsage: ledger });
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(sqlTextOfCall(0)).toContain("unnest");
    expect(r?.resolvedSetTag).toBe("tournage-03");
  });

  it("burn-once virtuel : le paramètre maxUsageCount apparaît quand il est posé", async () => {
    mockMediaLibraryFindUnique.mockResolvedValue({ maxUsageCount: 2, rotationScope: "per_account", rotationMode: "auto" });
    const ledger = createBatchUsageLedger();
    ledger.record("lib-1", "acc-1", "asset-x");
    mockQueryRaw.mockResolvedValueOnce([{ id: "a1", url: "u", filename: "f" }]);
    await selectMediaAssetFromFolder("lib-1", "acc-1", undefined, "tournage-03", undefined, undefined, undefined, { batchUsage: ledger });
    expect(sqlTextOfCall(0)).toContain("vu.n IS NULL OR");
    expect(paramsOfCall(0)).toContain(2);
  });
});

describe("selectDataEntry — SQL identique sans entrée batch", () => {
  beforeEach(() => {
    mockDataLibraryFindUnique.mockResolvedValue({ rotationMode: "auto", rotationScope: "per_account", maxUsageCount: null });
  });

  it("sans options.batchUsage → aucune trace de vu./unnest", async () => {
    mockQueryRaw.mockResolvedValueOnce([{ setTag: "A" }]).mockResolvedValueOnce([{ id: "e1", fields: "{}" }]);
    await selectDataEntry("lib-1", undefined, "acc-1");
    expect(sqlTextOfCall(0)).not.toContain("unnest");
    expect(sqlTextOfCall(1)).not.toContain("unnest");
  });

  it("options.batchUsage avec entriesFor → null → même SQL", async () => {
    mockQueryRaw.mockResolvedValueOnce([{ setTag: "A" }]).mockResolvedValueOnce([{ id: "e1", fields: "{}" }]);
    await selectDataEntry("lib-1", undefined, "acc-1", { batchUsage: EMPTY_VIEW });
    expect(sqlTextOfCall(0)).not.toContain("unnest");
  });

  it("découverte + pioche avec entrée → jointure batch, usageKey renvoyé", async () => {
    const ledger = createBatchUsageLedger();
    ledger.record("lib-1", "acc-1", "e-already-picked");
    mockQueryRaw
      .mockResolvedValueOnce([{ setTag: "quartiers" }])
      .mockResolvedValueOnce([{ id: "e-fresh", fields: '{"quartier":"Marais"}' }]);
    const r = await selectDataEntry("lib-1", undefined, "acc-1", { batchUsage: ledger });
    expect(sqlTextOfCall(0)).toContain("unnest");
    expect(sqlTextOfCall(1)).toContain("unnest");
    expect(r).toEqual({ entryId: "e-fresh", fields: { quartier: "Marais" }, resolvedSetTag: "quartiers", usageKey: "acc-1" });
  });

  it("dossier épinglé avec entrée → jointure batch, pas de repli inter-dossiers", async () => {
    const ledger = createBatchUsageLedger();
    ledger.record("lib-1", "acc-1", "e-x");
    mockQueryRaw.mockResolvedValueOnce([{ id: "e-pin", fields: "{}" }]);
    const r = await selectDataEntry("lib-1", undefined, "acc-1", { pinnedSetTag: "RTEXT12", batchUsage: ledger });
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(sqlTextOfCall(0)).toContain("unnest");
    expect(r?.resolvedSetTag).toBe("RTEXT12");
  });

  it("scope shared : burn-once virtuel utilise le compteur global de.usageCount, pas une clé de compte", async () => {
    mockDataLibraryFindUnique.mockResolvedValue({ rotationMode: "auto", rotationScope: "shared", maxUsageCount: 2 });
    const ledger = createBatchUsageLedger();
    ledger.record("lib-1", "__shared__data__", "e-x");
    mockQueryRaw.mockResolvedValueOnce([{ id: "e1", fields: "{}" }]);
    await selectDataEntry("lib-1", undefined, "acc-1", { pinnedSetTag: "RTEXT12", batchUsage: ledger });
    const sql = sqlTextOfCall(0);
    expect(sql).toContain("vu.n IS NULL OR");
    expect(sql).toContain('de."usageCount" + vu.n <');
  });
});

describe("resolveLibraryPrefill — transmission de la vue + usageKeyByPick", () => {
  function makeTemplate(): TemplateJSON {
    return {
      canvas: {} as TemplateJSON["canvas"],
      theme: {} as TemplateJSON["theme"],
      blocks: [
        {
          id: "block-video-1",
          type: "video",
          binding: "clip",
          libraryId: "lib-video",
          selectionRule: "least_used",
        },
        {
          id: "block-music-1",
          type: "music",
          binding: "song",
          libraryId: "lib-audio",
          audioSelectionRule: "least_used",
        },
      ],
      groups: [],
      formSections: [],
      schema: [],
      contentLibrary: { dataLibraryId: "lib-data" },
    } as unknown as TemplateJSON;
  }

  beforeEach(() => {
    mockMediaLibraryFindMany.mockResolvedValue([{ id: "lib-video", rotationScope: "per_account" }]);
    mockMediaAssetFindMany.mockResolvedValue([]);
    mockDataLibraryFindUnique.mockResolvedValue({ rotationMode: "auto", rotationScope: "per_account", maxUsageCount: null });
    mockInstagramAccountFindMany.mockResolvedValue([]);
  });

  it("sans opts.batchUsage → usageKeyByPick posé (compte réel), aucune trace d'unnest", async () => {
    // video (regular, least_used) puis audio (least_used) puis data (découverte + pioche).
    mockQueryRaw
      .mockResolvedValueOnce([makeAssetRow("v1")]) // video
      .mockResolvedValueOnce([makeAssetRow("a1")]) // audio
      .mockResolvedValueOnce([{ setTag: null }]) // data discovery
      .mockResolvedValueOnce([{ id: "e1", fields: "{}" }]); // data pick
    // audioLibraryExists guard (mediaLibrary.findUnique par id) + les 2 selectMediaAsset
    // internes (video + audio) demandent chacun mediaLibrary.findUnique — un seul mock
    // couvre tous les appels puisqu'aucun test ici ne varie le scope.
    mockMediaLibraryFindUnique.mockResolvedValue({ id: "lib-audio", maxUsageCount: null, rotationScope: "per_account", rotationMode: "auto" });

    const prefill = await resolveLibraryPrefill(makeTemplate(), undefined, "acc-1");

    expect(prefill.usageKeyByPick?.["video:block-video-1"]).toEqual({ libraryId: "lib-video", usageKey: "acc-1" });
    expect(prefill.usageKeyByPick?.audio).toEqual({ libraryId: "lib-audio", usageKey: "acc-1" });
    expect(prefill.usageKeyByPick?.data).toEqual({ libraryId: "lib-data", usageKey: "acc-1" });
    for (let i = 0; i < mockQueryRaw.mock.calls.length; i++) {
      expect(sqlTextOfCall(i)).not.toContain("unnest");
    }
  });

  it("avec opts.batchUsage et une entrée pour la lib vidéo → la requête vidéo porte la jointure batch", async () => {
    const ledger = createBatchUsageLedger();
    ledger.record("lib-video", "acc-1", "v-already-picked");
    mockMediaLibraryFindUnique.mockResolvedValue({ id: "lib-audio", maxUsageCount: null, rotationScope: "per_account", rotationMode: "auto" });
    mockQueryRaw
      .mockResolvedValueOnce([makeAssetRow("v2")]) // video (batch-aware)
      .mockResolvedValueOnce([makeAssetRow("a1")]) // audio (pas d'entrée pour lib-audio)
      .mockResolvedValueOnce([{ setTag: null }]) // data discovery
      .mockResolvedValueOnce([{ id: "e1", fields: "{}" }]); // data pick

    await resolveLibraryPrefill(makeTemplate(), undefined, "acc-1", { batchUsage: ledger });

    expect(sqlTextOfCall(0)).toContain("unnest"); // video : entrée présente
    expect(sqlTextOfCall(1)).not.toContain("unnest"); // audio : rien enregistré sous lib-audio
  });
});
