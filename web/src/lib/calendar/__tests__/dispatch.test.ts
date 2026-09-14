/**
 * Tests dispatchRecipes — la répartition des reels auto entre les comptes.
 *
 * Le bug d'origine, mot pour mot : « j'essaie de dispatcher correctement les
 * reels entre tous les comptes pour pas qu'on se retrouve avec 2× le même reel
 * posté trop rapidement ». Observé en vrai : la même recette lundi sur un
 * compte et mardi sur un autre, alors que les comptes partagent l'audience.
 *
 * Ce qui compte ici, ce n'est pas « est-ce que ça attribue » mais QUOI ça
 * refuse d'attribuer, et dans quel ORDRE les cases sont servies — c'est là que
 * la première version était fausse.
 */

import { describe, it, expect } from "vitest";
import {
  busiestDayCapacity,
  cellKey,
  dayIndexFromKey,
  dispatchRecipes,
  minimumAchievableGap,
  orderCells,
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

/** `{ "compte|jour|rang": "recette" }` — lecture compacte d'un résultat. */
function asMap(result: ReturnType<typeof dispatchRecipes>) {
  return Object.fromEntries(
    result.assignments.map((a) => [cellKey(a.cell), a.candidate.patternTemplateId]),
  );
}

describe("le tourniquet", () => {
  it("épuise le pool avant de recommencer", () => {
    const pool = ["r1", "r2", "r3", "r4", "r5", "r6"].map((id) => recipe(id));
    const result = dispatchRecipes({
      cells: [
        cell("a1", LUN), cell("a2", LUN),
        cell("a1", MAR), cell("a2", MAR),
        cell("a1", MER), cell("a2", MER),
      ],
      candidatesByAccount: { a1: pool, a2: pool },
      existingUse: {},
    });

    expect(result.assignments).toHaveLength(6);
    const used = result.assignments.map((a) => a.candidate.patternTemplateId);
    expect(new Set(used).size).toBe(6); // aucune recette deux fois
  });

  it("six comptes le même jour reçoivent six recettes différentes", () => {
    const pool = ["r1", "r2", "r3", "r4", "r5", "r6", "r7"].map((id) => recipe(id));
    const accounts = ["a1", "a2", "a3", "a4", "a5", "a6"];
    const result = dispatchRecipes({
      cells: accounts.map((a) => cell(a, LUN)),
      candidatesByAccount: Object.fromEntries(accounts.map((a) => [a, pool])),
      existingUse: {},
    });

    const used = result.assignments.map((a) => a.candidate.patternTemplateId);
    expect(used).toHaveLength(6);
    expect(new Set(used).size).toBe(6);
  });

  /**
   * LE test du bug réel. La recette la plus ancienne est déjà programmée
   * MARDI : la proposer lundi reproduirait exactement « lundi sur un compte,
   * mardi sur un autre ». Un LRU qui ne regarde que le passé la choisirait.
   */
  it("ne propose pas lundi une recette déjà programmée mardi, même si c'est la plus ancienne", () => {
    const pool = [recipe("vieille"), recipe("recente")];
    const result = dispatchRecipes({
      cells: [cell("a1", LUN)],
      candidatesByAccount: { a1: pool },
      existingUse: history({
        // Servie il y a 3 mois… mais déjà reprogrammée mardi sur un autre compte.
        vieille: { a9: ["2026-07-01", MAR] },
        recente: { a9: ["2026-10-01"] },
      }),
    });

    expect(asMap(result)).toEqual({ "a1|2026-10-05|0": "recente" });
  });
});

describe("l'ordre de traitement — le plus contraint d'abord", () => {
  /**
   * LE VERROU DE RÉGRESSION PRINCIPAL.
   *
   * @a1 a 8 recettes, @a2 et @a3 n'en ont que 2 — les mêmes. En servant @a1
   * d'abord (ordre « stable » naïf), il prend la plus fraîche des deux rares et
   * @a3 se retrouve SANS RIEN. En commençant par les comptes les moins
   * pourvus, les trois cases se remplissent.
   */
  it("remplit les 3 cases là où l'ordre naïf en laissait une vide", () => {
    const rare = [recipe("r3"), recipe("r7")];
    const riche = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"].map((id) => recipe(id));

    const result = dispatchRecipes({
      cells: [cell("a1", LUN), cell("a2", LUN), cell("a3", LUN)],
      candidatesByAccount: { a1: riche, a2: rare, a3: rare },
      existingUse: history({
        r7: { a9: ["2026-09-14"] }, // 21 j
        r3: { a9: ["2026-09-21"] }, // 14 j
        r1: { a9: ["2026-09-26"] }, //  9 j
      }),
    });

    expect(result.assignments).toHaveLength(3);
    expect(result.unfilled).toHaveLength(0);
    // Les deux comptes contraints ont chacun une des deux recettes rares.
    const byCell = asMap(result);
    expect(new Set([byCell["a2|2026-10-05|0"], byCell["a3|2026-10-05|0"]])).toEqual(
      new Set(["r3", "r7"]),
    );
  });

  /**
   * Avec 2 publications par compte et par jour, traiter les deux cases d'un
   * compte à la suite lui donnerait les DEUX meilleures recettes du jour.
   */
  it("le rang passe avant tout : les premiers de chaque compte d'abord", () => {
    const pool = ["r1", "r2", "r3", "r4"].map((id) => recipe(id));
    const ordered = orderCells(
      [cell("a1", LUN, 0), cell("a1", LUN, 1), cell("a2", LUN, 0), cell("a2", LUN, 1)],
      { a1: pool, a2: pool },
    );
    expect(ordered.map((c) => `${c.accountId}#${c.rank}`)).toEqual([
      "a1#0",
      "a2#0",
      "a1#1",
      "a2#1",
    ]);
  });

  /**
   * À nombre de candidats égal — ce qui arrive dès qu'on filtre sur une famille
   * — c'est l'ordre d'AFFICHAGE qui tranche, pas l'identifiant technique du
   * compte. Sinon l'ordre de création des comptes décide seul qui reçoit la
   * recette la plus ancienne, sans que rien ne le laisse deviner.
   */
  it("à égalité, la ligne du haut est servie en premier", () => {
    const pool = [recipe("vieille"), recipe("recente")];
    const result = dispatchRecipes({
      cells: [cell("zzz-dernier", LUN), cell("aaa-premier", LUN)],
      candidatesByAccount: { "zzz-dernier": pool, "aaa-premier": pool },
      existingUse: history({
        vieille: { a9: ["2026-08-01"] },
        recente: { a9: ["2026-10-01"] },
      }),
      // L'affichage met « zzz-dernier » en haut, malgré son id.
      accountPriority: ["zzz-dernier", "aaa-premier"],
    });
    const byCell = asMap(result);
    expect(byCell["zzz-dernier|2026-10-05|0"]).toBe("vieille");
    expect(byCell["aaa-premier|2026-10-05|0"]).toBe("recente");
  });

  it("sans ordre fourni, le résultat reste déterministe", () => {
    const pool = [recipe("r1"), recipe("r2")];
    const run = () =>
      asMap(
        dispatchRecipes({
          cells: [cell("a2", LUN), cell("a1", LUN)],
          candidatesByAccount: { a1: pool, a2: pool },
          existingUse: {},
        }),
      );
    expect(run()).toEqual(run());
  });

  it("les jours sont traités dans l'ordre", () => {
    const pool = [recipe("r1")];
    const ordered = orderCells([cell("a1", MER), cell("a1", LUN), cell("a1", MAR)], { a1: pool });
    expect(ordered.map((c) => c.dayKey)).toEqual([LUN, MAR, MER]);
  });
});

describe("ce qui n'est pas attribuable", () => {
  it("un compte sans aucune recette du pool", () => {
    const result = dispatchRecipes({
      cells: [cell("a1", LUN)],
      candidatesByAccount: { a1: [] },
      existingUse: {},
    });
    expect(result.assignments).toHaveLength(0);
    expect(result.unfilled).toEqual([{ cell: cell("a1", LUN), reason: "no_candidate" }]);
  });

  /**
   * Un pool trop petit ne doit JAMAIS produire un doublon silencieux le même
   * jour : la troisième case reste vide, et le dit.
   */
  it("un pool épuisé sur la journée laisse la case vide plutôt que de doubler", () => {
    const pool = [recipe("r1"), recipe("r2")];
    const result = dispatchRecipes({
      cells: [cell("a1", LUN), cell("a2", LUN), cell("a3", LUN)],
      candidatesByAccount: { a1: pool, a2: pool, a3: pool },
      existingUse: {},
    });

    expect(result.assignments).toHaveLength(2);
    expect(result.unfilled).toEqual([
      { cell: cell("a3", LUN), reason: "pool_exhausted_day" },
    ]);
    const used = result.assignments.map((a) => a.candidate.patternTemplateId);
    expect(new Set(used).size).toBe(2);
  });

  it("une recette déjà posée ce jour-là est exclue, pas juste mal classée", () => {
    const pool = [recipe("r1"), recipe("r2")];
    const ranked = rankCandidatesForCell(
      cell("a1", LUN),
      pool,
      history({ r1: { a2: [LUN] } }),
    );
    expect(ranked.map((r) => r.candidate.patternTemplateId)).toEqual(["r2"]);
  });
});

/**
 * LE cas réel qui a motivé cette correction.
 *
 * Ses recettes RAUTO 7 à 14 partagent un gabarit builder ; les RTEXT 1 à 5 en
 * ont d'autres. Au lundi 14/09, les moins récemment publiées étaient RAUTO 12,
 * 13 et 14 (deux semaines) ; les RTEXT dataient de six jours. L'outil a proposé
 * des RTEXT — les plus RÉCENTES — parce qu'il traitait les huit RAUTO comme un
 * seul contenu, enterré par RAUTO 11 publiée le vendredi.
 *
 * L'identité de rotation, c'est LA RECETTE.
 */
describe("une série entière sur le même gabarit", () => {
  const TRANSACTION = [
    recipe("rtext-1"), recipe("rtext-2"), recipe("rtext-3"),
    recipe("rtext-4"), recipe("rtext-5"),
    recipe("rauto-11"), recipe("rauto-12"), recipe("rauto-13"), recipe("rauto-14"),
  ];
  const VECU = history({
    "rtext-1": { a9: ["2026-09-07"] },
    "rtext-2": { a9: ["2026-09-07"] },
    "rtext-3": { a9: ["2026-09-08"] },
    "rtext-4": { a9: ["2026-09-08"] },
    "rtext-5": { a9: ["2026-09-09"] },
    "rauto-11": { a9: ["2026-09-11"] },
    "rauto-12": { a9: ["2026-09-02"] },
    "rauto-13": { a9: ["2026-09-01"] },
    "rauto-14": { a9: ["2026-09-04"] },
  });

  it("les plus anciennes passent devant, pas leurs s\u0153urs récentes", () => {
    const ranked = rankCandidatesForCell(cell("a1", "2026-09-14"), TRANSACTION, VECU);
    expect(ranked.slice(0, 3).map((r) => r.candidate.patternTemplateId)).toEqual([
      "rauto-13",
      "rauto-12",
      "rauto-14",
    ]);
  });

  /**
   * La sévérité, pas seulement l'ordre. En regroupant par gabarit, une seule
   * RAUTO pouvait sortir par jour : le reste de la journée partait en cases
   * vides et en bandeau orange.
   */
  it("neuf comptes, neuf recettes : aucune case vide", () => {
    const accounts = Array.from({ length: 9 }, (_, i) => `a${i}`);
    const result = dispatchRecipes({
      cells: accounts.map((a) => cell(a, "2026-09-14")),
      candidatesByAccount: Object.fromEntries(accounts.map((a) => [a, TRANSACTION])),
      existingUse: VECU,
    });
    expect(result.unfilled).toHaveLength(0);
    expect(new Set(result.assignments.map((a) => a.candidate.patternTemplateId)).size).toBe(9);
  });

  /**
   * Corollaire assumé : deux recettes distinctes du même gabarit PEUVENT sortir
   * le même jour sur deux comptes. C'est voulu — ce sont deux vidéos
   * différentes. Écrit noir sur blanc pour que personne ne le « corrige ».
   */
  it("deux recettes du même gabarit ne se pénalisent plus", () => {
    const result = dispatchRecipes({
      cells: [cell("a1", LUN), cell("a2", LUN)],
      candidatesByAccount: { a1: [recipe("rauto-12")], a2: [recipe("rauto-13")] },
      existingUse: {},
    });
    expect(result.assignments).toHaveLength(2);
    expect(result.unfilled).toHaveLength(0);
  });
});

describe("les choix manuels", () => {
  it("une case épinglée survit au recalcul, et les voisines en tiennent compte", () => {
    const pool = ["r1", "r2", "r3"].map((id) => recipe(id));
    const result = dispatchRecipes({
      cells: [cell("a1", LUN), cell("a2", LUN)],
      candidatesByAccount: { a1: pool, a2: pool },
      existingUse: {},
      // On force r1 sur a2 ; a1 ne doit donc PAS recevoir r1.
      pinned: { [cellKey(cell("a2", LUN))]: "r1" },
    });

    const byCell = asMap(result);
    expect(byCell["a2|2026-10-05|0"]).toBe("r1");
    expect(byCell["a1|2026-10-05|0"]).not.toBe("r1");
    expect(result.assignments.find((a) => a.cell.accountId === "a2")?.pinned).toBe(true);
  });

  it("une case vidée à la main reste vide, et le dit", () => {
    const result = dispatchRecipes({
      cells: [cell("a1", LUN)],
      candidatesByAccount: { a1: [recipe("r1")] },
      existingUse: {},
      pinned: { [cellKey(cell("a1", LUN))]: null },
    });
    expect(result.assignments).toHaveLength(0);
    expect(result.unfilled).toEqual([{ cell: cell("a1", LUN), reason: "pinned_empty" }]);
  });

  it("une recette épinglée puis désactivée sur le compte ne casse rien", () => {
    const result = dispatchRecipes({
      cells: [cell("a1", LUN)],
      candidatesByAccount: { a1: [recipe("r2")] },
      existingUse: {},
      pinned: { [cellKey(cell("a1", LUN))]: "r1-disparue" },
    });
    expect(result.unfilled).toEqual([{ cell: cell("a1", LUN), reason: "no_candidate" }]);
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

describe("robustesse", () => {
  it("le résultat ne dépend pas de l'ordre des cases en entrée", () => {
    const pool = ["r1", "r2", "r3", "r4"].map((id, i) => recipe(id, i));
    const cells = [cell("a1", LUN), cell("a2", LUN), cell("a1", MAR), cell("a2", MAR)];
    const input = { candidatesByAccount: { a1: pool, a2: pool }, existingUse: {} };

    const direct = asMap(dispatchRecipes({ cells, ...input }));
    const melange = asMap(dispatchRecipes({ cells: [...cells].reverse(), ...input }));
    expect(melange).toEqual(direct);
  });

  it("l'historique de l'appelant n'est jamais muté", () => {
    const existingUse = history({ r1: { a9: ["2026-10-01"] } });
    const avant = JSON.stringify(existingUse);
    dispatchRecipes({
      cells: [cell("a1", LUN)],
      candidatesByAccount: { a1: [recipe("r1")] },
      existingUse,
    });
    expect(JSON.stringify(existingUse)).toBe(avant);
  });

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

describe("la borne physique", () => {
  /**
   * Le chiffre le plus utile de l'écran : aucun algorithme ne fait mieux que
   * ⌊N/c⌋. 15 recettes sur 8 comptes par jour → 1 jour, ce qui explique le
   * « lundi/mardi » observé et désigne le vrai levier (pool plus grand, ou
   * moins de publications par jour).
   */
  it("⌊recettes / publications par jour⌋", () => {
    expect(minimumAchievableGap(15, 8)).toBe(1);
    expect(minimumAchievableGap(15, 6)).toBe(2);
    expect(minimumAchievableGap(15, 4)).toBe(3);
    expect(minimumAchievableGap(15, 0)).toBeNull();
  });
});

/**
 * Les alternatives proposées à l'écran.
 *
 * L'écran rappelait `rankCandidatesForCell` contre l'historique INITIAL, alors
 * que l'attribution classait contre un historique enrichi case après case. Deux
 * conséquences visibles : le « · N j » du menu et la pastille de la même case
 * pouvaient différer, et le premier élément du menu n'était pas toujours celui
 * qui avait été choisi — ce que la promesse « SOURCE UNIQUE » exclut.
 */
describe("optionsByCell — ce que l'écran propose", () => {
  it("la première alternative d'une case EST ce qui lui a été attribué", () => {
    const candidates = [recipe("a"), recipe("b"), recipe("c")];
    const result = dispatchRecipes({
      cells: [cell("acc1", LUN), cell("acc2", LUN), cell("acc3", LUN)],
      candidatesByAccount: { acc1: candidates, acc2: candidates, acc3: candidates },
      existingUse: history({
        a: { acc1: ["2026-10-01"] },
        b: { acc1: ["2026-09-25"] },
        c: { acc1: ["2026-09-20"] },
      }),
    });

    for (const assignment of result.assignments) {
      const options = result.optionsByCell[cellKey(assignment.cell)];
      expect(options[0].candidate.patternTemplateId).toBe(
        assignment.candidate.patternTemplateId,
      );
      // Le même nombre des deux côtés : la pastille et son menu ne peuvent plus
      // afficher deux écarts différents pour la même recette.
      expect(options[0].rawGap).toBe(assignment.gapDays);
    }
  });

  it("une recette déjà servie plus tôt dans le lot disparaît des alternatives du jour", () => {
    const candidates = [recipe("a"), recipe("b")];
    const result = dispatchRecipes({
      cells: [cell("acc1", LUN), cell("acc2", LUN)],
      candidatesByAccount: { acc1: candidates, acc2: candidates },
      existingUse: history({ a: { acc1: ["2026-09-01"] }, b: { acc1: ["2026-09-15"] } }),
    });

    const second = result.assignments[1];
    const options = result.optionsByCell[cellKey(second.cell)];
    const first = result.assignments[0].candidate.patternTemplateId;
    expect(options.some((o) => o.candidate.patternTemplateId === first)).toBe(false);
  });

  it("une case sans candidat rend une liste vide, pas `undefined`", () => {
    const result = dispatchRecipes({
      cells: [cell("acc1", LUN)],
      candidatesByAccount: {},
      existingUse: {},
    });
    expect(result.optionsByCell[cellKey(cell("acc1", LUN))]).toEqual([]);
  });

  it("une case épinglée porte aussi ses alternatives — l'échange reste possible", () => {
    const candidates = [recipe("a"), recipe("b")];
    const key = cellKey(cell("acc1", LUN));
    const result = dispatchRecipes({
      cells: [cell("acc1", LUN)],
      candidatesByAccount: { acc1: candidates },
      existingUse: {},
      pinned: { [key]: "b" },
    });
    expect(result.assignments[0].pinned).toBe(true);
    expect(result.optionsByCell[key].map((o) => o.candidate.patternTemplateId).sort()).toEqual([
      "a",
      "b",
    ]);
  });
});

/**
 * La charge par jour, quand tous les comptes ne publient pas tous les jours.
 *
 * « Parfois j'ai des comptes qui n'ont pas de contenu certains jours » : l'écran
 * permet d'éteindre un jour sur un compte. La borne ⌊N/c⌋ affichée doit alors se
 * lire sur la journée la plus chargée — c'est là que les recettes se consomment
 * le plus vite. La moyenne annoncerait un écart que la semaine ne tient pas.
 */
describe("la charge du jour le plus chargé", () => {
  it("sans jour éteint, c'est la charge commune — l'affichage ne bouge pas", () => {
    expect(busiestDayCapacity([6, 6, 6, 6, 6])).toBe(6);
    expect(minimumAchievableGap(15, busiestDayCapacity([6, 6, 6, 6, 6]))).toBe(2);
  });

  it("avec des jours éteints, c'est le maximum, pas la moyenne", () => {
    // Moyenne = 4 (→ 3 j annoncés), maximum = 6 (→ 2 j réellement tenables).
    const load = [6, 2, 6, 2, 4];
    expect(busiestDayCapacity(load)).toBe(6);
    expect(minimumAchievableGap(15, busiestDayCapacity(load))).toBe(2);
  });

  it("aucun jour retenu : charge nulle, et la borne reste indéfinie", () => {
    expect(busiestDayCapacity([])).toBe(0);
    expect(minimumAchievableGap(15, busiestDayCapacity([]))).toBeNull();
  });

  it("une seule journée active dans la semaine borne à elle seule", () => {
    expect(busiestDayCapacity([0, 0, 3, 0, 0])).toBe(3);
  });
});
