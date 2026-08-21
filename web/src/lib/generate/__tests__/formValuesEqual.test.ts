/**
 * B.3 (P6 fix) — la garde beforeunload comparait `JSON.stringify(values)` à
 * `JSON.stringify(initialValues)` : deux objets qui n'ont quasiment jamais le
 * même jeu de clés (values = TOUJOURS une entrée par champ, y compris vide ;
 * initialValues = seulement les clés pré-remplies). Résultat : la garde
 * restait armée en permanence, même sans aucune édition.
 */
import { describe, it, expect } from "vitest";
import { valuesEqualIgnoringEmpty } from "@/lib/generate/formValuesEqual";

describe("valuesEqualIgnoringEmpty", () => {
  it("traite un formulaire fraîchement chargé (clés vides en trop) comme identique", () => {
    // `values` porte une entrée pour CHAQUE champ du schéma (resolveInitialFieldValue),
    // `initialValues` seulement les clés pré-remplies côté serveur — c'est le
    // bug exact de B.3.
    const values = { prix: "350000", surface: "", agent: "", description: "" };
    const initialValues = { prix: "350000" };
    expect(valuesEqualIgnoringEmpty(values, initialValues)).toBe(true);
  });

  it("détecte une vraie édition", () => {
    const values = { prix: "360000" };
    const initialValues = { prix: "350000" };
    expect(valuesEqualIgnoringEmpty(values, initialValues)).toBe(false);
  });

  it("traite undefined/null/'' comme équivalents", () => {
    expect(valuesEqualIgnoringEmpty({ a: "" }, { a: undefined })).toBe(true);
    expect(valuesEqualIgnoringEmpty({ a: null }, { a: "" })).toBe(true);
    expect(valuesEqualIgnoringEmpty({ a: undefined }, {})).toBe(true);
  });

  it("ignore une clé absente d'un des deux côtés quand elle est vide", () => {
    expect(valuesEqualIgnoringEmpty({ a: "1", b: "" }, { a: "1" })).toBe(true);
  });

  it("détecte une clé absente d'un côté mais remplie de l'autre", () => {
    expect(valuesEqualIgnoringEmpty({ a: "1", b: "2" }, { a: "1" })).toBe(false);
  });

  it("compare structurellement les objets (ex. focal point)", () => {
    expect(
      valuesEqualIgnoringEmpty({ fp: { x: 0.5, y: 0.5 } }, { fp: { x: 0.5, y: 0.5 } }),
    ).toBe(true);
    expect(
      valuesEqualIgnoringEmpty({ fp: { x: 0.5, y: 0.5 } }, { fp: { x: 0.1, y: 0.5 } }),
    ).toBe(false);
  });

  it("distingue false/0 d'une valeur vide (pas juste falsy)", () => {
    expect(valuesEqualIgnoringEmpty({ a: false }, { a: "" })).toBe(false);
    expect(valuesEqualIgnoringEmpty({ a: 0 }, { a: "" })).toBe(false);
  });
});
