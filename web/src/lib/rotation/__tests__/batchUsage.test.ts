/**
 * Registre d'usage virtuel du tirage en lot — voir `lib/rotation/batchUsage.ts`.
 * Unitaires purs : aucune DB, aucun mock Prisma. Les tests SQL de bout en bout
 * (jointure + CASE + burn-once virtuel branchés dans le résolveur) vivent
 * dans `src/lib/__tests__/contentLibraryResolver.batchUsage.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  batchUsageKey,
  createBatchUsageLedger,
  buildBatchUsageJoin,
  buildEffectiveLastUsedExpr,
  buildEffectiveUnusedExpr,
  buildEffectiveUsageCountExpr,
  buildVirtualBurnFilter,
} from "@/lib/rotation/batchUsage";

describe("batchUsageKey", () => {
  it("compose libraryId|usageKey", () => {
    expect(batchUsageKey("lib-1", "acc-1")).toBe("lib-1|acc-1");
  });

  it("clé d'usage indéfinie → `*`", () => {
    expect(batchUsageKey("lib-1", undefined)).toBe("lib-1|*");
    expect(batchUsageKey("lib-1", null)).toBe("lib-1|*");
  });
});

describe("createBatchUsageLedger — registre en mémoire", () => {
  it("rien d'enregistré → entriesFor renvoie null", () => {
    const ledger = createBatchUsageLedger();
    expect(ledger.entriesFor("lib-1", "acc-1")).toBeNull();
  });

  it("un seul enregistrement → une entrée, n=1", () => {
    const ledger = createBatchUsageLedger();
    ledger.record("lib-1", "acc-1", "asset-a");
    const entries = ledger.entriesFor("lib-1", "acc-1");
    expect(entries).toEqual({ ids: ["asset-a"], seqs: [1], ns: [1] });
  });

  it("le même asset enregistré 2x sous la même clé s'agrège : n=2, seq=dernier rang", () => {
    const ledger = createBatchUsageLedger();
    ledger.record("lib-1", "acc-1", "asset-a");
    ledger.record("lib-1", "acc-1", "asset-b");
    ledger.record("lib-1", "acc-1", "asset-a"); // 2e pick du même asset
    const entries = ledger.entriesFor("lib-1", "acc-1")!;
    const byId = new Map(entries.ids.map((id, i) => [id, { seq: entries.seqs[i], n: entries.ns[i] }]));
    expect(byId.get("asset-a")).toEqual({ seq: 3, n: 2 });
    expect(byId.get("asset-b")).toEqual({ seq: 2, n: 1 });
  });

  it("clés différentes (libraryId ou usageKey) restent isolées", () => {
    const ledger = createBatchUsageLedger();
    ledger.record("lib-1", "acc-1", "asset-a");
    ledger.record("lib-2", "acc-1", "asset-a");
    ledger.record("lib-1", "acc-2", "asset-a");
    expect(ledger.entriesFor("lib-1", "acc-1")).toEqual({ ids: ["asset-a"], seqs: [1], ns: [1] });
    expect(ledger.entriesFor("lib-2", "acc-1")).toEqual({ ids: ["asset-a"], seqs: [2], ns: [1] });
    expect(ledger.entriesFor("lib-1", "acc-2")).toEqual({ ids: ["asset-a"], seqs: [3], ns: [1] });
  });

  it("usageKey null/undefined partagent la même clé `*`", () => {
    const ledger = createBatchUsageLedger();
    ledger.record("lib-1", undefined, "asset-a");
    const entries = ledger.entriesFor("lib-1", null);
    expect(entries).toEqual({ ids: ["asset-a"], seqs: [1], ns: [1] });
  });

  it("le compteur de rang est PARTAGÉ par tout le registre (monotone toutes clés confondues)", () => {
    const ledger = createBatchUsageLedger();
    ledger.record("lib-1", "acc-1", "a"); // seq 1
    ledger.record("lib-2", "acc-2", "b"); // seq 2 (clé différente)
    ledger.record("lib-1", "acc-1", "c"); // seq 3, même clé que la 1re
    expect(ledger.entriesFor("lib-1", "acc-1")!.seqs).toContain(3);
    expect(ledger.entriesFor("lib-2", "acc-2")!.seqs).toEqual([2]);
  });
});

describe("buildBatchUsageJoin", () => {
  it("émet un LEFT JOIN unnest sur 3 tableaux parallèles, alias vu", () => {
    const frag = buildBatchUsageJoin({ ids: ["a", "b"], seqs: [1, 2], ns: [1, 1] }, Prisma.sql`ma.id`);
    expect(frag.sql).toContain("LEFT JOIN unnest(");
    expect(frag.sql).toContain("AS vu(asset_id, seq, n)");
    expect(frag.sql).toContain("vu.asset_id = ma.id");
    expect(frag.values).toEqual([["a", "b"], [1, 2], [1, 1]]);
  });

  it("le join porte sur l'expression d'id donnée (ex. de.id pour DataEntry)", () => {
    const frag = buildBatchUsageJoin({ ids: ["e1"], seqs: [1], ns: [1] }, Prisma.sql`de.id`);
    expect(frag.sql).toContain("vu.asset_id = de.id");
  });
});

describe("buildEffectiveLastUsedExpr", () => {
  it("un pick virtuel trie APRÈS n'importe quelle date réelle (borne 9999)", () => {
    const frag = buildEffectiveLastUsedExpr(Prisma.sql`mau."lastUsedAt"`);
    expect(frag.sql).toContain("CASE WHEN vu.asset_id IS NOT NULL THEN TIMESTAMP '9999-01-01' + vu.seq * INTERVAL '1 millisecond'");
    expect(frag.sql).toContain('ELSE mau."lastUsedAt" END');
  });
});

describe("buildEffectiveUnusedExpr", () => {
  it("« jamais servi » effectif = réel ET aucun pick virtuel", () => {
    const frag = buildEffectiveUnusedExpr(Prisma.sql`mau."lastUsedAt" IS NULL`);
    expect(frag.sql).toBe('(mau."lastUsedAt" IS NULL AND vu.asset_id IS NULL)');
  });
});

describe("buildEffectiveUsageCountExpr", () => {
  it("additionne le compteur réel et les occurrences virtuelles, COALESCE des deux côtés", () => {
    const frag = buildEffectiveUsageCountExpr(Prisma.sql`mau."usageCount"`);
    expect(frag.sql).toBe('(COALESCE(mau."usageCount", 0) + COALESCE(vu.n, 0))');
  });
});

describe("buildVirtualBurnFilter", () => {
  it("maxUsageCount null/absent → Prisma.empty (pas de garde, rotation infinie)", () => {
    expect(buildVirtualBurnFilter(Prisma.sql`ma."usageCount"`, null).sql).toBe("");
    expect(buildVirtualBurnFilter(Prisma.sql`ma."usageCount"`, undefined).sql).toBe("");
  });

  it("maxUsageCount <= 0 → Prisma.empty", () => {
    expect(buildVirtualBurnFilter(Prisma.sql`ma."usageCount"`, 0).sql).toBe("");
    expect(buildVirtualBurnFilter(Prisma.sql`ma."usageCount"`, -1).sql).toBe("");
  });

  it("maxUsageCount posé → un asset sans pick virtuel (vu.n IS NULL) passe toujours", () => {
    const frag = buildVirtualBurnFilter(Prisma.sql`ma."usageCount"`, 2);
    expect(frag.sql).toContain("vu.n IS NULL OR");
  });

  it("maxUsageCount posé → réel + virtuel doit rester strictement sous le plafond", () => {
    const frag = buildVirtualBurnFilter(Prisma.sql`ma."usageCount"`, 2);
    expect(frag.sql).toContain('ma."usageCount" + vu.n <');
    expect(frag.values).toContain(2);
  });
});
