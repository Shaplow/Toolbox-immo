import { describe, it, expect } from "vitest";
import { capCenteringOffsetEm } from "@/lib/renderer/textMetrics";

describe("capCenteringOffsetEm", () => {
  it("capitales sans descendantes (encre trop haute) → décalage vers le bas", () => {
    // À 100px : ascender police 80, descender 20 ; encre caps 70 / 0.
    // spaceAbove = 10, spaceBelow = 20 → offsetPx = 5 → 0.05em.
    const offset = capCenteringOffsetEm(
      {
        fontBoundingBoxAscent: 80,
        fontBoundingBoxDescent: 20,
        actualBoundingBoxAscent: 70,
        actualBoundingBoxDescent: 0,
      },
      100,
    );
    expect(offset).toBeCloseTo(0.05, 5);
  });

  it("encre déjà symétrique → offset nul", () => {
    const offset = capCenteringOffsetEm(
      {
        fontBoundingBoxAscent: 75,
        fontBoundingBoxDescent: 25,
        actualBoundingBoxAscent: 50,
        actualBoundingBoxDescent: 0,
      },
      100,
    );
    expect(offset).toBe(0);
  });

  it("indépendant de la taille de mesure (résultat en em)", () => {
    const m = {
      fontBoundingBoxAscent: 80,
      fontBoundingBoxDescent: 20,
      actualBoundingBoxAscent: 70,
      actualBoundingBoxDescent: 0,
    };
    expect(capCenteringOffsetEm(m, 100)).toBeCloseTo(capCenteringOffsetEm(
      {
        fontBoundingBoxAscent: 160,
        fontBoundingBoxDescent: 40,
        actualBoundingBoxAscent: 140,
        actualBoundingBoxDescent: 0,
      },
      200,
    ), 6);
  });

  it("fontSizePx invalide → 0", () => {
    expect(capCenteringOffsetEm(
      { fontBoundingBoxAscent: 80, fontBoundingBoxDescent: 20, actualBoundingBoxAscent: 70, actualBoundingBoxDescent: 0 },
      0,
    )).toBe(0);
  });

  it("métriques aberrantes → plafonné à ±0.5em", () => {
    const offset = capCenteringOffsetEm(
      { fontBoundingBoxAscent: 0, fontBoundingBoxDescent: 1000, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 },
      100,
    );
    expect(offset).toBe(0.5);
  });
});
