import { describe, expect, it } from "vitest";
import { DOSSIER_COLUMN_KEY, buildDataSheet, sanitizeSheetName } from "../dataSheet";

const schema = (fields: Array<{ key: string; label?: string; type?: string }>) =>
  JSON.stringify(fields.map((f) => ({ type: "text", ...f })));

const entry = (fields: unknown, setTag: string | null = null) => ({
  fields: typeof fields === "string" ? fields : JSON.stringify(fields),
  setTag,
});

describe("buildDataSheet — colonnes", () => {
  it("« Dossier » d'abord, puis les champs du schéma dans l'ordre déclaré, avec leur libellé", () => {
    const { columns } = buildDataSheet({
      fieldsSchema: schema([
        { key: "quartier", label: "Quartier" },
        { key: "prix_m2", label: "Prix au m²", type: "number" },
        { key: "evo", label: "Évolution sur 5 ans" },
      ]),
      entries: [],
    });
    expect(columns).toEqual([
      { key: DOSSIER_COLUMN_KEY, label: "Dossier" },
      { key: "quartier", label: "Quartier" },
      { key: "prix_m2", label: "Prix au m²" },
      { key: "evo", label: "Évolution sur 5 ans" },
    ]);
    expect(DOSSIER_COLUMN_KEY).toBe("__dossier");
  });

  it("le libellé retombe sur la clé", () => {
    const { columns } = buildDataSheet({ fieldsSchema: JSON.stringify([{ key: "quartier", type: "text" }]), entries: [] });
    expect(columns[1]).toEqual({ key: "quartier", label: "quartier" });
  });

  it("accepte l'ancien schéma plat (liste de noms)", () => {
    const { columns } = buildDataSheet({ fieldsSchema: JSON.stringify(["quartier", "prix"]), entries: [] });
    expect(columns).toEqual([
      { key: DOSSIER_COLUMN_KEY, label: "Dossier" },
      { key: "quartier", label: "quartier" },
      { key: "prix", label: "prix" },
    ]);
  });

  it("sans schéma : union des clés des fiches dans l'ordre d'apparition, hors set_tag et category", () => {
    const { columns } = buildDataSheet({
      fieldsSchema: "[]",
      entries: [
        entry({ set_tag: "x", quartier: "A", category: "c" }),
        entry({ prix: 1, quartier: "B" }),
        entry({ evo: 2, prix: 3 }),
      ],
    });
    expect(columns.map((c) => c.key)).toEqual([DOSSIER_COLUMN_KEY, "quartier", "prix", "evo"]);
    expect(columns.slice(1).every((c) => c.label === c.key)).toBe(true);
  });

  it("sans schéma exploitable (JSON illisible, pas une liste) : même repli", () => {
    for (const fieldsSchema of ["", "pas du json", "{}", "null", '{"a":1}']) {
      const { columns } = buildDataSheet({ fieldsSchema, entries: [entry({ quartier: "A" })] });
      expect(columns.map((c) => c.key), fieldsSchema).toEqual([DOSSIER_COLUMN_KEY, "quartier"]);
    }
  });

  it("avec un schéma, les clés en trop dans les fiches sont ignorées", () => {
    const { columns, rows } = buildDataSheet({
      fieldsSchema: schema([{ key: "quartier" }]),
      entries: [entry({ quartier: "A", autre: "B" })],
    });
    expect(columns.map((c) => c.key)).toEqual([DOSSIER_COLUMN_KEY, "quartier"]);
    expect(rows).toEqual([["", "A"]]);
  });

  it("aucune fiche et aucun schéma : seule la colonne Dossier", () => {
    expect(buildDataSheet({ fieldsSchema: "[]", entries: [] })).toEqual({
      columns: [{ key: DOSSIER_COLUMN_KEY, label: "Dossier" }],
      rows: [],
    });
  });
});

describe("buildDataSheet — lignes", () => {
  const fieldsSchema = schema([{ key: "quartier", label: "Quartier" }, { key: "prix", label: "Prix" }]);

  it("une ligne par fiche, dans l'ordre reçu, avec le Dossier en premier", () => {
    const { rows } = buildDataSheet({
      fieldsSchema,
      entries: [
        entry({ quartier: "Centre", prix: "4200" }, "Paris"),
        entry({ quartier: "Gare", prix: "3100" }, null),
        entry({ prix: "2500" }, "Lyon"),
      ],
    });
    expect(rows).toEqual([
      ["Paris", "Centre", "4200"],
      ["", "Gare", "3100"],
      ["Lyon", "", "2500"],
    ]);
  });

  it("nombres et booléens en toutes lettres, objets en JSON, null et absent en vide", () => {
    const { rows } = buildDataSheet({
      fieldsSchema: schema([{ key: "n" }, { key: "f" }, { key: "t" }, { key: "o" }, { key: "a" }, { key: "z" }, { key: "u" }, { key: "s" }]),
      entries: [entry({ n: 4200.5, f: false, t: true, o: { x: 1, y: ["a"] }, a: [1, 2], z: null, s: "texte" })],
    });
    expect(rows).toEqual([["", "4200.5", "false", "true", '{"x":1,"y":["a"]}', "[1,2]", "", "", "texte"]]);
  });

  it("zéro et chaîne vide sont gardés (ce ne sont pas des valeurs manquantes)", () => {
    const { rows } = buildDataSheet({
      fieldsSchema: schema([{ key: "n" }, { key: "s" }]),
      entries: [entry({ n: 0, s: "" })],
    });
    expect(rows).toEqual([["", "0", ""]]);
  });

  it("des `fields` illisibles donnent une ligne de cellules vides, sans lever d'exception", () => {
    const entries = [
      entry("pas du json", "Paris"),
      entry("", null),
      entry("[1,2]", null),
      entry("42", null),
      entry("null", null),
      entry('"texte"', null),
      entry({ quartier: "ok" }, null),
    ];
    expect(() => buildDataSheet({ fieldsSchema, entries })).not.toThrow();
    const { rows } = buildDataSheet({ fieldsSchema, entries });
    expect(rows).toEqual([
      ["Paris", "", ""],
      ["", "", ""],
      ["", "", ""],
      ["", "", ""],
      ["", "", ""],
      ["", "", ""],
      ["", "ok", ""],
    ]);
  });

  it("des `fields` illisibles ne comptent pas dans l'union des clés", () => {
    const { columns } = buildDataSheet({
      fieldsSchema: "[]",
      entries: [entry("pas du json"), entry("[1]"), entry({ quartier: "A" })],
    });
    expect(columns.map((c) => c.key)).toEqual([DOSSIER_COLUMN_KEY, "quartier"]);
  });

  it("masque les anciens dossiers auto-générés (pack_*), garde les autres", () => {
    const { rows } = buildDataSheet({
      fieldsSchema,
      entries: [entry({ quartier: "A" }, "pack_3f2a"), entry({ quartier: "B" }, "packs"), entry({ quartier: "C" }, "  Paris  ")],
    });
    expect(rows.map((row) => row[0])).toEqual(["", "packs", "Paris"]);
  });

  it("chaque ligne a autant de cellules que de colonnes", () => {
    const { columns, rows } = buildDataSheet({
      fieldsSchema: "[]",
      entries: [entry({ a: 1 }), entry({ b: 2, c: 3 }), entry("cassé")],
    });
    for (const row of rows) expect(row).toHaveLength(columns.length);
    expect(rows).toEqual([
      ["", "1", "", ""],
      ["", "", "2", "3"],
      ["", "", "", ""],
    ]);
  });

  it("ne remonte pas le prototype pour une clé comme « constructor »", () => {
    const { rows } = buildDataSheet({
      fieldsSchema: schema([{ key: "constructor" }, { key: "toString" }, { key: "__proto__" }]),
      entries: [entry({ autre: 1 })],
    });
    expect(rows).toEqual([["", "", "", ""]]);
  });

  it("lit une clé « __proto__ » portée par les données comme n'importe quelle autre", () => {
    const { columns, rows } = buildDataSheet({
      fieldsSchema: "[]",
      entries: [entry('{"__proto__":"p","a":"b"}')],
    });
    expect(columns.map((c) => c.key)).toEqual([DOSSIER_COLUMN_KEY, "__proto__", "a"]);
    expect(rows).toEqual([["", "p", "b"]]);
  });

  it("retire les caractères que XML interdit, garde tabulations et retours à la ligne", () => {
    const { rows } = buildDataSheet({
      fieldsSchema: schema([{ key: "a" }]),
      entries: [entry({ a: "ligne 1\nligne 2\tfin\u0000\u0007\u001f\uFFFF\uD800" }, "Do\u0001ssier")],
    });
    expect(rows).toEqual([["Dossier", "ligne 1\nligne 2\tfin"]]);
  });

  it("plafonne une cellule à 32 767 caractères sans couper un emoji en deux", () => {
    const long = "x".repeat(40_000);
    const emoji = `${"x".repeat(32_766)}\u{1F600}`;
    const { rows } = buildDataSheet({
      fieldsSchema: schema([{ key: "a" }, { key: "b" }]),
      entries: [entry({ a: long, b: emoji })],
    });
    expect(rows[0][1]).toHaveLength(32_767);
    expect(rows[0][2]).toBe("x".repeat(32_766));
  });

  it("garde accents et caractères non latins", () => {
    const { rows } = buildDataSheet({
      fieldsSchema: schema([{ key: "ville" }]),
      entries: [entry({ ville: "Saint-Étienne — 東京 🏠" }, "Été")],
    });
    expect(rows).toEqual([["Été", "Saint-Étienne — 東京 🏠"]]);
  });
});

describe("sanitizeSheetName", () => {
  it("retire [ ] : * ? / \\ (sans les remplacer)", () => {
    expect(sanitizeSheetName("Prix [€/m²]: Paris*?")).toBe("Prix €m² Paris");
    expect(sanitizeSheetName("a\\b/c")).toBe("abc");
    expect(sanitizeSheetName("[]:*?/\\x")).toBe("x");
  });

  it("coupe à 31 caractères", () => {
    expect(sanitizeSheetName("A".repeat(60))).toBe("A".repeat(31));
    expect(sanitizeSheetName("A".repeat(31))).toBe("A".repeat(31));
    expect(sanitizeSheetName("Quartiers parisiens et banlieue proche")).toBe("Quartiers parisiens et banlieue");
    // Une espace qui tombe à la coupe n'est pas gardée.
    expect(sanitizeSheetName("Fiches quartiers Île-de-France 2026")).toBe("Fiches quartiers Île-de-France");
  });

  it("ne coupe pas un emoji en deux", () => {
    expect(sanitizeSheetName(`${"A".repeat(30)}\u{1F600}`)).toBe("A".repeat(30));
    expect(sanitizeSheetName(`${"A".repeat(29)}\u{1F600}`)).toBe(`${"A".repeat(29)}\u{1F600}`);
  });

  it("repli « Données » quand il ne reste rien", () => {
    for (const name of ["", "   ", "[]", ":*?", "'", "''", " ' ", "\u0000"]) {
      expect(sanitizeSheetName(name), JSON.stringify(name)).toBe("Données");
    }
  });

  it("« History » est réservé par Excel", () => {
    expect(sanitizeSheetName("History")).toBe("Données");
    expect(sanitizeSheetName("history")).toBe("Données");
    expect(sanitizeSheetName("  HISTORY ")).toBe("Données");
    expect(sanitizeSheetName("Historique")).toBe("Historique");
    expect(sanitizeSheetName("History 2026")).toBe("History 2026");
  });

  it("pas d'apostrophe en début ni en fin de nom (Excel le refuse)", () => {
    expect(sanitizeSheetName("'Quartiers'")).toBe("Quartiers");
    expect(sanitizeSheetName("L'agence")).toBe("L'agence");
    // La coupe peut découvrir une apostrophe ou une espace de fin.
    expect(sanitizeSheetName(`${"A".repeat(30)}' suite`)).toBe("A".repeat(30));
    expect(sanitizeSheetName(`${"A".repeat(29)} bcd`)).toBe(`${"A".repeat(29)} b`);
  });

  it("retire les caractères de contrôle et garde accents et espaces intérieurs", () => {
    expect(sanitizeSheetName("Prix\u0007 au m²")).toBe("Prix au m²");
    expect(sanitizeSheetName("Données Île-de-France")).toBe("Données Île-de-France");
  });

  it("ne lève pas sur une entrée démesurée ou non textuelle", () => {
    expect(sanitizeSheetName("x".repeat(1_000_000))).toBe("x".repeat(31));
    expect(sanitizeSheetName(undefined as unknown as string)).toBe("Données");
    expect(sanitizeSheetName(null as unknown as string)).toBe("Données");
  });
});
