/**
 * Tests des formateurs de date FR (fuseau figé Europe/Paris — voir formatFr.ts).
 *
 * Dates de référence : 21/07/2026 (jour à 2 chiffres) pour les formats
 * standards, 03/07/2026 (jour à 1 chiffre) pour distinguer `shortDateFr`
 * (non paddé) de `shortDatePaddedFr` (zero-paddé).
 */

import { describe, it, expect } from "vitest";
import {
  dateFr,
  dateFrLong,
  shortDateFr,
  shortDatePaddedFr,
  dayMonthLongFr,
  numericDateFr,
  isoToLocalInput,
  localInputToIso,
  weekdayInitialFr,
} from "../formatFr";

const REF = "2026-07-21T12:00:00.000Z"; // mardi 21 juillet 2026, midi UTC (14h Paris, pas de bascule de jour)
const SINGLE_DIGIT_DAY = "2026-07-03T12:00:00.000Z"; // vendredi 3 juillet 2026

describe("dateFr", () => {
  it("formate jour numérique / mois court / année", () => {
    expect(dateFr(REF)).toBe("21 juil. 2026");
  });

  it("accepte un objet Date", () => {
    expect(dateFr(new Date(REF))).toBe("21 juil. 2026");
  });

  it("retourne le fallback pour null/undefined", () => {
    expect(dateFr(null)).toBe("—");
    expect(dateFr(undefined)).toBe("—");
  });

  it("retourne le fallback pour une string non parsable", () => {
    expect(dateFr("pas-une-date")).toBe("—");
  });

  it("retourne le fallback pour une Date invalide", () => {
    expect(dateFr(new Date("invalid"))).toBe("—");
  });
});

describe("dateFrLong", () => {
  it("formate weekday long / jour / mois long / année", () => {
    expect(dateFrLong(REF)).toBe("mardi 21 juillet 2026");
  });

  it("retourne le fallback pour null/undefined", () => {
    expect(dateFrLong(null)).toBe("—");
    expect(dateFrLong(undefined)).toBe("—");
  });

  it("retourne le fallback pour une date invalide", () => {
    expect(dateFrLong("n'importe quoi")).toBe("—");
  });
});

describe("shortDateFr", () => {
  it("formate jour numérique / mois court, sans année", () => {
    expect(shortDateFr(REF)).toBe("21 juil.");
  });

  it("ne zero-padde pas le jour", () => {
    expect(shortDateFr(SINGLE_DIGIT_DAY)).toBe("3 juil.");
  });

  it("retourne le fallback pour une entrée invalide", () => {
    expect(shortDateFr(null)).toBe("—");
    expect(shortDateFr("invalid")).toBe("—");
  });
});

describe("shortDatePaddedFr", () => {
  it("zero-padde le jour à un chiffre", () => {
    expect(shortDatePaddedFr(SINGLE_DIGIT_DAY)).toBe("03 juil.");
  });

  it("laisse un jour à deux chiffres inchangé", () => {
    expect(shortDatePaddedFr(REF)).toBe("21 juil.");
  });

  it("retourne le fallback pour une entrée invalide", () => {
    expect(shortDatePaddedFr(undefined)).toBe("—");
  });
});

describe("dayMonthLongFr", () => {
  it("formate jour numérique / mois long, sans année", () => {
    expect(dayMonthLongFr(REF)).toBe("21 juillet");
  });

  it("retourne le fallback pour une entrée invalide", () => {
    expect(dayMonthLongFr(null)).toBe("—");
  });
});

describe("numericDateFr", () => {
  it("formate en jj/mm/aaaa (défaut Intl fr-FR)", () => {
    expect(numericDateFr(REF)).toBe("21/07/2026");
  });

  it("retourne le fallback pour une entrée invalide", () => {
    expect(numericDateFr(null)).toBe("—");
    expect(numericDateFr("invalid")).toBe("—");
  });
});

/**
 * Aller-retour saisie ↔ affichage.
 *
 * Le bug corrigé : `isoToLocalInput` lisait l'heure dans le fuseau du
 * navigateur alors que tous les formateurs d'affichage sont figés sur
 * Europe/Paris. Sur un poste réglé sur Paris les deux coïncident et le
 * problème est invisible — d'où ces tests, qui vérifient les valeurs
 * absolues attendues à Paris quel que soit le fuseau de la machine.
 */
describe("isoToLocalInput / localInputToIso", () => {
  it("lit un instant en heure murale de Paris (heure d'été, UTC+2)", () => {
    expect(isoToLocalInput("2026-07-21T12:00:00.000Z")).toBe("2026-07-21T14:00");
  });

  it("lit un instant en heure murale de Paris (heure d'hiver, UTC+1)", () => {
    expect(isoToLocalInput("2026-01-15T12:00:00.000Z")).toBe("2026-01-15T13:00");
  });

  it("interprète une saisie comme heure de Paris, pas du navigateur", () => {
    expect(localInputToIso("2026-07-21T14:00")).toBe("2026-07-21T12:00:00.000Z");
    expect(localInputToIso("2026-01-15T13:00")).toBe("2026-01-15T12:00:00.000Z");
  });

  it("fait un aller-retour stable", () => {
    for (const iso of [
      "2026-07-21T12:00:00.000Z",
      "2026-01-15T12:00:00.000Z",
      "2026-09-01T07:00:00.000Z",
    ]) {
      expect(localInputToIso(isoToLocalInput(iso))).toBe(iso);
    }
  });

  it("tient le passage à l'heure d'été (29 mars 2026, 2h → 3h)", () => {
    // 00:30 UTC = 01:30 Paris (encore UTC+1) ; 01:30 UTC = 03:30 (déjà UTC+2).
    expect(isoToLocalInput("2026-03-29T00:30:00.000Z")).toBe("2026-03-29T01:30");
    expect(isoToLocalInput("2026-03-29T01:30:00.000Z")).toBe("2026-03-29T03:30");
    expect(localInputToIso("2026-03-29T03:30")).toBe("2026-03-29T01:30:00.000Z");
  });

  it("rejette une entrée mal formée plutôt que d'inventer une date", () => {
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("21/07/2026")).toBeNull();
    expect(isoToLocalInput("invalid")).toBe("");
  });
});

/**
 * L'initiale du jour, pour la matrice comptes × jours de « Remplir la semaine ».
 *
 * Deux risques, tous deux silencieux : un runtime dont les données de locale
 * sont réduites rendrait « Mon » au lieu de « L » et ferait exploser la largeur
 * de la ligne ; et une initiale dérivée d'un index au lieu de la date afficherait
 * « L » sur un dimanche dès que la semaine du calendrier est décalée.
 */
describe("weekdayInitialFr", () => {
  it("rend une seule lettre par jour, dans l'ordre de la semaine", () => {
    // Lundi 14 → dimanche 20 septembre 2026, à midi UTC (jour civil Paris sûr).
    const week = ["14", "15", "16", "17", "18", "19", "20"].map(
      (d) => new Date(`2026-09-${d}T12:00:00Z`),
    );
    expect(week.map(weekdayInitialFr)).toEqual(["L", "M", "M", "J", "V", "S", "D"]);
  });

  it("l'initiale suit le jour civil PARIS, pas UTC", () => {
    // Dimanche 23:00 UTC = lundi 01:00 à Paris.
    expect(weekdayInitialFr("2026-09-13T23:00:00.000Z")).toBe("L");
  });

  it("une date illisible ne casse pas la ligne", () => {
    expect(weekdayInitialFr(null)).toBe("—");
    expect(weekdayInitialFr("pas-une-date")).toBe("—");
  });
});
