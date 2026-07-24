import { describe, it, expect } from "vitest";
import {
  normalizeCustomFields,
  customFieldToSchemaField,
  validateCustomFields,
  inferDefaultFieldType,
  type CustomField,
} from "@/lib/customFields";

describe("normalizeCustomFields", () => {
  it("legacy string[] → champs texte", () => {
    expect(normalizeCustomFields(["adresse", "prix"])).toEqual([
      { key: "adresse", label: "adresse", type: "text" },
      { key: "prix", label: "prix", type: "text" },
    ]);
  });

  it("CustomField[] typé → conservé (type coercé)", () => {
    const input = [
      { key: "prix", label: "Prix", type: "number", required: true },
      { key: "desc", label: "Description", type: "textarea" },
    ];
    expect(normalizeCustomFields(input)).toEqual([
      { key: "prix", label: "Prix", type: "number", required: true },
      { key: "desc", label: "Description", type: "textarea" },
    ]);
  });

  it("type inconnu → coercé en text ; label absent → clé", () => {
    expect(normalizeCustomFields([{ key: "x", type: "date" }])).toEqual([
      { key: "x", label: "x", type: "text" },
    ]);
  });

  it("accepte une string JSON", () => {
    expect(normalizeCustomFields('["a"]')).toEqual([
      { key: "a", label: "a", type: "text" },
    ]);
  });

  it("dédup par clé + ignore les entrées invalides", () => {
    expect(
      normalizeCustomFields(["a", "a", "", { key: "a" }, { nope: 1 }, 42]),
    ).toEqual([{ key: "a", label: "a", type: "text" }]);
  });

  it("JSON malformé / non-array → []", () => {
    expect(normalizeCustomFields("{bad")).toEqual([]);
    expect(normalizeCustomFields(null)).toEqual([]);
    expect(normalizeCustomFields({})).toEqual([]);
  });
});

describe("customFieldToSchemaField", () => {
  it("mappe key/label/type/required", () => {
    const f: CustomField = { key: "prix", label: "Prix", type: "number", required: true };
    expect(customFieldToSchemaField(f)).toEqual({
      key: "prix",
      label: "Prix",
      type: "number",
      required: true,
    });
  });

  it("required par défaut false ; label fallback sur la clé", () => {
    expect(customFieldToSchemaField({ key: "x", label: "", type: "text" })).toEqual({
      key: "x",
      label: "x",
      type: "text",
      required: false,
    });
  });
});

describe("inferDefaultFieldType", () => {
  it("libellés de texte long → textarea (accent-insensible)", () => {
    for (const label of [
      "Description",
      "description du bien",
      "Notes",
      "Adresse",
      "Commentaire",
      "Résumé",
      "Bio",
    ]) {
      expect(inferDefaultFieldType(label)).toBe("textarea");
    }
  });

  it("libellés courts / autres → text", () => {
    for (const label of ["Prix", "Surface", "Ville", "Titre", "Code postal"]) {
      expect(inferDefaultFieldType(label)).toBe("text");
    }
  });
});

describe("validateCustomFields", () => {
  it("valide des champs corrects", () => {
    expect(
      validateCustomFields([{ key: "adresse", label: "Adresse", type: "text" }]),
    ).toBeNull();
  });

  it("rejette une clé invalide", () => {
    expect(
      validateCustomFields([{ key: "2prix", label: "Prix", type: "number" }]),
    ).toMatch(/2prix/);
  });

  it("rejette les doublons de clé", () => {
    expect(
      validateCustomFields([
        { key: "a", label: "A", type: "text" },
        { key: "a", label: "A2", type: "text" },
      ]),
    ).toMatch(/existe déjà/);
  });

  it("rejette un libellé vide", () => {
    expect(
      validateCustomFields([{ key: "a", label: "  ", type: "text" }]),
    ).toMatch(/libellé/);
  });
});
