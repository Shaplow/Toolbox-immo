/**
 * Tests du centrage vertical optique.
 *
 * Deux enjeux :
 *
 * 1. **Prouver la dérivation.** L'affirmation « l'offset est indépendant du
 *    line-height et du nombre de lignes » est ce qui rend le correctif simple. Elle
 *    est démontrée ici en reconstruisant la géométrie CSS, pas admise.
 *
 * 2. **Empêcher la récidive de `f17d842`.** La tentative précédente a échoué parce
 *    que ses métriques dépendaient du texte rendu et parce que la fonction injectée
 *    référençait son environnement de module. Les deux sont couverts.
 *
 * Les valeurs de référence sont les métriques RÉELLES des polices de
 * `render-engine/fonts/`, lues dans leurs tables `head`/`hhea`/`OS/2`.
 */

import { describe, it, expect } from "vitest";
import {
  MAX_OPTICAL_OFFSET_EM,
  measureFontOpticalOffsetEm,
  opticalCapCenterOffsetEm,
} from "@/lib/renderer/textMetrics";

/** Métriques réelles, normalisées en em (unitsPerEm = 1000 pour toutes). */
const FONTS = [
  { name: "Didot",                ascent: 0.700, descent: 0.300, cap: 0.667, expected: +0.1335 },
  { name: "Didot Title",          ascent: 0.701, descent: 0.299, cap: 0.667, expected: +0.1325 },
  { name: "PlayfairDisplay-Bold", ascent: 1.082, descent: 0.251, cap: 0.708, expected: -0.0615 },
  { name: "BebasNeue-Regular",    ascent: 0.900, descent: 0.300, cap: 0.700, expected: +0.0500 },
  { name: "GlacialIndifference",  ascent: 0.949, descent: 0.250, cap: 0.680, expected: -0.0095 },
  { name: "luxury",               ascent: 0.754, descent: 0.200, cap: 0.700, expected: +0.0730 },
] as const;

const halfAsym = (ascent: number, descent: number) => (ascent - descent) / 2;

describe("opticalCapCenterOffsetEm — polices réelles", () => {
  for (const f of FONTS) {
    it(`${f.name} → ${f.expected > 0 ? "+" : ""}${f.expected} em`, () => {
      expect(opticalCapCenterOffsetEm(f.cap, halfAsym(f.ascent, f.descent))).toBeCloseTo(
        f.expected,
        4,
      );
    });
  }

  it("le SIGNE change selon la police — une constante en dur serait fausse", () => {
    const didot = opticalCapCenterOffsetEm(0.667, halfAsym(0.7, 0.3));
    const playfair = opticalCapCenterOffsetEm(0.708, halfAsym(1.082, 0.251));
    expect(didot).toBeGreaterThan(0); // texte trop haut → descendre
    expect(playfair).toBeLessThan(0); // texte trop bas → remonter
  });
});

describe("opticalCapCenterOffsetEm — la dérivation, démontrée", () => {
  /**
   * Reconstruit la géométrie CSS d'une pile de boîtes de ligne et retourne le
   * centre de la zone d'encre [capTop de la 1re ligne, baseline de la dernière].
   */
  function inkCenterEm(ascent: number, descent: number, cap: number, L: number, N: number) {
    const halfLeading = (L - (ascent + descent)) / 2;
    const capTop = halfLeading + ascent - cap;
    const lastBaseline = (N - 1) * L + halfLeading + ascent;
    return (capTop + lastBaseline) / 2;
  }

  it("après application de l'offset, l'encre est centrée — pour tout line-height et tout nombre de lignes", () => {
    for (const f of FONTS) {
      const offset = opticalCapCenterOffsetEm(f.cap, halfAsym(f.ascent, f.descent));
      for (const L of [0.8, 1, 1.2, 1.333, 2, 2.5]) {
        for (const N of [1, 2, 3, 4, 7]) {
          const inkCenter = inkCenterEm(f.ascent, f.descent, f.cap, L, N);
          const stackCenter = (N * L) / 2;
          // C'est l'égalité qui fonde tout le correctif.
          expect(inkCenter + offset).toBeCloseTo(stackCenter, 3);
        }
      }
    }
  });

  it("l'offset ne dépend NI du line-height NI du nombre de lignes", () => {
    // Corollaire : une seule valeur par police suffit, d'où le cache par police.
    const f = FONTS[0];
    const ref = opticalCapCenterOffsetEm(f.cap, halfAsym(f.ascent, f.descent));
    expect(ref).toBe(opticalCapCenterOffsetEm(f.cap, halfAsym(f.ascent, f.descent)));
    expect(ref).not.toBe(0);
  });
});

describe("opticalCapCenterOffsetEm — robustesse", () => {
  it("retourne 0 sur des entrées non finies", () => {
    expect(opticalCapCenterOffsetEm(NaN, 0.2)).toBe(0);
    expect(opticalCapCenterOffsetEm(0.7, NaN)).toBe(0);
    expect(opticalCapCenterOffsetEm(Infinity, 0.2)).toBe(0);
    expect(opticalCapCenterOffsetEm(0.7, -Infinity)).toBe(0);
  });

  it("retourne 0 quand la capHeight est nulle ou négative — sonde non aboutie", () => {
    expect(opticalCapCenterOffsetEm(0, 0.2)).toBe(0);
    expect(opticalCapCenterOffsetEm(-0.5, 0.2)).toBe(0);
  });

  it("borne les valeurs aberrantes au lieu de casser la mise en page", () => {
    expect(opticalCapCenterOffsetEm(0.7, -100)).toBe(MAX_OPTICAL_OFFSET_EM);
    expect(opticalCapCenterOffsetEm(0.7, 100)).toBe(-MAX_OPTICAL_OFFSET_EM);
  });

  it("les valeurs réelles restent très loin du plafond", () => {
    for (const f of FONTS) {
      const offset = opticalCapCenterOffsetEm(f.cap, halfAsym(f.ascent, f.descent));
      expect(Math.abs(offset)).toBeLessThan(MAX_OPTICAL_OFFSET_EM / 2);
    }
  });

  it("arrondit à 4 décimales pour que le seuil de parité ait un sens", () => {
    const offset = opticalCapCenterOffsetEm(0.6666666, 0.2000001);
    expect(offset).toBe(Math.round(offset * 10_000) / 10_000);
  });
});

describe("measureFontOpticalOffsetEm — contrat d'injection", () => {
  const source = measureFontOpticalOffsetEm.toString();

  it("ne référence aucune constante ni import du module", () => {
    // Cette fonction est sérialisée par .toString() et injectée dans le script
    // inline de buildHTML. Toute référence à l'environnement du module y lèverait
    // un ReferenceError au runtime — silencieusement pour le rendu final.
    expect(source).not.toMatch(/MAX_OPTICAL_OFFSET_EM/);
    expect(source).not.toMatch(/opticalCapCenterOffsetEm/);
    expect(source).not.toMatch(/\bimport\b|\brequire\(/);
    expect(source).not.toMatch(/\bcache\b/);
  });

  it("ne mesure JAMAIS le texte du bloc — c'est ce qui garantit la stabilité", () => {
    // Le bug de fond de f17d842 : les métriques venaient de la chaîne rendue, donc
    // « PARIS » et « Épinay » ne se centraient pas au même endroit.
    expect(source).not.toMatch(/actualBoundingBox/);
    expect(source).not.toMatch(/measureText/);
    expect(source).not.toMatch(/textContent/);
  });

  it("retourne 0 hors environnement DOM plutôt que de lever", () => {
    // Vitest tourne en environment "node" : pas de document.
    expect(
      measureFontOpticalOffsetEm({ fontFamily: "Didot", fontWeight: "400", fontStyle: "normal" }),
    ).toBe(0);
  });
});
