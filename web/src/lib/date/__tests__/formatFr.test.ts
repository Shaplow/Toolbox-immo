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
