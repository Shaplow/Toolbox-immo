import { describe, it, expect } from "vitest";
import { buildLowerKeyMap, canAssignFieldValue, matchFieldValue } from "@/lib/generate/matchFieldValue";
import type { SchemaField } from "@/types/template";

const TEXT_FIELD: SchemaField = { key: "prix", label: "Prix", type: "text", required: false };
const SELECT_FIELD: SchemaField = {
  key: "quartier",
  label: "Quartier",
  type: "select",
  required: false,
  options: ["Centre", "Périphérie"],
};

describe("matchFieldValue", () => {
  it("matche une clé exacte", () => {
    const source = { prix: "350000" };
    expect(matchFieldValue(TEXT_FIELD, source, buildLowerKeyMap(source))).toBe("350000");
  });

  it("retombe sur un match insensible à la casse", () => {
    const source = { Prix: "350000" };
    expect(matchFieldValue(TEXT_FIELD, source, buildLowerKeyMap(source))).toBe("350000");
  });

  it("retourne undefined quand aucune clé ne matche", () => {
    const source = { surface: "80" };
    expect(matchFieldValue(TEXT_FIELD, source, buildLowerKeyMap(source))).toBeUndefined();
  });

  it("normalise une valeur select vers la casse canonique de l'option", () => {
    const source = { quartier: "centre" };
    expect(matchFieldValue(SELECT_FIELD, source, buildLowerKeyMap(source))).toBe("Centre");
  });

  it("laisse une valeur select non reconnue telle quelle (pas d'option correspondante)", () => {
    const source = { quartier: "Ailleurs" };
    expect(matchFieldValue(SELECT_FIELD, source, buildLowerKeyMap(source))).toBe("Ailleurs");
  });

  it("ignore les valeurs null/undefined dans buildLowerKeyMap", () => {
    const source = { prix: undefined, surface: null as unknown as string, quartier: "Centre" };
    const map = buildLowerKeyMap(source);
    expect(map.has("prix")).toBe(false);
    expect(map.has("surface")).toBe(false);
    expect(map.get("quartier")).toBe("Centre");
  });
});

describe("canAssignFieldValue", () => {
  it("autorise toujours quand la valeur existante est vide", () => {
    expect(canAssignFieldValue("", undefined, "dataEntry")).toBe(true);
    expect(canAssignFieldValue(undefined, "entity", "dataEntry")).toBe(true);
    expect(canAssignFieldValue(null, "manual", "assetMetadata")).toBe(true);
  });

  it("refuse par défaut une valeur non vide sans provenance connue (legacy conservateur)", () => {
    expect(canAssignFieldValue("Paris", undefined, "dataEntry")).toBe(false);
  });

  it("délègue à canOverride quand une provenance est connue", () => {
    // entity (fort) ne doit pas être écrasé par dataEntry (faible)
    expect(canAssignFieldValue("Paris", "entity", "dataEntry")).toBe(false);
    // assetMetadata (faible) doit être écrasé par entity (fort)
    expect(canAssignFieldValue("Paris", "assetMetadata", "entity")).toBe(true);
  });
});
