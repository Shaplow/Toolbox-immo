/**
 * buildSlotPrefill — matrice de précédence shootEntity < entity < slot.fields
 * < existingValues, matching case-insensitive des clés de fiche contre le
 * schéma cible, et tolérance au JSON malformé (fields legacy).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicationSlot: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
  },
}));

import { buildSlotPrefill, type SlotPrefillRecord } from "@/lib/generate/buildSlotPrefill";
import type { SchemaField } from "@/types/template";

const SCHEMA: SchemaField[] = [
  { key: "prix", label: "Prix", type: "text", required: false },
  {
    key: "quartier",
    label: "Quartier",
    type: "select",
    required: false,
    options: ["Centre", "Périphérie"],
  },
];

function makeSlot(overrides: Partial<SlotPrefillRecord> = {}): SlotPrefillRecord {
  return {
    accountId: "acc-1",
    fields: "{}",
    title: "Mon slot",
    account: { handle: "monteur_officiel" },
    entity: null,
    shootEntity: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildSlotPrefill — absence de slot", () => {
  it("retourne des couches vides et un slotBannerContext null quand ni slotId ni slot ne sont fournis", async () => {
    const result = await buildSlotPrefill({ schema: SCHEMA });

    expect(result.entityFields).toEqual({});
    expect(result.shootEntityFields).toEqual({});
    expect(result.customFormFields).toEqual([]);
    expect(result.initialValues).toEqual({});
    expect(result.provenance).toEqual({});
    expect(result.accountId).toBeUndefined();
    expect(result.slotBannerContext).toBeNull();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("applique quand même existingValues en l'absence de slot", async () => {
    const result = await buildSlotPrefill({
      schema: SCHEMA,
      existingValues: { prix: "200000" },
    });

    expect(result.initialValues.prix).toBe("200000");
    expect(result.provenance.prix).toBe("manual");
  });
});

describe("buildSlotPrefill — shootEntity seul", () => {
  it("pose les valeurs shootEntity avec la provenance 'shootEntity'", async () => {
    const slot = makeSlot({
      shootEntity: {
        fields: JSON.stringify({ prix: "100000" }),
        type: { fieldSchema: JSON.stringify([{ key: "prix", label: "Prix", type: "text" }]) },
      },
    });

    const result = await buildSlotPrefill({ slot, schema: SCHEMA });

    expect(result.shootEntityFields).toEqual({ prix: "100000" });
    expect(result.initialValues.prix).toBe("100000");
    expect(result.provenance.prix).toBe("shootEntity");
    expect(result.customFormFields).toEqual([{ key: "prix", label: "Prix", type: "text" }]);
  });
});

describe("buildSlotPrefill — entity + shootEntity en collision de clé", () => {
  it("entity l'emporte sur shootEntity pour la même clé (valeur ET customFormFields)", async () => {
    const slot = makeSlot({
      shootEntity: {
        fields: JSON.stringify({ prix: "100000" }),
        type: { fieldSchema: JSON.stringify([{ key: "prix", label: "Prix (tournage)", type: "text" }]) },
      },
      entity: {
        fields: JSON.stringify({ prix: "350000" }),
        type: { fieldSchema: JSON.stringify([{ key: "prix", label: "Prix (fiche)", type: "text" }]) },
      },
    });

    const result = await buildSlotPrefill({ slot, schema: SCHEMA });

    expect(result.initialValues.prix).toBe("350000");
    expect(result.provenance.prix).toBe("entity");
    expect(result.customFormFields).toEqual([{ key: "prix", label: "Prix (fiche)", type: "text" }]);
  });

  it("une clé propre à shootEntity (absente de entity) reste posée avec sa provenance", async () => {
    const slot = makeSlot({
      shootEntity: {
        fields: JSON.stringify({ prix: "100000", surface_tournage: "42" }),
        type: { fieldSchema: "[]" },
      },
      entity: {
        fields: JSON.stringify({ prix: "350000" }),
        type: { fieldSchema: "[]" },
      },
    });

    const result = await buildSlotPrefill({ slot, schema: SCHEMA });

    expect(result.initialValues.prix).toBe("350000");
    expect(result.provenance.prix).toBe("entity");
    expect(result.initialValues.surface_tournage).toBe("42");
    expect(result.provenance.surface_tournage).toBe("shootEntity");
  });
});

describe("buildSlotPrefill — matching case-insensitive et normalisation select", () => {
  it("une clé de fiche 'Prix' remplit le champ de template 'prix'", async () => {
    const slot = makeSlot({
      entity: {
        fields: JSON.stringify({ Prix: "350000" }),
        type: { fieldSchema: JSON.stringify([{ key: "Prix", label: "Prix", type: "text" }]) },
      },
    });

    const result = await buildSlotPrefill({ slot, schema: SCHEMA });

    expect(result.initialValues.prix).toBe("350000");
    expect(result.initialValues.Prix).toBeUndefined();
    expect(result.provenance.prix).toBe("entity");
  });

  it("normalise une valeur select de fiche vers la casse canonique de l'option", async () => {
    const slot = makeSlot({
      entity: {
        fields: JSON.stringify({ quartier: "centre" }),
        type: { fieldSchema: "[]" },
      },
    });

    const result = await buildSlotPrefill({ slot, schema: SCHEMA });

    expect(result.initialValues.quartier).toBe("Centre");
  });

  it("une clé de fiche sans champ de schéma correspondant reste sous sa propre clé", async () => {
    const slot = makeSlot({
      entity: {
        fields: JSON.stringify({ proprietaire: "Dupont" }),
        type: { fieldSchema: JSON.stringify([{ key: "proprietaire", label: "Propriétaire", type: "text" }]) },
      },
    });

    const result = await buildSlotPrefill({ slot, schema: SCHEMA });

    expect(result.initialValues.proprietaire).toBe("Dupont");
    expect(result.provenance.proprietaire).toBe("entity");
    expect(result.customFormFields).toEqual([{ key: "proprietaire", label: "Propriétaire", type: "text" }]);
  });
});

describe("buildSlotPrefill — matrice de précédence complète", () => {
  it("shootEntity < entity < slot.fields < existingValues sur une même clé", async () => {
    const slot = makeSlot({
      fields: JSON.stringify({ statut: "override mission" }),
      shootEntity: { fields: JSON.stringify({ statut: "valeur tournage" }), type: { fieldSchema: "[]" } },
      entity: { fields: JSON.stringify({ statut: "valeur fiche" }), type: { fieldSchema: "[]" } },
    });

    const result = await buildSlotPrefill({
      slot,
      schema: SCHEMA,
      existingValues: { statut: "valeur listing" },
    });

    expect(result.initialValues.statut).toBe("valeur listing");
    expect(result.provenance.statut).toBe("manual");
  });

  it("sans existingValues, slot.fields (manual) l'emporte sur entity", async () => {
    const slot = makeSlot({
      fields: JSON.stringify({ statut: "override mission" }),
      entity: { fields: JSON.stringify({ statut: "valeur fiche" }), type: { fieldSchema: "[]" } },
    });

    const result = await buildSlotPrefill({ slot, schema: SCHEMA });

    expect(result.initialValues.statut).toBe("override mission");
    expect(result.provenance.statut).toBe("manual");
  });

  it("une existingProvenance plus faible que la couche fiche ne l'emporte pas", async () => {
    const slot = makeSlot({
      entity: { fields: JSON.stringify({ statut: "valeur fiche" }), type: { fieldSchema: "[]" } },
    });

    const result = await buildSlotPrefill({
      slot,
      schema: SCHEMA,
      existingValues: { statut: "valeur data entry périmée" },
      existingProvenance: { statut: "dataEntry" },
    });

    // entity (fort) > dataEntry (faible) : la couche existante ne doit pas gagner.
    expect(result.initialValues.statut).toBe("valeur fiche");
    expect(result.provenance.statut).toBe("entity");
  });
});

describe("buildSlotPrefill — JSON malformé", () => {
  it("tolère un JSON invalide dans fields/entity.fields/shootEntity.fields sans lever", async () => {
    const slot = makeSlot({
      fields: "{not json",
      entity: { fields: "{ still not json", type: { fieldSchema: "{also not an array" } },
      shootEntity: { fields: "not json at all", type: { fieldSchema: "[]" } },
    });

    const result = await buildSlotPrefill({ slot, schema: SCHEMA });

    expect(result.entityFields).toEqual({});
    expect(result.shootEntityFields).toEqual({});
    expect(result.customFormFields).toEqual([]);
    expect(result.initialValues).toEqual({});
  });
});

describe("buildSlotPrefill — chargement par slotId", () => {
  it("interroge prisma.publicationSlot.findFirst avec un select entity+shootEntity quand slot n'est pas fourni", async () => {
    mockFindFirst.mockResolvedValue(
      makeSlot({ entity: { fields: JSON.stringify({ prix: "42" }), type: { fieldSchema: "[]" } } }),
    );

    const result = await buildSlotPrefill({ slotId: "slot-1", schema: SCHEMA });

    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    const call = mockFindFirst.mock.calls[0][0] as { where: { id: string }; select: Record<string, unknown> };
    expect(call.where).toEqual({ id: "slot-1" });
    expect(call.select).toHaveProperty("entity");
    expect(call.select).toHaveProperty("shootEntity");
    expect(result.initialValues.prix).toBe("42");
    expect(result.accountId).toBe("acc-1");
    expect(result.slotBannerContext).toEqual({ title: "Mon slot", handle: "monteur_officiel" });
  });

  it("ne requête pas prisma quand slot est fourni explicitement (même undefined via slotId)", async () => {
    await buildSlotPrefill({ slotId: "slot-1", slot: null, schema: SCHEMA });
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});
