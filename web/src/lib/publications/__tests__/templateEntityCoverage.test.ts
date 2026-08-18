/**
 * Tests computeTemplateEntityCoverage — diagnostic « ce champ du template
 * sera-t-il alimenté par le type de fiche exigé ? ». Vérifie que le
 * diagnostic dit la VÉRITÉ : mêmes règles que `enrichListingWithEntityFields`
 * (entitySource → accès direct par clé, aucun repli casse) et
 * `matchFieldValue` (implicite → exact puis repli case-insensitive).
 */

import { describe, it, expect } from "vitest";
import { computeTemplateEntityCoverage } from "../templateEntityCoverage";
import type { SchemaField } from "@/types/template";

function field(overrides: Partial<SchemaField> & { key: string }): SchemaField {
  return { label: overrides.key, type: "text", required: false, ...overrides };
}

describe("computeTemplateEntityCoverage", () => {
  it("marque 'keyMatch' un champ sans entitySource dont la clé matche exactement", () => {
    const result = computeTemplateEntityCoverage(
      [field({ key: "prix" })],
      [{ key: "prix", label: "Prix" }],
    );
    expect(result).toEqual([{ key: "prix", label: "prix", status: "keyMatch" }]);
  });

  it("marque 'keyMatch' un champ sans entitySource qui matche par repli case-insensitive", () => {
    const result = computeTemplateEntityCoverage(
      [field({ key: "Prix" })],
      [{ key: "prix", label: "Prix" }],
    );
    expect(result[0].status).toBe("keyMatch");
  });

  it("marque 'uncovered' un champ sans entitySource et sans clé correspondante", () => {
    const result = computeTemplateEntityCoverage(
      [field({ key: "surface" })],
      [{ key: "prix", label: "Prix" }],
    );
    expect(result[0].status).toBe("uncovered");
  });

  it("marque 'entitySource' un champ dont l'entitySource (slot data) pointe une clé existante", () => {
    const result = computeTemplateEntityCoverage(
      [field({ key: "titre", entitySource: { slot: "data", fieldKey: "adresse" } })],
      [{ key: "adresse", label: "Adresse" }],
    );
    expect(result[0].status).toBe("entitySource");
  });

  it("marque 'uncovered' un entitySource (slot data) dont la clé N'EXISTE PAS dans la fiche — pas de repli casse", () => {
    // enrichListingWithEntityFields lit `entityFields[entitySource.fieldKey]` par
    // accès direct : une casse différente (Adresse vs adresse) ne doit PAS matcher
    // ici, contrairement au repli implicite de matchFieldValue.
    const result = computeTemplateEntityCoverage(
      [field({ key: "titre", entitySource: { slot: "data", fieldKey: "Adresse" } })],
      [{ key: "adresse", label: "Adresse" }],
    );
    expect(result[0].status).toBe("uncovered");
  });

  it("marque 'shootEntitySource' un entitySource pointant la fiche tournage, hors scope du diagnostic data", () => {
    const result = computeTemplateEntityCoverage(
      [field({ key: "titre", entitySource: { slot: "shoot", fieldKey: "date_tournage" } })],
      [{ key: "adresse", label: "Adresse" }],
    );
    expect(result[0].status).toBe("shootEntitySource");
  });

  it("traite chaque champ du template indépendamment", () => {
    const schema: SchemaField[] = [
      field({ key: "prix" }),
      field({ key: "titre", entitySource: { slot: "data", fieldKey: "adresse" } }),
      field({ key: "surface" }),
    ];
    const result = computeTemplateEntityCoverage(schema, [
      { key: "prix", label: "Prix" },
      { key: "adresse", label: "Adresse" },
    ]);
    expect(result.map((f) => f.status)).toEqual(["keyMatch", "entitySource", "uncovered"]);
  });

  it("liste vide de champs de fiche → tout est 'uncovered' (sauf shootEntitySource)", () => {
    const result = computeTemplateEntityCoverage(
      [field({ key: "prix" }), field({ key: "x", entitySource: { slot: "shoot", fieldKey: "y" } })],
      [],
    );
    expect(result.map((f) => f.status)).toEqual(["uncovered", "shootEntitySource"]);
  });
});
