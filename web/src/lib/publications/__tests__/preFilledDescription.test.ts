import { describe, it, expect } from "vitest";
import { resolvePreFilledDescription } from "../preFilledDescription";

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
