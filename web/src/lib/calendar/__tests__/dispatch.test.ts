/**
 * Tests du classement des recettes — le cœur du tourniquet.
 *
 * Le bug d'origine, mot pour mot : « j'essaie de dispatcher correctement les
 * reels entre tous les comptes pour pas qu'on se retrouve avec 2× le même reel
 * posté trop rapidement ». Observé en vrai : la même recette lundi sur un
 * compte et mardi sur un autre, alors que les comptes partagent l'audience.
 *
 * Ce qui compte ici, ce n'est pas « est-ce que ça classe » mais QUOI ça refuse
 * de proposer, et dans quel ordre les ex æquo sont départagés.
 *
 * Ces cas passaient auparavant par `dispatchRecipes`, qui servait une grille
 * entière pour « Remplir la semaine ». L'écran est parti, le classement reste :
 * ils appellent désormais `rankCandidatesForCell` directement, ce qui les rend
 * d'ailleurs plus lisibles — c'était toujours lui qu'ils testaient.
 */

import { describe, it, expect } from "vitest";
import {
  dayIndexFromKey,
  rankCandidatesForCell,
  type DispatchCandidate,
  type DispatchCell,
  type RecipeHistory,
} from "@/lib/calendar/dispatch";

/** Lundi 5 octobre 2026. */
const LUN = "2026-10-05";
const MAR = "2026-10-06";
const MER = "2026-10-07";

function recipe(id: string, createdAt = 0): DispatchCandidate {
  return {
    patternTemplateId: id,
    patternBindingId: `b-${id}`,
    publishTime: "09:00",
    label: id.toUpperCase(),
    templateCreatedAt: createdAt,
  };
}

function cell(accountId: string, dayKey: string, rank = 0): DispatchCell {
  return { accountId, dayKey, rank };
}

/** Historique : { recette: { compte: [jours] } }, jours donnés en clés civiles. */
function history(spec: Record<string, Record<string, string[]>>): Record<string, RecipeHistory> {
  const out: Record<string, RecipeHistory> = {};
  for (const [templateId, byAccount] of Object.entries(spec)) {
    const entry: RecipeHistory = { allDays: [], byAccount: {} };
    for (const [accountId, dayKeys] of Object.entries(byAccount)) {
      const days = dayKeys.map(dayIndexFromKey);
      entry.byAccount[accountId] = days;
      entry.allDays.push(...days);
    }
    out[templateId] = entry;
  }
  return out;
}

describe("ce qui n'est pas proposable", () => {
  it("une recette déjà posée le jour visé est exclue, pas seulement mal classée", () => {
    // Proposer deux fois le même reel le même jour sur deux comptes qui
    // partagent l'audience est précisément ce qu'on corrige.
    const pool = [recipe("sortie_aujourdhui"), recipe("dispo")];
    const ranked = rankCandidatesForCell(
      cell("a1", LUN),
      pool,
      history({ sortie_aujourdhui: { a9: [LUN] } }),
    );

    expect(ranked.map((r) => r.candidate.patternTemplateId)).toEqual(["dispo"]);
  });

  it("le pool entier sorti ce jour-là ne renvoie rien", () => {
    const pool = [recipe("r1"), recipe("r2")];
    const ranked = rankCandidatesForCell(
      cell("a1", LUN),
      pool,
      history({ r1: { a9: [LUN] }, r2: { a1: [LUN] } }),
    );

    expect(ranked).toEqual([]);
  });

  /**
   * LE test du bug réel. La recette la plus ancienne est déjà programmée
   * MARDI : la proposer lundi reproduirait exactement « lundi sur un compte,
   * mardi sur un autre ». Un LRU qui ne regarde que le passé la choisirait.
   */
  it("ne propose pas lundi une recette déjà programmée mardi, même si c'est la plus ancienne", () => {
    const pool = [recipe("vieille"), recipe("recente")];
    const ranked = rankCandidatesForCell(
      cell("a1", LUN),
      pool,
      history({
        // Servie il y a 3 mois… mais déjà reprogrammée mardi sur un autre compte.
        vieille: { a9: ["2026-07-01", MAR] },
        recente: { a9: ["2026-10-01"] },
      }),
    );

    expect(ranked[0].candidate.patternTemplateId).toBe("recente");
  });
});

describe("les départages", () => {
  /**
   * Sur un pool neuf, TOUTES les recettes sont à distance infinie. Sans le
   * départage par date de création, l'ordre serait celui des cuid — c'est-à-dire
   * aléatoire, et « RAUTO 1, RAUTO 10, RAUTO 11 » plutôt que 1, 2, 3.
   */
  it("des recettes jamais servies sortent par date de création, pas par id", () => {
    const pool = [recipe("zzz", 100), recipe("aaa", 300), recipe("mmm", 200)];
    const ranked = rankCandidatesForCell(cell("a1", LUN), pool, {});
    expect(ranked.map((r) => r.candidate.patternTemplateId)).toEqual(["zzz", "mmm", "aaa"]);
  });

  it("à distance égale, la recette la plus isolée de l'autre côté gagne", () => {
    const pool = [recipe("serree"), recipe("isolee")];
    const ranked = rankCandidatesForCell(
      cell("a1", MER), // 2026-10-07
      pool,
      history({
        // Les deux sont à 2 jours. « serree » a une seconde occurrence proche.
        serree: { a9: ["2026-10-05", "2026-10-09"] },
        isolee: { a9: ["2026-10-05"] },
      }),
    );
    expect(ranked[0].candidate.patternTemplateId).toBe("isolee");
  });

  it("à égalité par ailleurs, la recette la moins servie gagne", () => {
    const pool = [recipe("beaucoup"), recipe("peu")];
    const ranked = rankCandidatesForCell(
      cell("a1", "2026-12-01"),
      pool,
      history({
        beaucoup: { a9: ["2026-10-01", "2026-10-02", "2026-10-03"] },
        peu: { a9: ["2026-10-01"] },
      }),
    );
    expect(ranked[0].candidate.patternTemplateId).toBe("peu");
  });

  it("le même écart global départagé par le compte de la case", () => {
    const pool = [recipe("vue_ici"), recipe("vue_ailleurs")];
    const ranked = rankCandidatesForCell(
      cell("a1", MER),
      pool,
      history({
        // Même distance globale (2 j), mais l'une a été vue sur a1.
        vue_ici: { a1: [LUN] },
        vue_ailleurs: { a9: [LUN] },
      }),
    );
    expect(ranked[0].candidate.patternTemplateId).toBe("vue_ailleurs");
  });
});

describe("la distance rendue", () => {
  it("une recette jamais servie dans la fenêtre n'a pas de distance", () => {
    const ranked = rankCandidatesForCell(cell("a1", LUN), [recipe("r1")], {});
    expect(ranked[0].rawGap).toBeNull();
  });

  it("sinon, c'est le nombre de jours jusqu'à l'occurrence la plus proche", () => {
    const ranked = rankCandidatesForCell(
      cell("a1", MER),
      [recipe("r1")],
      history({ r1: { a9: [LUN] } }),
    );
    expect(ranked[0].rawGap).toBe(2);
  });

  it("l'historique de l'appelant n'est jamais muté", () => {
    const existingUse = history({ r1: { a9: ["2026-10-01"] } });
    const avant = JSON.stringify(existingUse);
    rankCandidatesForCell(cell("a1", LUN), [recipe("r1")], existingUse);
    expect(JSON.stringify(existingUse)).toBe(avant);
  });
});

describe("le jour civil", () => {
  /**
   * Le jour civil est PARIS : un index de jour dérivé de la clé, jamais des
   * millisecondes. Sinon le passage à l'heure d'été décale les distances.
   */
  it("les jours autour du changement d'heure restent consécutifs", () => {
    // 29 mars 2026 : passage à l'heure d'été en France.
    expect(dayIndexFromKey("2026-03-29") - dayIndexFromKey("2026-03-28")).toBe(1);
    expect(dayIndexFromKey("2026-03-30") - dayIndexFromKey("2026-03-29")).toBe(1);
  });

  it("une clé de jour illisible ne fait pas planter le tri", () => {
    expect(Number.isNaN(dayIndexFromKey("pas-une-date"))).toBe(true);
  });
});
