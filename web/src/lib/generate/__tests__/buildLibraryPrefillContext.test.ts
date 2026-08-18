/**
 * Précédence de pré-remplissage : saisie manuelle > fiche (Entity) > fiche
 * tournage > DataEntry > métadonnées d'asset.
 *
 * Non-régression : la boucle DataEntry écrasait sans garde toute valeur déjà
 * présente dans `initialValues`, y compris celle posée en amont depuis la
 * fiche (Entity/ShootEvent) par le Server Component /generate/[templateId].
 * Pour un template combinant contentLibrary.dataLibraryId et un slot lié à
 * une fiche, une clé partagée (prix, quartier…) repartait avec la valeur de
 * la bibliothèque au lieu de celle de la fiche.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveLibraryPrefill = vi.fn();
const mockSelectMediaAssetByMetadataValue = vi.fn();
const mockInstagramAccountFindMany = vi.fn();
const mockMediaAssetFindFirst = vi.fn();

vi.mock("@/lib/contentLibraryResolver", () => ({
  resolveLibraryPrefill: (...args: unknown[]) => mockResolveLibraryPrefill(...args),
  selectMediaAssetByMetadataValue: (...args: unknown[]) => mockSelectMediaAssetByMetadataValue(...args),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    instagramAccount: { findMany: (...args: unknown[]) => mockInstagramAccountFindMany(...args) },
    mediaAsset: { findFirst: (...args: unknown[]) => mockMediaAssetFindFirst(...args) },
  },
}));

import { buildLibraryPrefillContext } from "@/lib/generate/buildLibraryPrefillContext";
import type { TemplateJSON, SchemaField } from "@/types/template";

const SCHEMA: SchemaField[] = [
  { key: "quartier", label: "Quartier", type: "text", required: false },
  { key: "prix", label: "Prix", type: "text", required: false },
  { key: "surface", label: "Surface", type: "text", required: false },
];

function makeJson(): TemplateJSON {
  return {
    canvas: {} as TemplateJSON["canvas"],
    theme: {} as TemplateJSON["theme"],
    blocks: [],
    groups: [],
    formSections: [],
    schema: SCHEMA,
    contentLibrary: { dataLibraryId: "lib-1" },
  } as unknown as TemplateJSON;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveLibraryPrefill.mockResolvedValue({
    videoSuggestions: {},
    audioSuggestion: null,
    dataSuggestion: {
      entryId: "de-1",
      // La DataEntry porte les 3 clés — dont deux sont déjà couvertes par la fiche.
      fields: { quartier: "Quartier bibliothèque", prix: "100000", surface: "80" },
      resolvedSetTag: null,
    },
    setSequencedLibraryIds: [],
    usedSetTagByLibrary: {},
  });
});

describe("buildLibraryPrefillContext — précédence fiche > DataEntry", () => {
  it("préserve une valeur de fiche non vide face à une DataEntry qui porte la même clé", async () => {
    const { context, updatedInitialValues } = await buildLibraryPrefillContext({
      json: makeJson(),
      mergedSchema: SCHEMA,
      initialValues: { quartier: "Quartier fiche" }, // posé en amont depuis l'Entity
      accountId: null,
      slotId: null,
      listingId: null,
    });

    // La valeur de fiche n'est pas écrasée par la DataEntry.
    expect(updatedInitialValues?.quartier).toBe("Quartier fiche");
    // La clé n'est pas marquée comme pré-remplie depuis la bibliothèque —
    // le badge de provenance ne doit pas mentir sur l'origine réelle.
    expect(context?.prefilledKeys.quartier).toBeUndefined();

    // Une clé absente de la fiche reste comblée par la DataEntry.
    expect(updatedInitialValues?.prix).toBe("100000");
    expect(context?.prefilledKeys.prix).toBe("dataEntry");
  });

  it("écrase une provenance plus faible (assetMetadata) avec la DataEntry", async () => {
    const { context, updatedInitialValues } = await buildLibraryPrefillContext({
      json: makeJson(),
      mergedSchema: SCHEMA,
      initialValues: { quartier: "Quartier auto (média)" },
      accountId: null,
      slotId: null,
      listingId: null,
      provenance: { quartier: "assetMetadata" },
    });

    expect(updatedInitialValues?.quartier).toBe("Quartier bibliothèque");
    expect(context?.prefilledKeys.quartier).toBe("dataEntry");
  });

  it("respecte une provenance forte (entity) transmise explicitement", async () => {
    const { context, updatedInitialValues } = await buildLibraryPrefillContext({
      json: makeJson(),
      mergedSchema: SCHEMA,
      initialValues: { quartier: "Quartier fiche" },
      accountId: null,
      slotId: null,
      listingId: null,
      provenance: { quartier: "entity" },
    });

    expect(updatedInitialValues?.quartier).toBe("Quartier fiche");
    expect(context?.prefilledKeys.quartier).toBe("entity");
  });

  it("ne considère pas une valeur falsy légitime (\"0\") comme vide", async () => {
    const { context, updatedInitialValues } = await buildLibraryPrefillContext({
      json: makeJson(),
      mergedSchema: SCHEMA,
      initialValues: { surface: "0" },
      accountId: null,
      slotId: null,
      listingId: null,
    });

    expect(updatedInitialValues?.surface).toBe("0");
    expect(context?.prefilledKeys.surface).toBeUndefined();
  });

  it("comble depuis la DataEntry quand la fiche n'a rien fourni pour cette clé", async () => {
    const { context, updatedInitialValues } = await buildLibraryPrefillContext({
      json: makeJson(),
      mergedSchema: SCHEMA,
      initialValues: undefined,
      accountId: null,
      slotId: null,
      listingId: null,
    });

    expect(updatedInitialValues?.quartier).toBe("Quartier bibliothèque");
    expect(context?.prefilledKeys.quartier).toBe("dataEntry");
  });
});
