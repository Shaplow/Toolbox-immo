import { describe, it, expect } from "vitest";
import {
  resolvePreFilledDescription,
  resolveFixedDescription,
  normalizeFixedText,
} from "../preFilledDescription";

describe("resolvePreFilledDescription", () => {
  const fields = JSON.stringify({
    description: "Superbe T3 lumineux, plein sud.",
    prix: "350 000 €",
    vide: "   ",
  });

  it("retourne null si le mode n'est pas preFilled", () => {
    expect(
      resolvePreFilledDescription(
        { needsDescription: "autoGenerate", descriptionSourceFieldKey: "description" },
        fields,
      ),
    ).toBeNull();
    expect(
      resolvePreFilledDescription(
        { needsDescription: "manualWrite", descriptionSourceFieldKey: "description" },
        fields,
      ),
    ).toBeNull();
    expect(
      resolvePreFilledDescription(
        { needsDescription: "none", descriptionSourceFieldKey: "description" },
        fields,
      ),
    ).toBeNull();
  });

  it("retourne null si aucune clé source configurée", () => {
    expect(
      resolvePreFilledDescription(
        { needsDescription: "preFilled", descriptionSourceFieldKey: null },
        fields,
      ),
    ).toBeNull();
    expect(
      resolvePreFilledDescription(
        { needsDescription: "preFilled", descriptionSourceFieldKey: "   " },
        fields,
      ),
    ).toBeNull();
  });

  it("retourne null si la clé est absente du bien", () => {
    expect(
      resolvePreFilledDescription(
        { needsDescription: "preFilled", descriptionSourceFieldKey: "inexistant" },
        fields,
      ),
    ).toBeNull();
  });

  it("retourne null si la valeur du champ est vide/espaces (jamais de wipe)", () => {
    expect(
      resolvePreFilledDescription(
        { needsDescription: "preFilled", descriptionSourceFieldKey: "vide" },
        fields,
      ),
    ).toBeNull();
  });

  it("retourne la valeur brute si le champ est rempli", () => {
    expect(
      resolvePreFilledDescription(
        { needsDescription: "preFilled", descriptionSourceFieldKey: "description" },
        fields,
      ),
    ).toBe("Superbe T3 lumineux, plein sud.");
  });

  it("tolère un objet déjà parsé et un JSON illisible", () => {
    expect(
      resolvePreFilledDescription(
        { needsDescription: "preFilled", descriptionSourceFieldKey: "description" },
        { description: "T2 rénové" },
      ),
    ).toBe("T2 rénové");
    expect(
      resolvePreFilledDescription(
        { needsDescription: "preFilled", descriptionSourceFieldKey: "description" },
        "{ pas du json",
      ),
    ).toBeNull();
    expect(
      resolvePreFilledDescription(
        { needsDescription: "preFilled", descriptionSourceFieldKey: "description" },
        null,
      ),
    ).toBeNull();
  });
});

describe("resolveFixedDescription", () => {
  it("retourne null si le mode n'est pas fixed", () => {
    for (const mode of ["preFilled", "autoGenerate", "manualWrite", "none"]) {
      expect(
        resolveFixedDescription({
          needsDescription: mode,
          descriptionFixedText: "Texte fixe de la recette.",
        }),
      ).toBeNull();
    }
  });

  it("retourne null si le texte fixe est absent/vide/espaces", () => {
    expect(
      resolveFixedDescription({ needsDescription: "fixed", descriptionFixedText: null }),
    ).toBeNull();
    expect(
      resolveFixedDescription({ needsDescription: "fixed", descriptionFixedText: "" }),
    ).toBeNull();
    expect(
      resolveFixedDescription({ needsDescription: "fixed", descriptionFixedText: "   " }),
    ).toBeNull();
  });

  it("retourne le texte brut si rempli (aucune dépendance au bien)", () => {
    expect(
      resolveFixedDescription({
        needsDescription: "fixed",
        descriptionFixedText: "Visitez ce bien d'exception ✨",
      }),
    ).toBe("Visitez ce bien d'exception ✨");
  });
});

describe("normalizeFixedText", () => {
  it("non-string → null", () => {
    expect(normalizeFixedText(null)).toBeNull();
    expect(normalizeFixedText(undefined)).toBeNull();
  });

  it("chaîne vide/espaces → null", () => {
    expect(normalizeFixedText("")).toBeNull();
    expect(normalizeFixedText("   ")).toBeNull();
  });

  it("texte rempli → conserve le brut (pas de trim destructif)", () => {
    expect(normalizeFixedText("  Bonjour  ")).toBe("  Bonjour  ");
  });
});
