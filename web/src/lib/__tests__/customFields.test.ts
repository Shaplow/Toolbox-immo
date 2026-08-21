import { describe, it, expect } from "vitest";
import {
  normalizeCustomFields,
  customFieldToSchemaField,
  validateCustomFields,
  validateFieldValues,
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

  it("select : options coercées (trim, dédup, non-string ignorés)", () => {
    expect(
      normalizeCustomFields([
        { key: "type_bien", label: "Type", type: "select", options: [" Maison ", "Maison", "", 3, "Appartement"] },
      ]),
    ).toEqual([
      { key: "type_bien", label: "Type", type: "select", options: ["Maison", "Appartement"] },
    ]);
  });

  it("select sans options → options: [] (l'erreur est portée par validateCustomFields)", () => {
    expect(normalizeCustomFields([{ key: "t", label: "T", type: "select" }])).toEqual([
      { key: "t", label: "T", type: "select", options: [] },
    ]);
  });

  it("options ignorées pour un type non-select", () => {
    expect(normalizeCustomFields([{ key: "t", label: "T", type: "text", options: ["a"] }])).toEqual([
      { key: "t", label: "T", type: "text" },
    ]);
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

describe("customFieldToSchemaField (select)", () => {
  it("propage les options d'un select", () => {
    expect(
      customFieldToSchemaField({ key: "t", label: "T", type: "select", options: ["A", "B"] }),
    ).toEqual({ key: "t", label: "T", type: "select", required: false, options: ["A", "B"] });
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

  it("rejette un select sans option", () => {
    expect(
      validateCustomFields([{ key: "t", label: "Type", type: "select", options: [] }]),
    ).toMatch(/option/);
    expect(
      validateCustomFields([{ key: "t", label: "Type", type: "select", options: ["Maison"] }]),
    ).toBeNull();
  });
});

describe("validateFieldValues", () => {
  const schema: CustomField[] = [
    { key: "titre", label: "Titre", type: "text", required: true },
    { key: "type_bien", label: "Type de bien", type: "select", required: false, options: ["Maison", "Appartement"] },
  ];

  it("valide des valeurs conformes", () => {
    expect(
      validateFieldValues(schema, { titre: "Villa", type_bien: "Maison" }, { requireRequired: true }),
    ).toBeNull();
  });

  it("requireRequired : rejette un requis vide/absent", () => {
    expect(validateFieldValues(schema, {}, { requireRequired: true })).toMatch(/Titre/);
    expect(validateFieldValues(schema, { titre: "  " }, { requireRequired: true })).toMatch(/Titre/);
  });

  it("sans requireRequired : requis absent toléré (édition)", () => {
    expect(validateFieldValues(schema, {})).toBeNull();
  });

  it("select : valeur hors options rejetée, vide toléré si non requis", () => {
    expect(validateFieldValues(schema, { titre: "V", type_bien: "Chalet" })).toMatch(/Chalet/);
    expect(validateFieldValues(schema, { titre: "V", type_bien: "" })).toBeNull();
  });

  it("clés inconnues : rejetées par défaut, tolérées avec allowUnknownKeys", () => {
    expect(validateFieldValues(schema, { titre: "V", legacy: "x" })).toMatch(/legacy/);
    expect(
      validateFieldValues(schema, { titre: "V", legacy: "x" }, { allowUnknownKeys: true }),
    ).toBeNull();
  });

  it("schéma vide : tout est accepté (type sans schéma configuré)", () => {
    expect(validateFieldValues([], { libre: "x" })).toBeNull();
  });
});
