/**
 * generationFormModel — test de parité (plan « lancer les rendus depuis le
 * calendrier », étape 4). `buildSlotPrefill`/`buildLibraryPrefillContext`
 * sont mockés (déjà couverts par leurs propres suites) : ce fichier isole
 * l'orchestration propre à `buildGenerationFormModel` (merge du schéma,
 * relaxation metadata-driven SANS mutation, injection ig_account, filtre
 * auto-mode, résolution accountId) et la garantie de parité
 * `projectFormValues` ↔ ce qu'un `ListingForm` non modifié construit à
 * l'init à partir des MÊMES props.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockBuildSlotPrefill = vi.fn();
const mockBuildLibraryPrefillContext = vi.fn();
const mockInstagramAccountFindUnique = vi.fn();

vi.mock("@/lib/generate/buildSlotPrefill", () => ({
  buildSlotPrefill: (...args: unknown[]) => mockBuildSlotPrefill(...args),
}));

vi.mock("@/lib/generate/buildLibraryPrefillContext", () => ({
  buildLibraryPrefillContext: (...args: unknown[]) => mockBuildLibraryPrefillContext(...args),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    instagramAccount: { findUnique: (...args: unknown[]) => mockInstagramAccountFindUnique(...args) },
  },
}));

import {
  buildGenerationFormModel,
  projectFormValues,
  resolveInitialFieldValue,
  initFieldProvenance,
  findEmptyMetadataDrivenSelects,
  templateUsesLibrary,
  type GenerationFormModel,
} from "@/lib/generate/generationFormModel";
import { canOverride, type ProvenanceMap } from "@/lib/generate/provenance";
import type { SchemaField, TemplateJSON } from "@/types/template";

/** Reimplémentation INDÉPENDANTE (copie littérale) de ce que `ListingForm`
 *  construit à l'init — pour vérifier la parité sans passer par les mêmes
 *  helpers que `projectFormValues` (sinon le test serait circulaire). */
function simulateListingFormInit(
  schema: SchemaField[],
  initialValues: Record<string, unknown> | undefined,
  initialProvenance: ProvenanceMap | undefined,
): { values: Record<string, unknown>; provenance: ProvenanceMap } {
  function resolve(field: SchemaField, v: unknown): unknown {
    if (v !== undefined && v !== null) return v;
    if (field.default !== undefined && field.default !== null) return field.default;
    return "";
  }
  const values = Object.fromEntries(schema.map((f) => [f.key, resolve(f, initialValues?.[f.key])]));
  const provenance: ProvenanceMap = { ...(initialProvenance ?? {}) };
  for (const field of schema) {
    if (!field.metadataSource) continue;
    if (!canOverride(provenance[field.key], "assetMetadata")) continue;
    provenance[field.key] = "assetMetadata";
  }
  return { values, provenance };
}

function emptySlotPrefill(overrides: Record<string, unknown> = {}) {
  return {
    entityFields: {},
    shootEntityFields: {},
    customFormFields: [],
    initialValues: {},
    provenance: {},
    accountId: undefined,
    slotBannerContext: null,
    ...overrides,
  };
}

function baseTemplate(overrides: Record<string, unknown> = {}): TemplateJSON {
  return {
    canvas: {} as TemplateJSON["canvas"],
    theme: {} as TemplateJSON["theme"],
    blocks: [],
    groups: [],
    formSections: [],
    schema: [],
    ...overrides,
  } as unknown as TemplateJSON;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBuildSlotPrefill.mockResolvedValue(emptySlotPrefill());
  mockBuildLibraryPrefillContext.mockResolvedValue({ context: undefined, updatedInitialValues: undefined });
});

describe("buildGenerationFormModel — template plain (defaults, sans bibliothèque)", () => {
  it("produit un finalSchema = mergedSchema et des values résolues sur les defaults", async () => {
    const json = baseTemplate({
      schema: [{ key: "title", label: "Titre", type: "text", required: false, default: "Hello" } as SchemaField],
    });

    const model = await buildGenerationFormModel({ json, slotId: null, accountId: null });

    expect(model.templateNeedsAccount).toBe(false);
    expect(model.finalSchema.map((f) => f.key)).toEqual(["title"]);

    const { values, provenance } = projectFormValues(model);
    const simulated = simulateListingFormInit(model.finalSchema, model.initialValues, model.provenance);
    expect(values).toEqual(simulated.values);
    expect(provenance).toEqual(simulated.provenance);
    expect(values).toEqual({ title: "Hello" });
  });
});

describe("buildGenerationFormModel — résolution accountId (arg explicite vs slot.accountId)", () => {
  it("retombe sur l'accountId du slot quand aucun accountId explicite n'est fourni", async () => {
    mockBuildSlotPrefill.mockResolvedValue(emptySlotPrefill({ accountId: "slot-acc" }));
    const model = await buildGenerationFormModel({ json: baseTemplate(), slotId: "slot-1", accountId: null });
    expect(model.accountId).toBe("slot-acc");
  });

  it("l'accountId explicite (query param) prime sur celui du slot", async () => {
    mockBuildSlotPrefill.mockResolvedValue(emptySlotPrefill({ accountId: "slot-acc" }));
    const model = await buildGenerationFormModel({ json: baseTemplate(), slotId: "slot-1", accountId: "explicit-acc" });
    expect(model.accountId).toBe("explicit-acc");
  });
});

describe("buildGenerationFormModel — injection ig_account", () => {
  it("injecte le handle IG dans initialValues.ig_account quand le champ existe et qu'un compte est connu", async () => {
    mockInstagramAccountFindUnique.mockResolvedValue({ handle: "monteur_test" });
    // Simule le passthrough réel de buildLibraryPrefillContext (renvoie les
    // initialValues reçues, éventuellement enrichies) — ici inchangées.
    mockBuildLibraryPrefillContext.mockImplementation(async (args: { initialValues: Record<string, unknown> }) => ({
      context: undefined,
      updatedInitialValues: args.initialValues,
    }));
    const json = baseTemplate({
      schema: [{ key: "ig_account", label: "Compte IG", type: "text", required: false } as SchemaField],
    });

    const model = await buildGenerationFormModel({ json, slotId: null, accountId: "acc-1" });

    expect(mockInstagramAccountFindUnique).toHaveBeenCalledWith({ where: { id: "acc-1" }, select: { handle: true } });
    expect(model.initialValues.ig_account).toBe("monteur_test");
  });

  it("n'appelle pas prisma quand le template n'a pas de champ ig_account", async () => {
    const json = baseTemplate({ schema: [{ key: "title", label: "Titre", type: "text", required: false } as SchemaField] });
    await buildGenerationFormModel({ json, slotId: null, accountId: "acc-1" });
    expect(mockInstagramAccountFindUnique).not.toHaveBeenCalled();
  });
});

describe("buildGenerationFormModel — passthrough batchUsage / resolvedPrefill", () => {
  it("transmet batchUsage à buildLibraryPrefillContext", async () => {
    const batchUsage = { entriesFor: vi.fn(() => null) };
    await buildGenerationFormModel({ json: baseTemplate(), slotId: null, accountId: null, batchUsage });
    expect(mockBuildLibraryPrefillContext).toHaveBeenCalledWith(expect.objectContaining({ batchUsage }));
  });

  it("transmet resolvedPrefill à buildLibraryPrefillContext, et le renvoie propagé dans usageKeyByPick", async () => {
    const resolvedPrefill = {
      videoSuggestions: {},
      audioSuggestion: null,
      dataSuggestion: null,
      usageKeyByPick: { audio: { libraryId: "lib-a", usageKey: "acc-1" } },
    };
    mockBuildLibraryPrefillContext.mockResolvedValue({
      context: undefined,
      updatedInitialValues: {},
      usageKeyByPick: resolvedPrefill.usageKeyByPick,
    });

    const model = await buildGenerationFormModel({ json: baseTemplate(), slotId: null, accountId: null, resolvedPrefill });

    expect(mockBuildLibraryPrefillContext).toHaveBeenCalledWith(expect.objectContaining({ resolvedPrefill }));
    expect(model.usageKeyByPick).toEqual(resolvedPrefill.usageKeyByPick);
  });
});

describe("buildGenerationFormModel — précédence via buildLibraryPrefillContext (fixture DataEntry)", () => {
  it("adopte context.prefilledKeys comme provenance finale, et les valeurs mises à jour", async () => {
    mockBuildSlotPrefill.mockResolvedValue(emptySlotPrefill());
    mockBuildLibraryPrefillContext.mockResolvedValue({
      context: {
        fieldLibraryMap: {},
        initialSuggestions: {},
        prefilledKeys: { quartier: "dataEntry" },
        dataSuggestion: { entryId: "de-1", fields: { quartier: "Centre" } },
        instagramAccounts: [],
      },
      updatedInitialValues: { quartier: "Centre" },
    });
    const json = baseTemplate({
      contentLibrary: { dataLibraryId: "lib-data" },
      schema: [{ key: "quartier", label: "Quartier", type: "text", required: false } as SchemaField],
    });

    const model = await buildGenerationFormModel({ json, slotId: null, accountId: "acc-1" });

    expect(model.provenance).toEqual({ quartier: "dataEntry" });
    expect(model.initialValues.quartier).toBe("Centre");

    const { values, provenance } = projectFormValues(model);
    const simulated = simulateListingFormInit(model.finalSchema, model.initialValues, model.provenance);
    expect(values).toEqual(simulated.values);
    expect(provenance).toEqual(simulated.provenance);
  });

  it("templateNeedsAccount=true (bibliothèque sans compte) : buildLibraryPrefillContext n'est pas appelé", async () => {
    const json = baseTemplate({ contentLibrary: { dataLibraryId: "lib-data" } });
    const model = await buildGenerationFormModel({ json, slotId: null, accountId: null });
    expect(model.templateNeedsAccount).toBe(true);
    expect(mockBuildLibraryPrefillContext).not.toHaveBeenCalled();
    expect(model.context).toBeUndefined();
  });
});

describe("buildGenerationFormModel — champs metadataSource (provenance assetMetadata) + manualFieldKeys", () => {
  it("pose 'assetMetadata' à l'init puis 'manual' seulement sur les clés changées via Changer", async () => {
    const json = baseTemplate({
      schema: [
        { key: "prix", label: "Prix", type: "text", required: false, metadataSource: { libraryId: "lib-x", metadataKey: "prix" } } as SchemaField,
      ],
    });

    const model = await buildGenerationFormModel({ json, slotId: null, accountId: null });

    const projected = projectFormValues(model);
    expect(projected.provenance.prix).toBe("assetMetadata");

    const projectedManual = projectFormValues(model, ["prix"]);
    expect(projectedManual.provenance.prix).toBe("manual");

    const simulated = simulateListingFormInit(model.finalSchema, model.initialValues, model.provenance);
    expect(projected.values).toEqual(simulated.values);
    expect(projected.provenance).toEqual(simulated.provenance);
  });
});

describe("buildGenerationFormModel — generationMode 'auto' + videoSequence (finalSchema)", () => {
  it("retire les champs vidéo orphelins/liés bibliothèque, garde les slots manuels", async () => {
    const json = baseTemplate({
      generationMode: "auto",
      schema: [
        { key: "intro", label: "Intro", type: "video", required: true } as SchemaField,
        { key: "manual_clip", label: "Clip manuel", type: "video", required: true } as SchemaField,
        { key: "title", label: "Titre", type: "text", required: false } as SchemaField,
      ],
      videoSequence: [
        { id: "slot-a", binding: "intro", libraryId: "lib-v" },
        { id: "slot-b", binding: "manual_clip" }, // pas de libraryId → slot manuel
      ],
    });

    const model = await buildGenerationFormModel({ json, slotId: null, accountId: "acc-1" });

    const keys = model.finalSchema.map((f) => f.key);
    expect(keys).toContain("manual_clip");
    expect(keys).toContain("title");
    expect(keys).not.toContain("intro");

    const { values, provenance } = projectFormValues(model);
    const simulated = simulateListingFormInit(model.finalSchema, model.initialValues, model.provenance);
    expect(values).toEqual(simulated.values);
    expect(provenance).toEqual(simulated.provenance);
  });
});

describe("buildGenerationFormModel — relaxation vidéo metadata-driven (RVA4) SANS mutation", () => {
  it("clone le champ relâché (required:false) sans muter l'objet partagé de json.schema", async () => {
    const rva3rawField: SchemaField = { key: "rva3raw", label: "RVA3", type: "video", required: true };
    const clientField: SchemaField = {
      key: "client",
      label: "Client",
      type: "select",
      required: false,
      optionsSource: { type: "metadata-values-from-library", libraryId: "lib-c", metadataKey: "client", blockId: "vb-rva3" },
    };
    // Objets figés : toute mutation en place lèverait (modules ES = strict
    // mode) au lieu de fuiter silencieusement — garde-fou dur, pas seulement
    // une comparaison de référence après coup.
    Object.freeze(rva3rawField);
    Object.freeze(clientField);

    const json = baseTemplate({
      schema: [rva3rawField, clientField],
      blocks: [{ id: "vb-rva3", type: "video", binding: "rva3raw", w: 100, h: 100 }],
      videoSequence: [{ id: "slot-rva3", videoBlockId: "vb-rva3", label: "RVA3" }],
    });
    Object.freeze(json.schema);
    Object.freeze(json.blocks);

    const model = await buildGenerationFormModel({ json, slotId: null, accountId: null });

    // L'objet d'origine (json.schema) n'a pas bougé.
    expect(rva3rawField.required).toBe(true);

    // Le mergedSchema porte, lui, un CLONE relâché.
    const relaxed = model.mergedSchema.find((f) => f.key === "rva3raw");
    expect(relaxed?.required).toBe(false);
    expect(relaxed).not.toBe(rva3rawField);

    // Garde-fou RVA4 : le select metadata-driven est vide après prefill.
    const emptySelects = findEmptyMetadataDrivenSelects(model.finalSchema, model.initialValues);
    expect(emptySelects.map((f) => f.key)).toEqual(["client"]);
  });
});

describe("findEmptyMetadataDrivenSelects", () => {
  const clientField: SchemaField = {
    key: "client",
    label: "Client",
    type: "select",
    required: false,
    optionsSource: { type: "metadata-values-from-library", libraryId: "lib-c", metadataKey: "client", blockId: "vb-1" },
  };
  const plainSelect: SchemaField = { key: "quartier", label: "Quartier", type: "select", required: false, options: ["Centre"] };

  it("ignore les selects non metadata-driven, même vides", () => {
    expect(findEmptyMetadataDrivenSelects([plainSelect], {})).toEqual([]);
  });

  it("retient un select metadata-driven vide", () => {
    expect(findEmptyMetadataDrivenSelects([clientField], {})).toEqual([clientField]);
    expect(findEmptyMetadataDrivenSelects([clientField], { client: "" })).toEqual([clientField]);
  });

  it("écarte un select metadata-driven déjà rempli", () => {
    expect(findEmptyMetadataDrivenSelects([clientField], { client: "Dupont" })).toEqual([]);
  });
});

describe("resolveInitialFieldValue", () => {
  const field: SchemaField = { key: "prix", label: "Prix", type: "text", required: false, default: "0" };

  it("priorise la valeur initiale non vide", () => {
    expect(resolveInitialFieldValue(field, "150000")).toBe("150000");
  });

  it("retombe sur le default quand la valeur initiale est undefined/null", () => {
    expect(resolveInitialFieldValue(field, undefined)).toBe("0");
    expect(resolveInitialFieldValue(field, null)).toBe("0");
  });

  it("retombe sur '' sans default", () => {
    const noDefault: SchemaField = { key: "x", label: "X", type: "text", required: false };
    expect(resolveInitialFieldValue(noDefault, undefined)).toBe("");
  });
});

describe("initFieldProvenance", () => {
  it("garde la provenance de base et ajoute assetMetadata seulement si canOverride l'autorise", () => {
    const schema: SchemaField[] = [
      { key: "prix", label: "Prix", type: "text", required: false, metadataSource: { libraryId: "l", metadataKey: "prix" } },
      { key: "surface", label: "Surface", type: "text", required: false },
    ];
    const result = initFieldProvenance(schema, { prix: "manual" });
    expect(result.prix).toBe("manual"); // manual ne peut pas être écrasé par assetMetadata
    expect(result.surface).toBeUndefined();
  });
});

describe("templateUsesLibrary", () => {
  it("détecte un binding vidéo/musique, un slot de séquence, ou une DataLibrary/campagne", () => {
    expect(templateUsesLibrary(baseTemplate())).toBe(false);
    expect(templateUsesLibrary(baseTemplate({ blocks: [{ id: "b1", type: "video", libraryId: "lib-1" }] }))).toBe(true);
    expect(templateUsesLibrary(baseTemplate({ videoSequence: [{ id: "s1", libraryId: "lib-1" }] }))).toBe(true);
    expect(templateUsesLibrary(baseTemplate({ contentLibrary: { dataLibraryId: "lib-1" } }))).toBe(true);
    expect(templateUsesLibrary(baseTemplate({ contentLibrary: { dataCampaignId: "camp-1" } }))).toBe(true);
  });
});

// Utilisation de GenerationFormModel dans un helper de test local, pour
// s'assurer que le type exporté couvre bien les champs consommés par
// bulkRenderService/page.tsx (vérifié à la compilation, pas à l'exécution).
function _typeCheckOnly(model: GenerationFormModel): void {
  void model.json;
  void model.mergedSchema;
  void model.finalSchema;
  void model.initialValues;
  void model.provenance;
  void model.context;
  void model.accountId;
  void model.templateNeedsAccount;
  void model.usageKeyByPick;
  void model.slotBannerContext;
}
void _typeCheckOnly;
