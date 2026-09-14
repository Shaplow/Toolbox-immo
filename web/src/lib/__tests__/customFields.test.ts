import { describe, it, expect } from "vitest";
import {
  normalizeCustomFields,
  customFieldToSchemaField,
  validateCustomFields,
  validateFieldValues,
  inferDefaultFieldType,
  type CustomField,
  isNumericFieldValue,
  isPartialNumericInput,
  isCheckedFieldValue,
  isFieldFilled,
  validateFieldValuesAll,
  CHECKBOX_TRUE,
  MAX_DESCRIPTION,
  MAX_PLACEHOLDER,
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

describe("isNumericFieldValue", () => {
  it("accepte les formats numériques réellement saisis", () => {
    for (const v of ["68", "68,5", "68.5", "1 200", "1 200,50", "-5", "0", "007"]) {
      expect(isNumericFieldValue(v)).toBe(true);
    }
  });

  it("refuse tout ce qui n'est pas un nombre", () => {
    // « 68 m² », « abc12 » et « 120-150 » sont précisément les valeurs que
    // toFlexibleNumber coerce (en 68, 12 et 120150) : le confondre avec un
    // validateur laisserait passer exactement ce qu'on veut bloquer.
    for (const v of ["abc", "68 m²", "abc12", "12abc", "120-150", "1.2.3", "12%", "N/A"]) {
      expect(isNumericFieldValue(v)).toBe(false);
    }
  });
});

describe("isPartialNumericInput", () => {
  it("laisse taper les états intermédiaires", () => {
    for (const v of ["", "-", "6", "68", "68,", "68,5", "1 200", "-3."]) {
      expect(isPartialNumericInput(v)).toBe(true);
    }
  });

  it("bloque dès le caractère fautif", () => {
    for (const v of ["a", "68a", "68 m", "1,2,", "--5"]) {
      expect(isPartialNumericInput(v)).toBe(false);
    }
  });
});

describe("validateFieldValues — champs number", () => {
  const schema: CustomField[] = [
    { key: "surface", label: "Surface", type: "number" },
    { key: "type_bien", label: "Type de bien", type: "select", options: ["Maison"] },
  ];

  it("rejette du texte dans un champ nombre", () => {
    expect(validateFieldValues(schema, { surface: "abc" })).toMatch(/Surface/);
    expect(validateFieldValues(schema, { surface: "68 m²" })).toMatch(/Surface/);
    expect(validateFieldValues(schema, { surface: "120-150" })).toMatch(/Surface/);
  });

  it("accepte les nombres, virgule française comprise", () => {
    expect(validateFieldValues(schema, { surface: "68" })).toBeNull();
    expect(validateFieldValues(schema, { surface: "1 200,50" })).toBeNull();
    expect(validateFieldValues(schema, { surface: "-3.5" })).toBeNull();
  });

  it("vide toléré quand le champ n'est pas requis", () => {
    expect(validateFieldValues(schema, { surface: "" })).toBeNull();
    expect(validateFieldValues(schema, {})).toBeNull();
  });

  it("valeur historique invalide INCHANGÉE : tolérée", () => {
    // Le formulaire renvoie l'objet complet : sans ça, éditer n'importe quel
    // autre champ d'une fiche ancienne deviendrait impossible.
    expect(
      validateFieldValues(schema, { surface: "68 m²" }, { previousValues: { surface: "68 m²" } }),
    ).toBeNull();
  });

  it("valeur historique invalide MODIFIÉE : rejetée", () => {
    expect(
      validateFieldValues(schema, { surface: "70 m²" }, { previousValues: { surface: "68 m²" } }),
    ).toMatch(/Surface/);
  });

  it("la tolérance ne déborde pas sur les choix fermés", () => {
    // Un court-circuit générique « valeur inchangée » ouvrirait le seul filtre
    // de forme appliqué aux données d'un client externe.
    expect(
      validateFieldValues(
        schema,
        { type_bien: "Chalet" },
        { previousValues: { type_bien: "Chalet" } },
      ),
    ).toMatch(/Chalet/);
  });
});

describe("checkbox — un booléen qui reste une string", () => {
  it("normalise le type checkbox", () => {
    expect(normalizeCustomFields([{ key: "ok", label: "OK", type: "checkbox" }])).toEqual([
      { key: "ok", label: "OK", type: "checkbox" },
    ]);
  });

  // Le mapping vers SchemaField est l'identité PARTOUT SAUF ici : `checkbox`
  // n'existe pas côté SchemaFieldType.
  it("customFieldToSchemaField : checkbox → boolean", () => {
    expect(customFieldToSchemaField({ key: "ok", label: "OK", type: "checkbox" })).toEqual({
      key: "ok",
      label: "OK",
      type: "boolean",
      required: false,
    });
  });

  it("seules \"\" et \"true\" sont des valeurs acceptables", () => {
    const schema: CustomField[] = [{ key: "ok", label: "OK", type: "checkbox" }];
    expect(validateFieldValues(schema, { ok: CHECKBOX_TRUE })).toBeNull();
    expect(validateFieldValues(schema, { ok: "" })).toBeNull();
    expect(validateFieldValues(schema, { ok: "oui" })).toMatch(/invalide pour la case/);
  });

  it("isCheckedFieldValue ne reconnaît que \"true\"", () => {
    expect(isCheckedFieldValue(CHECKBOX_TRUE)).toBe(true);
    for (const v of ["", "false", "1", "TRUE", null, undefined]) {
      expect(isCheckedFieldValue(v)).toBe(false);
    }
  });

  // `required` sur une case signifie « doit être cochée » (HTML natif, Tally) —
  // pas « doit avoir une valeur », sinon décocher suffirait à la satisfaire.
  it("un checkbox requis mais décoché bloque", () => {
    const schema: CustomField[] = [
      { key: "ok", label: "J'accepte", type: "checkbox", required: true },
    ];
    expect(validateFieldValues(schema, { ok: "" }, { requireRequired: true })).toMatch(
      /doit être cochée/,
    );
    expect(
      validateFieldValues(schema, { ok: CHECKBOX_TRUE }, { requireRequired: true }),
    ).toBeNull();
  });

  it("isFieldFilled : coché pour un checkbox, non vide pour le reste", () => {
    expect(isFieldFilled({ key: "a", label: "A", type: "checkbox" }, CHECKBOX_TRUE)).toBe(true);
    expect(isFieldFilled({ key: "a", label: "A", type: "checkbox" }, "")).toBe(false);
    expect(isFieldFilled({ key: "a", label: "A", type: "text" }, "x")).toBe(true);
    expect(isFieldFilled({ key: "a", label: "A", type: "text" }, "")).toBe(false);
  });
});

describe("description (texte d'aide)", () => {
  it("est conservée, trimée, et bornée", () => {
    const [f] = normalizeCustomFields([
      { key: "a", label: "A", type: "text", description: "  Aide  " },
    ]);
    expect(f.description).toBe("Aide");

    const [long] = normalizeCustomFields([
      { key: "b", label: "B", type: "text", description: "x".repeat(500) },
    ]);
    expect(long.description).toHaveLength(MAX_DESCRIPTION);
  });

  it("une description vide n'est pas posée", () => {
    const [f] = normalizeCustomFields([{ key: "a", label: "A", type: "text", description: "   " }]);
    expect(f).not.toHaveProperty("description");
  });

  // SchemaField porte déjà `description` : elle était jetée à la conversion.
  it("est propagée vers SchemaField", () => {
    expect(
      customFieldToSchemaField({ key: "a", label: "A", type: "text", description: "Aide" }),
    ).toEqual({ key: "a", label: "A", type: "text", required: false, description: "Aide" });
  });
});

describe("validateFieldValuesAll", () => {
  const schema: CustomField[] = [
    { key: "a", label: "A", type: "text", required: true },
    { key: "b", label: "B", type: "number", required: true },
    { key: "c", label: "C", type: "select", options: ["X"] },
  ];

  // La raison d'être de la fonction : un formulaire doit pouvoir montrer TOUS
  // ses champs fautifs d'un coup, pas les découvrir un par un.
  it("remonte une erreur par clé, pas seulement la première", () => {
    const errors = validateFieldValuesAll(schema, { a: "", b: "", c: "Z" }, { requireRequired: true });
    expect(Object.keys(errors).sort()).toEqual(["a", "b", "c"]);
  });

  it("aucune erreur sur des valeurs valides", () => {
    expect(
      validateFieldValuesAll(schema, { a: "x", b: "12", c: "X" }, { requireRequired: true }),
    ).toEqual({});
  });

  // validateFieldValues en dérive : les deux ne peuvent pas diverger, et le
  // message rendu suit l'ordre DU SCHÉMA, pas celui des clés de l'objet.
  it("validateFieldValues rend la première erreur dans l'ordre du schéma", () => {
    expect(validateFieldValues(schema, { c: "Z", a: "", b: "" }, { requireRequired: true })).toMatch(
      /« A » est requis/,
    );
  });

  it("une clé hors schéma l'emporte sur le reste", () => {
    const errors = validateFieldValuesAll(schema, { zzz: "1" }, { requireRequired: true });
    expect(errors.__unknown).toMatch(/Champ inconnu/);
    expect(validateFieldValues(schema, { zzz: "1" })).toMatch(/Champ inconnu/);
  });
});

describe("placeholder (exemple de saisie)", () => {
  it("est conservé, trimé, et borné plus court que l'aide", () => {
    const [f] = normalizeCustomFields([
      { key: "a", label: "A", type: "text", placeholder: "  12 rue des Lilas  " },
    ]);
    expect(f.placeholder).toBe("12 rue des Lilas");

    const [long] = normalizeCustomFields([
      { key: "b", label: "B", type: "text", placeholder: "x".repeat(500) },
    ]);
    // Plus court que MAX_DESCRIPTION : un placeholder vit DANS un input d'une
    // ligne, au-delà il déborde au lieu d'aider.
    expect(long.placeholder).toHaveLength(MAX_PLACEHOLDER);
    expect(MAX_PLACEHOLDER).toBeLessThan(MAX_DESCRIPTION);
  });

  it("un placeholder vide n'est pas posé", () => {
    const [f] = normalizeCustomFields([
      { key: "a", label: "A", type: "text", placeholder: "   " },
    ]);
    expect(f).not.toHaveProperty("placeholder");
  });

  // SchemaField porte `placeholder` depuis toujours : il n'était pas alimenté.
  it("est propagé vers SchemaField", () => {
    expect(
      customFieldToSchemaField({ key: "a", label: "A", type: "text", placeholder: "Ex : 120" }),
    ).toEqual({ key: "a", label: "A", type: "text", required: false, placeholder: "Ex : 120" });
  });

  it("aide et exemple coexistent sans se confondre", () => {
    const [f] = normalizeCustomFields([
      {
        key: "prix",
        label: "Prix",
        type: "number",
        description: "Prix net vendeur, sans les frais",
        placeholder: "250000",
      },
    ]);
    expect(f.description).toBe("Prix net vendeur, sans les frais");
    expect(f.placeholder).toBe("250000");
  });
});

/**
 * L'ordre du tableau EST l'ordre d'affichage des champs partout, et c'est ce
 * que réordonne `CustomFieldsSchemaEditor` (il n'y a pas de colonne `position`).
 * Une normalisation qui trierait ou regrouperait les champs casserait le
 * réordonnancement sans que rien d'autre ne le signale.
 */
describe("normalizeCustomFields — l'ordre est un contrat", () => {
  it("préserve l'ordre reçu, y compris contre l'ordre alphabétique", () => {
    const input = [
      { key: "zebre", label: "Zèbre", type: "text" },
      { key: "alpha", label: "Alpha", type: "text" },
      { key: "milieu", label: "Milieu", type: "text" },
    ];
    expect(normalizeCustomFields(input).map((f) => f.key)).toEqual([
      "zebre",
      "alpha",
      "milieu",
    ]);
  });

  it("préserve l'ordre du format legacy plat", () => {
    expect(normalizeCustomFields(["b", "a", "c"]).map((f) => f.key)).toEqual(["b", "a", "c"]);
  });

  it("retirer un doublon ne décale pas les autres", () => {
    const input = [
      { key: "a", label: "A", type: "text" },
      { key: "b", label: "B", type: "text" },
      { key: "a", label: "A bis", type: "text" },
      { key: "c", label: "C", type: "text" },
    ];
    expect(normalizeCustomFields(input).map((f) => f.key)).toEqual(["a", "b", "c"]);
  });
});
