/**
 * Tests buildEntityFieldEntries — projection en lecture seule des champs
 * d'une fiche pour EntityFieldsSection : ordre schéma d'abord (avec
 * libellés), puis clés brutes hors schéma, filtrage des valeurs vides.
 */

import { describe, it, expect } from "vitest";
import { buildEntityFieldEntries } from "../entityFieldsSummary";

describe("buildEntityFieldEntries", () => {
  it("résout le libellé depuis le fieldSchema, dans l'ordre du schéma", () => {
    const fields = JSON.stringify({ prix: "350000", adresse: "12 rue de la Paix" });
    const schema = JSON.stringify([
      { key: "adresse", label: "Adresse", type: "text" },
      { key: "prix", label: "Prix (€)", type: "number" },
    ]);
    expect(buildEntityFieldEntries(fields, schema)).toEqual([
      { key: "adresse", label: "Adresse", value: "12 rue de la Paix" },
      { key: "prix", label: "Prix (€)", value: "350000" },
    ]);
  });

  it("filtre les valeurs vides/espaces", () => {
    const fields = JSON.stringify({ prix: "350000", notes: "   ", vide: "" });
    const schema = JSON.stringify([
      { key: "prix", label: "Prix", type: "text" },
      { key: "notes", label: "Notes", type: "textarea" },
      { key: "vide", label: "Vide", type: "text" },
    ]);
    expect(buildEntityFieldEntries(fields, schema)).toEqual([
      { key: "prix", label: "Prix", value: "350000" },
    ]);
  });

  it("conserve '0' et 'false' comme valeurs légitimes", () => {
    const fields = JSON.stringify({ etage: "0", meuble: "false" });
    const schema = JSON.stringify([
      { key: "etage", label: "Étage", type: "text" },
      { key: "meuble", label: "Meublé", type: "text" },
    ]);
    expect(buildEntityFieldEntries(fields, schema)).toEqual([
      { key: "etage", label: "Étage", value: "0" },
      { key: "meuble", label: "Meublé", value: "false" },
    ]);
  });

  it("ajoute les clés brutes absentes du schéma à la fin, sous leur nom de clé", () => {
    const fields = JSON.stringify({ adresse: "12 rue de la Paix", legacy_key: "valeur legacy" });
    const schema = JSON.stringify([{ key: "adresse", label: "Adresse", type: "text" }]);
    expect(buildEntityFieldEntries(fields, schema)).toEqual([
      { key: "adresse", label: "Adresse", value: "12 rue de la Paix" },
      { key: "legacy_key", label: "legacy_key", value: "valeur legacy" },
    ]);
  });

  it("champ du schéma sans valeur dans fields → absent du résultat", () => {
    const fields = JSON.stringify({ prix: "350000" });
    const schema = JSON.stringify([
      { key: "prix", label: "Prix", type: "text" },
      { key: "surface", label: "Surface", type: "number" },
    ]);
    expect(buildEntityFieldEntries(fields, schema)).toEqual([
      { key: "prix", label: "Prix", value: "350000" },
    ]);
  });

  it("tolère fields/fieldSchema null, undefined ou JSON invalide", () => {
    expect(buildEntityFieldEntries(null, null)).toEqual([]);
    expect(buildEntityFieldEntries(undefined, undefined)).toEqual([]);
    expect(buildEntityFieldEntries("{ pas du json", "[ pas du json")).toEqual([]);
  });

  it("libellé de schéma vide retombe sur la clé", () => {
    const fields = JSON.stringify({ prix: "350000" });
    const schema = JSON.stringify([{ key: "prix", label: "", type: "text" }]);
    expect(buildEntityFieldEntries(fields, schema)).toEqual([
      { key: "prix", label: "prix", value: "350000" },
    ]);
  });
});
