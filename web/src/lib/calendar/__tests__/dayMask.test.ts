/**
 * Le masque « ce compte ne publie pas ce jour-là ».
 *
 * Deux choses valent d'être figées ici : le fait qu'une clé ABSENTE veuille dire
 * « tous les jours » (c'est ce qui permet au masque de survivre à l'ajout d'un
 * compte ou d'un jour sans réconciliation), et la charge par jour, qui nourrit
 * les deux bornes affichées par l'écran.
 */
import { describe, it, expect } from "vitest";
import { isDayActive, publicationsByDay } from "@/lib/calendar/dayMask";

describe("isDayActive", () => {
  it("un compte absent du masque publie tous les jours", () => {
    expect(isDayActive({}, "acc1", 0)).toBe(true);
    expect(isDayActive({ acc2: [1] }, "acc1", 1)).toBe(true);
  });

  it("un offset listé est éteint, les autres restent actifs", () => {
    const mask = { acc1: [1, 3] };
    expect(isDayActive(mask, "acc1", 1)).toBe(false);
    expect(isDayActive(mask, "acc1", 3)).toBe(false);
    expect(isDayActive(mask, "acc1", 2)).toBe(true);
  });
});

describe("publicationsByDay", () => {
  const DAYS = [0, 1, 2, 3, 4];
  const ACCOUNTS = ["a", "b", "c"];

  it("sans masque, tous les jours portent la même charge", () => {
    expect(publicationsByDay(DAYS, ACCOUNTS, {}, 1)).toEqual([3, 3, 3, 3, 3]);
  });

  it("un compte éteint mardi et jeudi ne pèse que sur ces jours-là", () => {
    expect(publicationsByDay(DAYS, ACCOUNTS, { b: [1, 3] }, 1)).toEqual([3, 2, 3, 2, 3]);
  });

  it("« par compte et par jour » multiplie la charge de chaque jour", () => {
    expect(publicationsByDay(DAYS, ACCOUNTS, { b: [1] }, 2)).toEqual([6, 4, 6, 6, 6]);
  });

  it("les jours sont rendus dans l'ordre, quel que soit l'ordre d'entrée", () => {
    expect(publicationsByDay([4, 0, 2], ACCOUNTS, { a: [0] }, 1)).toEqual([2, 3, 3]);
  });

  it("aucun jour retenu : aucune charge — et la borne restera indéfinie", () => {
    expect(publicationsByDay([], ACCOUNTS, {}, 1)).toEqual([]);
  });
});
