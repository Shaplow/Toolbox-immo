/**
 * P5 hardening — helpers purs de `GET /api/libraries/[libraryId]/assets`
 * (picker « Changer »). Voir `libraryAssetsQuery.ts` pour le mirroring avec
 * `contentLibraryResolver.ts` (buildAccessFilter/buildBurnFilter/buildTagFragment).
 */
import { describe, it, expect } from "vitest";
import {
  buildAssetsAccessWhere,
  buildAssetsBurnWhere,
  buildTagRulesWhere,
  parseTagRuleParams,
  resolveBurnAccountId,
  resolveUsageKey,
  resolveTagConditionsForForm,
  serializeTagRuleParams,
} from "@/lib/generate/libraryAssetsQuery";
import { SHARED_USAGE_ACCOUNT_ID } from "@/lib/rotation/sentinels";

describe("buildAssetsAccessWhere (A.2)", () => {
  it("reste strict (accesses:none) quand aucun accountId n'est fourni — fail-closed, revert post revue de sécurité", () => {
    expect(buildAssetsAccessWhere(null)).toEqual({ accesses: { none: {} } });
  });

  it("filtre public OU accessible à ce compte quand un accountId est fourni", () => {
    expect(buildAssetsAccessWhere("acc-1")).toEqual({
      OR: [{ accesses: { none: {} } }, { accesses: { some: { accountId: "acc-1" } } }],
    });
  });
});

describe("resolveBurnAccountId (A.3)", () => {
  it("retourne undefined (compteur global) pour une lib shared, même avec un accountId connu", () => {
    expect(resolveBurnAccountId("shared", "acc-1")).toBeUndefined();
  });

  it("retourne le compte réel pour une lib per_account", () => {
    expect(resolveBurnAccountId("per_account", "acc-1")).toBe("acc-1");
  });

  it("retourne undefined pour une lib per_account sans accountId connu", () => {
    expect(resolveBurnAccountId("per_account", null)).toBeUndefined();
  });
});

describe("buildAssetsBurnWhere (A.3)", () => {
  it("ne filtre rien quand maxUsageCount est null", () => {
    expect(buildAssetsBurnWhere(null, "acc-1")).toEqual({});
  });

  it("ne filtre rien quand maxUsageCount est <= 0", () => {
    expect(buildAssetsBurnWhere(0, "acc-1")).toEqual({});
  });

  it("exclut les assets dont l'usage par compte a atteint maxUsageCount", () => {
    expect(buildAssetsBurnWhere(3, "acc-1")).toEqual({
      NOT: { usages: { some: { accountId: "acc-1", usageCount: { gte: 3 } } } },
    });
  });

  it("bascule sur le compteur global quand burnAccountId est absent (scope shared ou pas de compte)", () => {
    expect(buildAssetsBurnWhere(3, undefined)).toEqual({ usageCount: { lt: 3 } });
  });
});

describe("resolveUsageKey (A.7)", () => {
  it("retourne null sans accountId (pas de jointure, compteurs globaux)", () => {
    expect(resolveUsageKey("per_account", null)).toBeNull();
  });

  it("retourne la sentinelle __shared__ pour une lib shared", () => {
    expect(resolveUsageKey("shared", "acc-1")).toBe(SHARED_USAGE_ACCOUNT_ID);
  });

  it("retourne le compte réel pour une lib per_account", () => {
    expect(resolveUsageKey("per_account", "acc-1")).toBe("acc-1");
  });

  it("retourne le compte réel quand rotationScope est absent (défaut per_account)", () => {
    expect(resolveUsageKey(null, "acc-1")).toBe("acc-1");
  });
});

describe("resolveTagConditionsForForm (A.4)", () => {
  it("laisse passer une condition littérale telle quelle", () => {
    expect(resolveTagConditionsForForm([{ tag: "RPI" }], {})).toEqual([{ tag: "RPI", negate: undefined }]);
  });

  it("résout une condition fromParam contre les valeurs du formulaire", () => {
    const conditions = [{ tag: "agent", fromParam: true }];
    expect(resolveTagConditionsForForm(conditions, { agent: "lola" })).toEqual([
      { tag: "lola", negate: undefined },
    ]);
  });

  it("ignore silencieusement une condition fromParam dont le champ source est vide", () => {
    const conditions = [{ tag: "agent", fromParam: true }, { tag: "RPI" }];
    expect(resolveTagConditionsForForm(conditions, { agent: "" })).toEqual([{ tag: "RPI", negate: undefined }]);
  });

  it("préserve negate", () => {
    expect(resolveTagConditionsForForm([{ tag: "brouillon", negate: true }], {})).toEqual([
      { tag: "brouillon", negate: true },
    ]);
  });

  it("retourne un tableau vide sans conditions", () => {
    expect(resolveTagConditionsForForm(undefined, {})).toEqual([]);
  });
});

describe("serializeTagRuleParams / parseTagRuleParams (A.4, round-trip)", () => {
  it("ne sérialise rien quand ni tagConditions ni tagFilter ne sont présents", () => {
    expect(serializeTagRuleParams({})).toBeUndefined();
  });

  it("sérialise puis désérialise des tagConditions avec operator", () => {
    const raw = serializeTagRuleParams({
      tagConditions: [{ tag: "rpi" }, { tag: "brouillon", negate: true }],
      tagConditionsOperator: "OR",
    });
    expect(raw).toBeTypeOf("string");
    expect(parseTagRuleParams(raw)).toEqual({
      tagConditions: [{ tag: "rpi" }, { tag: "brouillon", negate: true }],
      tagConditionsOperator: "OR",
    });
  });

  it("défaut operator à AND quand omis", () => {
    const raw = serializeTagRuleParams({ tagConditions: [{ tag: "rpi" }] });
    expect(parseTagRuleParams(raw)?.tagConditionsOperator).toBe("AND");
  });

  it("sérialise un tagFilter littéral seul", () => {
    const raw = serializeTagRuleParams({ tagFilter: "RTIPS" });
    expect(parseTagRuleParams(raw)).toEqual({ tagFilter: "RTIPS" });
  });

  it("parseTagRuleParams est tolérant au JSON invalide", () => {
    expect(parseTagRuleParams("{not json")).toBeUndefined();
  });

  it("parseTagRuleParams retourne undefined pour null/absent", () => {
    expect(parseTagRuleParams(null)).toBeUndefined();
    expect(parseTagRuleParams(undefined)).toBeUndefined();
  });
});

describe("buildTagRulesWhere (A.4, précédence)", () => {
  it("repose sur le tag legacy quand aucune règle avancée n'est fournie", () => {
    expect(buildTagRulesWhere("rpi", undefined)).toEqual({
      tags: { contains: '"rpi"', mode: "insensitive" },
    });
  });

  it("retourne un where vide sans tag ni règles", () => {
    expect(buildTagRulesWhere("", undefined)).toEqual({});
  });

  it("le tagFilter littéral prime sur le tag legacy", () => {
    expect(buildTagRulesWhere("rpi-legacy", { tagFilter: "rpi-literal" })).toEqual({
      tags: { contains: '"rpi-literal"', mode: "insensitive" },
    });
  });

  it("tagConditions prime sur tagFilter littéral ET sur le tag legacy", () => {
    const result = buildTagRulesWhere("rpi-legacy", {
      tagFilter: "rpi-literal",
      tagConditions: [{ tag: "rpi" }],
    });
    expect(result).toEqual({ AND: [{ tags: { contains: '"rpi"', mode: "insensitive" } }] });
  });

  it("combine plusieurs tagConditions en AND par défaut", () => {
    const result = buildTagRulesWhere("", {
      tagConditions: [{ tag: "rpi" }, { tag: "brouillon", negate: true }],
    });
    expect(result).toEqual({
      AND: [
        { tags: { contains: '"rpi"', mode: "insensitive" } },
        { NOT: { tags: { contains: '"brouillon"', mode: "insensitive" } } },
      ],
    });
  });

  it("combine en OR quand tagConditionsOperator === 'OR'", () => {
    const result = buildTagRulesWhere("", {
      tagConditions: [{ tag: "rpi" }, { tag: "rtips" }],
      tagConditionsOperator: "OR",
    });
    expect(result).toEqual({
      OR: [
        { tags: { contains: '"rpi"', mode: "insensitive" } },
        { tags: { contains: '"rtips"', mode: "insensitive" } },
      ],
    });
  });
});
