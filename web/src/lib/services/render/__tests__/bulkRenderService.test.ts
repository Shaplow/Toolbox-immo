/**
 * Tests de bulkRenderService — aperçu et lancement des rendus en lot depuis
 * le calendrier (plan « Lancer les rendus depuis le calendrier », étape 6).
 *
 * Prisma et les modules lourds (`generationFormModel`, `renderLaunchService`,
 * `contentLibraryResolver.selectMediaAsset`) sont mockés au niveau module —
 * vitest unit pur, pas de DB. `buildRenderRequestBody`, `resolveSlotEffectivePattern`,
 * `requiresEntity`, `isRendered`, `isReservedSetTag`, `normalizeTemplateJSON`
 * et le registre `batchUsage` restent RÉELS : ce sont des fonctions pures déjà
 * couvertes par leurs propres suites, et les garder réelles ici teste
 * l'intégration effective plutôt que de la présupposer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserContext } from "@/lib/userContext";
import type { GenerationFormModel } from "@/lib/generate/generationFormModel";
import type { TemplateJSON } from "@/types/template";

// ── Mocks Prisma ─────────────────────────────────────────────────────────────
const mockSlotFindMany = vi.fn();
const mockSlotFindUnique = vi.fn();
const mockTemplateFindMany = vi.fn();
const mockTemplateFindUnique = vi.fn();
const mockMediaAssetFindMany = vi.fn();
const mockMediaLibraryFindMany = vi.fn();
const mockDataLibraryFindMany = vi.fn();
const mockDataEntryFindUnique = vi.fn();
const mockDataCampaignFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicationSlot: {
      findMany: (...args: unknown[]) => mockSlotFindMany(...args),
      findUnique: (...args: unknown[]) => mockSlotFindUnique(...args),
    },
    template: {
      findMany: (...args: unknown[]) => mockTemplateFindMany(...args),
      findUnique: (...args: unknown[]) => mockTemplateFindUnique(...args),
    },
    mediaAsset: {
      findMany: (...args: unknown[]) => mockMediaAssetFindMany(...args),
    },
    mediaLibrary: {
      findMany: (...args: unknown[]) => mockMediaLibraryFindMany(...args),
    },
    dataLibrary: {
      findMany: (...args: unknown[]) => mockDataLibraryFindMany(...args),
    },
    dataEntry: {
      findUnique: (...args: unknown[]) => mockDataEntryFindUnique(...args),
    },
    dataCampaign: {
      findUnique: (...args: unknown[]) => mockDataCampaignFindUnique(...args),
    },
  },
}));

// ── Mocks generationFormModel ────────────────────────────────────────────────
const mockBuildGenerationFormModel = vi.fn();
const mockProjectFormValues = vi.fn();
const mockTemplateUsesLibrary = vi.fn();
const mockFindEmptyMetadataDrivenSelects = vi.fn();

vi.mock("@/lib/generate/generationFormModel", () => ({
  buildGenerationFormModel: (...args: unknown[]) => mockBuildGenerationFormModel(...args),
  projectFormValues: (...args: unknown[]) => mockProjectFormValues(...args),
  templateUsesLibrary: (...args: unknown[]) => mockTemplateUsesLibrary(...args),
  findEmptyMetadataDrivenSelects: (...args: unknown[]) => mockFindEmptyMetadataDrivenSelects(...args),
}));

// ── Mocks renderLaunchService ────────────────────────────────────────────────
const mockFindMissingRequiredFields = vi.fn();
const mockCreateListingForRender = vi.fn();
const mockCreateAndStartRender = vi.fn();
const mockFindInFlightRender = vi.fn();

vi.mock("@/lib/services/render/renderLaunchService", () => ({
  findMissingRequiredFields: (...args: unknown[]) => mockFindMissingRequiredFields(...args),
  createListingForRender: (...args: unknown[]) => mockCreateListingForRender(...args),
  createAndStartRender: (...args: unknown[]) => mockCreateAndStartRender(...args),
  // Pass-through par défaut : le verrou en mémoire lui-même est déjà couvert
  // par renderLaunchService.test.ts — ici on teste l'orchestration du lot.
  withSlotRenderLock: (_slotId: string, fn: () => unknown) => fn(),
  findInFlightRender: (...args: unknown[]) => mockFindInFlightRender(...args),
}));

// ── Mock contentLibraryResolver (musique non bindée uniquement) ────────────
const mockSelectMediaAsset = vi.fn();
vi.mock("@/lib/contentLibraryResolver", () => ({
  selectMediaAsset: (...args: unknown[]) => mockSelectMediaAsset(...args),
}));

import {
  previewBulkRenders,
  launchBulkRenders,
} from "@/lib/services/render/bulkRenderService";
import { ForbiddenError, ValidationError } from "@/lib/services/_runtime/errors";
import type { BulkRenderLaunchItem } from "@/types/bulkRender";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeCtx(role: "ADMIN" | "CM" = "ADMIN"): UserContext {
  return {
    session: {} as UserContext["session"],
    actualUser: { id: "user-1", role, name: null, email: null, permissions: "[]" },
    effectiveUser: { id: "user-1", role, name: null, email: null, permissions: "[]" },
    isAdmin: role === "ADMIN",
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: role === "ADMIN",
  };
}

/** Fragment PatternTemplate direct (sans binding) — champs lus par resolveSlotEffectivePattern. */
function makePatternTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: "pt-1",
    label: "Recette Test",
    source: "auto_template",
    templateId: "tpl-1",
    captionPresetId: null,
    descriptionPromptId: null,
    coverMode: "none",
    coverConfig: null,
    needsCaptionsMode: "none",
    needsDescription: "none",
    descriptionSourceFieldKey: null,
    descriptionFixedText: null,
    descriptionDataLibraryId: null,
    descriptionDataSetTag: null,
    needsAdminValidation: false,
    needsClientValidation: false,
    allowsClientRevision: false,
    needsBrief: false,
    requiresProperty: false,
    requiresEntityTypeId: null,
    ...overrides,
  };
}

function makeSlotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "slot-1",
    scheduledAt: new Date("2026-09-20T10:00:00Z"),
    status: "TO_DO",
    accountId: "acc-1",
    entityId: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    account: { id: "acc-1", handle: "moncompte" },
    render: null,
    renders: [],
    patternBinding: null,
    patternTemplate: makePatternTemplate(),
    ...overrides,
  };
}

function makeJson(overrides: Partial<TemplateJSON> = {}): TemplateJSON {
  return {
    canvas: {},
    theme: {},
    blocks: [],
    groups: [],
    formSections: [],
    schema: [],
    ...overrides,
  } as unknown as TemplateJSON;
}

function makeModel(overrides: Partial<GenerationFormModel> = {}): GenerationFormModel {
  return {
    json: makeJson(),
    mergedSchema: [],
    finalSchema: [],
    initialValues: {},
    provenance: {},
    context: undefined,
    accountId: "acc-1",
    templateNeedsAccount: false,
    usageKeyByPick: undefined,
    slotBannerContext: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSlotFindMany.mockResolvedValue([]);
  mockSlotFindUnique.mockResolvedValue(null);
  mockTemplateFindMany.mockResolvedValue([]);
  mockTemplateFindUnique.mockResolvedValue(null);
  mockMediaAssetFindMany.mockResolvedValue([]);
  mockMediaLibraryFindMany.mockResolvedValue([]);
  mockDataLibraryFindMany.mockResolvedValue([]);
  mockDataEntryFindUnique.mockResolvedValue(null);
  mockDataCampaignFindUnique.mockResolvedValue(null);

  mockBuildGenerationFormModel.mockResolvedValue(makeModel());
  mockProjectFormValues.mockImplementation((model: GenerationFormModel, manualKeys?: string[]) => ({
    values: model.initialValues,
    provenance: {
      ...model.provenance,
      ...Object.fromEntries((manualKeys ?? []).map((k) => [k, "manual"])),
    },
  }));
  mockTemplateUsesLibrary.mockReturnValue(false);
  mockFindEmptyMetadataDrivenSelects.mockReturnValue([]);
  mockFindMissingRequiredFields.mockReturnValue([]);
  mockCreateListingForRender.mockResolvedValue({ id: "listing-1" });
  mockCreateAndStartRender.mockResolvedValue({ id: "render-1" });
  mockFindInFlightRender.mockResolvedValue(null);
  mockSelectMediaAsset.mockResolvedValue(null);
});

// ════════════════════════════════════════════════════════════════════════
// previewBulkRenders
// ════════════════════════════════════════════════════════════════════════

describe("previewBulkRenders", () => {
  it("refuse un non-admin sans toucher la base", async () => {
    await expect(previewBulkRenders(["slot-1"], makeCtx("CM"))).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockSlotFindMany).not.toHaveBeenCalled();
  });

  it("compte les ids introuvables dans ignored.not_found", async () => {
    mockSlotFindMany.mockResolvedValue([]);
    const preview = await previewBulkRenders(["disparu"], makeCtx());
    expect(preview.ignored).toEqual([{ reason: "not_found", count: 1 }]);
    expect(preview.rows).toEqual([]);
  });

  it("ignore une recette non auto_template", async () => {
    mockSlotFindMany.mockResolvedValue([
      makeSlotRow({ patternTemplate: makePatternTemplate({ source: "manual_rushes" }) }),
    ]);
    const preview = await previewBulkRenders(["slot-1"], makeCtx());
    expect(preview.ignored).toEqual([{ reason: "not_auto_template", count: 1 }]);
  });

  it("ignore un statut terminal", async () => {
    mockSlotFindMany.mockResolvedValue([makeSlotRow({ status: "PUBLISHED" })]);
    const preview = await previewBulkRenders(["slot-1"], makeCtx());
    expect(preview.ignored).toEqual([{ reason: "terminal_status", count: 1 }]);
  });

  it("ignore une publication déjà rendue (render courant DONE)", async () => {
    mockSlotFindMany.mockResolvedValue([makeSlotRow({ render: { status: "DONE" } })]);
    const preview = await previewBulkRenders(["slot-1"], makeCtx());
    expect(preview.ignored).toEqual([{ reason: "already_rendered", count: 1 }]);
  });

  it("ignore une publication déjà rendue (latestRender DONE, course SSE)", async () => {
    mockSlotFindMany.mockResolvedValue([makeSlotRow({ render: null, renders: [{ status: "DONE" }] })]);
    const preview = await previewBulkRenders(["slot-1"], makeCtx());
    expect(preview.ignored).toEqual([{ reason: "already_rendered", count: 1 }]);
  });

  it("reste candidat quand le render courant est en ERROR (cas Relancer)", async () => {
    mockSlotFindMany.mockResolvedValue([makeSlotRow({ render: { status: "ERROR" } })]);
    mockTemplateFindMany.mockResolvedValue([{ id: "tpl-1", name: "Tpl", jsonData: JSON.stringify(makeJson()) }]);
    const preview = await previewBulkRenders(["slot-1"], makeCtx());
    expect(preview.ignored).toEqual([]);
    expect(preview.rows[0]?.status).toBe("ready");
  });

  it("statut no_template quand la recette n'a pas de template", async () => {
    mockSlotFindMany.mockResolvedValue([makeSlotRow({ patternTemplate: makePatternTemplate({ templateId: null }) })]);
    const preview = await previewBulkRenders(["slot-1"], makeCtx());
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]).toMatchObject({ status: "no_template", formHref: null });
    expect(mockFindInFlightRender).not.toHaveBeenCalled();
  });

  it("statut no_template quand le Template référencé n'existe plus", async () => {
    mockSlotFindMany.mockResolvedValue([makeSlotRow()]);
    mockTemplateFindMany.mockResolvedValue([]); // aucun template chargé pour tpl-1
    const preview = await previewBulkRenders(["slot-1"], makeCtx());
    expect(preview.rows[0]?.status).toBe("no_template");
  });

  it("statut in_flight, sans tirer quoi que ce soit", async () => {
    mockSlotFindMany.mockResolvedValue([makeSlotRow()]);
    mockTemplateFindMany.mockResolvedValue([{ id: "tpl-1", name: "Tpl", jsonData: JSON.stringify(makeJson()) }]);
    mockFindInFlightRender.mockResolvedValue({ id: "render-x", status: "PROCESSING" });
    const preview = await previewBulkRenders(["slot-1"], makeCtx());
    expect(preview.rows[0]).toMatchObject({ status: "in_flight", reason: "Rendu en cours" });
    expect(mockBuildGenerationFormModel).not.toHaveBeenCalled();
  });

  it("statut no_account quand le template tire en bibliothèque sans compte", async () => {
    mockSlotFindMany.mockResolvedValue([makeSlotRow({ accountId: null, account: null })]);
    mockTemplateFindMany.mockResolvedValue([{ id: "tpl-1", name: "Tpl", jsonData: JSON.stringify(makeJson()) }]);
    mockTemplateUsesLibrary.mockReturnValue(true);
    const preview = await previewBulkRenders(["slot-1"], makeCtx());
    expect(preview.rows[0]?.status).toBe("no_account");
    expect(mockBuildGenerationFormModel).not.toHaveBeenCalled();
  });

  it("statut needs_property (fiche requise, sans tirage) — fixture type RVA4 structurel via requiresEntityTypeId", async () => {
    mockSlotFindMany.mockResolvedValue([
      makeSlotRow({ entityId: null, patternTemplate: makePatternTemplate({ requiresEntityTypeId: "etype_bien" }) }),
    ]);
    mockTemplateFindMany.mockResolvedValue([{ id: "tpl-1", name: "Tpl", jsonData: JSON.stringify(makeJson()) }]);
    const preview = await previewBulkRenders(["slot-1"], makeCtx());
    expect(preview.rows[0]).toMatchObject({ status: "needs_property", reason: "Choix du bien requis" });
    expect(mockBuildGenerationFormModel).not.toHaveBeenCalled();
  });

  it("statut needs_property — fixture RVA4 : select metadata-driven vide après pré-remplissage", async () => {
    mockSlotFindMany.mockResolvedValue([makeSlotRow()]);
    mockTemplateFindMany.mockResolvedValue([{ id: "tpl-1", name: "Tpl", jsonData: JSON.stringify(makeJson()) }]);
    mockFindEmptyMetadataDrivenSelects.mockReturnValue([{ key: "client", label: "Client" }]);
    const preview = await previewBulkRenders(["slot-1"], makeCtx());
    expect(preview.rows[0]).toMatchObject({ status: "needs_property", reason: "Choix du bien requis" });
  });

  it("statut incomplete avec les libellés manquants", async () => {
    mockSlotFindMany.mockResolvedValue([makeSlotRow()]);
    mockTemplateFindMany.mockResolvedValue([{ id: "tpl-1", name: "Tpl", jsonData: JSON.stringify(makeJson()) }]);
    mockFindMissingRequiredFields.mockReturnValue(["Prix", "Surface"]);
    const preview = await previewBulkRenders(["slot-1"], makeCtx());
    expect(preview.rows[0]).toMatchObject({
      status: "incomplete",
      missingFields: ["Prix", "Surface"],
    });
  });

  it("ligne ready : construit media[] depuis fieldLibraryMap et enrichit asset/bibliothèque", async () => {
    mockSlotFindMany.mockResolvedValue([makeSlotRow()]);
    mockTemplateFindMany.mockResolvedValue([{ id: "tpl-1", name: "Tpl", jsonData: JSON.stringify(makeJson()) }]);
    mockBuildGenerationFormModel.mockResolvedValue(
      makeModel({
        finalSchema: [{ key: "clip", label: "Clip vidéo", type: "video", required: false } as never],
        initialValues: { clip: "https://r2.test/v1.mp4" },
        usageKeyByPick: { "video:block-v": { libraryId: "lib-v", usageKey: "acc-1" } },
        context: {
          fieldLibraryMap: { clip: { libraryId: "lib-v", blockId: "block-v", type: "video" } },
          initialSuggestions: { clip: { id: "asset-1", url: "https://r2.test/v1.mp4", filename: "v1.mp4" } },
          prefilledKeys: {},
          dataSuggestion: null,
          instagramAccounts: [],
        } as never,
      }),
    );
    mockMediaAssetFindMany.mockResolvedValue([{ id: "asset-1", posterUrl: "poster.jpg", duration: 12, setTag: "pack_x" }]);
    mockMediaLibraryFindMany.mockResolvedValue([{ id: "lib-v", name: "Vidéos RPI" }]);

    const preview = await previewBulkRenders(["slot-1"], makeCtx());
    const row = preview.rows[0]!;
    expect(row.status).toBe("ready");
    expect(row.media).toHaveLength(1);
    expect(row.media[0]).toMatchObject({
      blockId: "block-v",
      fieldKey: "clip",
      label: "Clip vidéo",
      kind: "video",
      libraryId: "lib-v",
      libraryName: "Vidéos RPI",
      usageKey: "lib-v|acc-1",
    });
    // setTag "pack_*" réservé → masqué (isReservedSetTag)
    expect(row.media[0]?.asset).toMatchObject({ id: "asset-1", posterUrl: "poster.jpg", duration: 12, setTag: null });
  });

  it("plafond souple : les 30 premiers sont traités, le reste part en deferred", async () => {
    const slots = Array.from({ length: 35 }, (_, i) =>
      makeSlotRow({
        id: `slot-${i}`,
        scheduledAt: new Date(2026, 8, 1 + i),
        account: { id: "acc-1", handle: "moncompte" },
      }),
    );
    mockSlotFindMany.mockResolvedValue(slots);
    mockTemplateFindMany.mockResolvedValue([{ id: "tpl-1", name: "Tpl", jsonData: JSON.stringify(makeJson()) }]);

    const preview = await previewBulkRenders(slots.map((s) => s.id), makeCtx());
    expect(preview.rows).toHaveLength(30);
    expect(preview.deferred).toBe(5);
    expect(preview.cap).toBe(30);
  });

  it("le registre n'enregistre que les lignes ready, dans l'ordre chronologique", async () => {
    // 3 slots, triés par scheduledAt : A (ready, pick asset-x) → B (incomplete,
    // ne doit rien enregistrer) → C (ready). Le mock de buildGenerationFormModel
    // consulte batchUsage pour "lib-1|acc-1" : s'il voit déjà un pick, C reçoit
    // un asset DIFFÉRENT — preuve que le registre a bien avancé après A (et pas
    // après B, qui n'est jamais ready).
    const slotA = makeSlotRow({ id: "slot-a", scheduledAt: new Date("2026-09-01T00:00:00Z") });
    const slotB = makeSlotRow({ id: "slot-b", scheduledAt: new Date("2026-09-02T00:00:00Z") });
    const slotC = makeSlotRow({ id: "slot-c", scheduledAt: new Date("2026-09-03T00:00:00Z") });
    mockSlotFindMany.mockResolvedValue([slotC, slotA, slotB]); // ordre d'entrée volontairement mélangé
    mockTemplateFindMany.mockResolvedValue([{ id: "tpl-1", name: "Tpl", jsonData: JSON.stringify(makeJson()) }]);

    const contextFor = (assetId: string) => ({
      fieldLibraryMap: { clip: { libraryId: "lib-1", blockId: "block-v", type: "video" } },
      initialSuggestions: { clip: { id: assetId, url: `https://r2.test/${assetId}.mp4`, filename: `${assetId}.mp4` } },
      prefilledKeys: {},
      dataSuggestion: null,
      instagramAccounts: [],
    });

    mockBuildGenerationFormModel.mockImplementation(async (args: { slotId: string; batchUsage?: { entriesFor: (l: string, k: string | null) => unknown } }) => {
      const alreadyPicked = args.batchUsage?.entriesFor("lib-1", "acc-1") ?? null;
      if (args.slotId === "slot-a") {
        return makeModel({
          finalSchema: [{ key: "clip", label: "Clip", type: "video", required: false } as never],
          initialValues: { clip: "u" },
          usageKeyByPick: { "video:block-v": { libraryId: "lib-1", usageKey: "acc-1" } },
          context: contextFor("asset-x") as never,
        });
      }
      if (args.slotId === "slot-b") {
        // Jamais "ready" : simplement un candidat incomplet.
        return makeModel({ finalSchema: [], initialValues: {} });
      }
      // slot-c : si le pick de A a bien été enregistré, on le voit ici.
      return makeModel({
        finalSchema: [{ key: "clip", label: "Clip", type: "video", required: false } as never],
        initialValues: { clip: "u" },
        usageKeyByPick: { "video:block-v": { libraryId: "lib-1", usageKey: "acc-1" } },
        context: contextFor(alreadyPicked ? "asset-y" : "asset-x") as never,
      });
    });

    mockFindMissingRequiredFields.mockImplementation((args: { values: Record<string, unknown> }) =>
      Object.keys(args.values).length === 0 ? ["Champ requis"] : [],
    );

    const preview = await previewBulkRenders(["slot-c", "slot-a", "slot-b"], makeCtx());
    const byId = new Map(preview.rows.map((r) => [r.slotId, r]));
    expect(byId.get("slot-a")?.status).toBe("ready");
    expect(byId.get("slot-a")?.media[0]?.asset?.id).toBe("asset-x");
    expect(byId.get("slot-b")?.status).toBe("incomplete");
    expect(byId.get("slot-c")?.status).toBe("ready");
    // La preuve : slot-c a vu le pick de slot-a dans le registre (slot-b n'a
    // rien enregistré, étant incomplete) et a donc pioché un autre asset.
    expect(byId.get("slot-c")?.media[0]?.asset?.id).toBe("asset-y");
  });

  it("musique sans binding : réutilise model.unboundAudioSuggestion au lieu de re-tirer (fix unbound-music-duration-floor-dropped / unbound-music-ignores-video-duration)", async () => {
    mockSlotFindMany.mockResolvedValue([makeSlotRow()]);
    const musicJson = makeJson({
      blocks: [{ id: "music-1", type: "music", libraryId: "lib-audio", audioSelectionRule: "least_used", minDuration: 5 } as never],
    });
    mockTemplateFindMany.mockResolvedValue([{ id: "tpl-1", name: "Tpl", jsonData: JSON.stringify(musicJson) }]);
    mockBuildGenerationFormModel.mockResolvedValue(
      makeModel({
        context: {
          fieldLibraryMap: {},
          initialSuggestions: {},
          prefilledKeys: {},
          dataSuggestion: null,
          instagramAccounts: [],
        } as never,
        usageKeyByPick: { audio: { libraryId: "lib-audio", usageKey: "acc-1" } },
        unboundAudioSuggestion: { id: "asset-long", url: "https://r2.test/long.mp3", filename: "long.mp3" },
        // Plancher calculé par le résolveur (durée vidéo estimée) — supérieur
        // au `minDuration` du bloc (5s) : le picker doit prendre le plus grand.
        audioMinDuration: 42,
      }),
    );
    mockMediaLibraryFindMany.mockResolvedValue([{ id: "lib-audio", name: "Musiques" }]);

    const preview = await previewBulkRenders(["slot-1"], makeCtx());
    const row = preview.rows[0]!;
    expect(row.status).toBe("ready");
    expect(mockSelectMediaAsset).not.toHaveBeenCalled();
    expect(row.media).toHaveLength(1);
    expect(row.media[0]).toMatchObject({
      blockId: "music-1",
      kind: "audio",
      libraryId: "lib-audio",
      libraryName: "Musiques",
      usageKey: "lib-audio|acc-1",
    });
    expect(row.media[0]?.asset).toMatchObject({ id: "asset-long" });
    // max(minDuration bloc=5, audioMinDuration résolveur=42) = 42
    expect(row.media[0]?.picker.minDuration).toBe(42);
  });

  it("statut incomplete quand le template a une DataLibrary mais aucune entrée résolue (fix ready-row-without-dataentry-always-fails / data-null-ready-then-launch-fails)", async () => {
    mockSlotFindMany.mockResolvedValue([makeSlotRow()]);
    const dataJson = makeJson({ contentLibrary: { dataLibraryId: "data-lib-1" } } as never);
    mockTemplateFindMany.mockResolvedValue([{ id: "tpl-1", name: "Tpl", jsonData: JSON.stringify(dataJson) }]);
    mockBuildGenerationFormModel.mockResolvedValue(
      makeModel({
        context: {
          fieldLibraryMap: {},
          initialSuggestions: {},
          prefilledKeys: {},
          dataSuggestion: null, // rule 'manual' / rotationMode 'none' / pool épuisé…
          instagramAccounts: [],
        } as never,
      }),
    );
    // Les champs texte sont optionnels : sans le garde-fou, la ligne serait 'ready'.
    mockFindMissingRequiredFields.mockReturnValue([]);

    const preview = await previewBulkRenders(["slot-1"], makeCtx());
    expect(preview.rows[0]).toMatchObject({
      status: "incomplete",
      reason: "Fiche de données indisponible",
      missingFields: ["Fiche de données"],
      media: [],
      data: null,
    });
  });

  it("marque media.locked=true pour un blockId metadata-driven (fix metadata-driven-swap-dropped)", async () => {
    mockSlotFindMany.mockResolvedValue([makeSlotRow()]);
    mockTemplateFindMany.mockResolvedValue([{ id: "tpl-1", name: "Tpl", jsonData: JSON.stringify(makeJson()) }]);
    mockBuildGenerationFormModel.mockResolvedValue(
      makeModel({
        finalSchema: [{ key: "rva3raw", label: "Vidéo bien", type: "video", required: false } as never],
        context: {
          fieldLibraryMap: { rva3raw: { libraryId: "lib-v", blockId: "slot-seq-1", type: "video" } },
          initialSuggestions: { rva3raw: { id: "asset-meta", url: "u", filename: "f" } },
          prefilledKeys: {},
          dataSuggestion: null,
          instagramAccounts: [],
          metadataDrivenLinks: [
            { sourceFieldKey: "client", targetFieldKey: "rva3raw", libraryId: "lib-meta", metadataKey: "nom_client" },
          ],
        } as never,
        usageKeyByPick: { "video:slot-seq-1": { libraryId: "lib-v", usageKey: "acc-1" } },
      }),
    );
    mockMediaAssetFindMany.mockResolvedValue([{ id: "asset-meta", posterUrl: null, duration: null, setTag: null }]);
    mockMediaLibraryFindMany.mockResolvedValue([{ id: "lib-v", name: "Vidéos" }]);

    const preview = await previewBulkRenders(["slot-1"], makeCtx());
    expect(preview.rows[0]?.media[0]).toMatchObject({ blockId: "slot-seq-1", locked: true });
  });

  it("dédoublonne par blockId quand deux clés d'alias pointent le même bloc — une cellule, un seul ledger.record (fix alias-fieldkey-double-ledger-record / ledger-double-record-same-block)", async () => {
    const slotA = makeSlotRow({ id: "slot-a", scheduledAt: new Date("2026-09-01T00:00:00Z") });
    const slotB = makeSlotRow({ id: "slot-b", scheduledAt: new Date("2026-09-02T00:00:00Z") });
    mockSlotFindMany.mockResolvedValue([slotA, slotB]);
    mockTemplateFindMany.mockResolvedValue([{ id: "tpl-1", name: "Tpl", jsonData: JSON.stringify(makeJson()) }]);

    // Layout RVA3/RVA4 : le slot séquence "CONTENT" (pas de binding) est relié
    // via videoBlockId au bloc "rva3raw" (qui a un binding) — même blockId
    // (slot-seq-1) sous les deux clés de fieldLibraryMap.
    const aliasContext = (assetId: string) => ({
      fieldLibraryMap: {
        content: { libraryId: "lib-1", blockId: "slot-seq-1", type: "video" },
        rva3raw: { libraryId: "lib-1", blockId: "slot-seq-1", type: "video" },
      },
      initialSuggestions: {
        content: { id: assetId, url: "u", filename: "f" },
        rva3raw: { id: assetId, url: "u", filename: "f" },
      },
      prefilledKeys: {},
      dataSuggestion: null,
      instagramAccounts: [],
    });

    let capturedNs: number[] | undefined;
    mockBuildGenerationFormModel.mockImplementation(
      async (args: { slotId: string; batchUsage?: { entriesFor: (l: string, k: string | null) => { ns: number[] } | null } }) => {
        if (args.slotId === "slot-a") {
          return makeModel({
            finalSchema: [{ key: "rva3raw", label: "Contenu", type: "video", required: false } as never],
            usageKeyByPick: { "video:slot-seq-1": { libraryId: "lib-1", usageKey: "acc-1" } },
            context: aliasContext("asset-x") as never,
          });
        }
        // slot-b lit le registre après slot-a : si le dédoublonnage a bien
        // gardé UN SEUL ledger.record, n vaut 1 (pas 2) pour asset-x.
        capturedNs = args.batchUsage?.entriesFor("lib-1", "acc-1")?.ns;
        return makeModel({
          finalSchema: [{ key: "rva3raw", label: "Contenu", type: "video", required: false } as never],
          usageKeyByPick: { "video:slot-seq-1": { libraryId: "lib-1", usageKey: "acc-1" } },
          context: aliasContext("asset-y") as never,
        });
      },
    );

    const preview = await previewBulkRenders(["slot-a", "slot-b"], makeCtx());
    const rowA = preview.rows.find((r) => r.slotId === "slot-a")!;
    expect(rowA.media).toHaveLength(1); // une seule cellule, pas deux
    expect(rowA.media[0]).toMatchObject({ fieldKey: "rva3raw", blockId: "slot-seq-1" }); // clé de finalSchema préférée
    expect(capturedNs).toEqual([1]);
  });
});

// ════════════════════════════════════════════════════════════════════════
// launchBulkRenders
// ════════════════════════════════════════════════════════════════════════

describe("launchBulkRenders", () => {
  function baseItem(overrides: Partial<BulkRenderLaunchItem> = {}): BulkRenderLaunchItem {
    return { slotId: "slot-1", videoAssets: {}, changedBlockIds: [], ...overrides };
  }

  it("refuse un non-admin sans toucher la base", async () => {
    await expect(launchBulkRenders([baseItem()], makeCtx("CM"))).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockSlotFindUnique).not.toHaveBeenCalled();
  });

  it("refuse plus de 30 items", async () => {
    const items = Array.from({ length: 31 }, (_, i) => baseItem({ slotId: `slot-${i}` }));
    await expect(launchBulkRenders(items, makeCtx())).rejects.toBeInstanceOf(ValidationError);
    expect(mockSlotFindUnique).not.toHaveBeenCalled();
  });

  it("dédoublonne par slotId (garde la première occurrence)", async () => {
    mockSlotFindUnique.mockResolvedValue(makeSlotRow());
    mockTemplateFindUnique.mockResolvedValue({ jsonData: JSON.stringify(makeJson()) });
    const { results } = await launchBulkRenders([baseItem(), baseItem()], makeCtx());
    expect(results).toHaveLength(1);
    expect(mockSlotFindUnique).toHaveBeenCalledTimes(1);
  });

  it("code not_eligible quand la publication est introuvable", async () => {
    mockSlotFindUnique.mockResolvedValue(null);
    const { results } = await launchBulkRenders([baseItem()], makeCtx());
    expect(results[0]).toMatchObject({ slotId: "slot-1", ok: false, code: "not_eligible" });
  });

  it("code not_eligible sur statut terminal", async () => {
    mockSlotFindUnique.mockResolvedValue(makeSlotRow({ status: "PUBLISHED" }));
    const { results } = await launchBulkRenders([baseItem()], makeCtx());
    expect(results[0]).toMatchObject({ ok: false, code: "not_eligible" });
  });

  it("code not_eligible quand déjà rendue", async () => {
    mockSlotFindUnique.mockResolvedValue(makeSlotRow({ render: { status: "DONE" } }));
    const { results } = await launchBulkRenders([baseItem()], makeCtx());
    expect(results[0]).toMatchObject({ ok: false, code: "not_eligible" });
  });

  it("code in_flight quand un rendu est déjà en vol, les autres items continuent", async () => {
    mockSlotFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      makeSlotRow({ id: where.id }),
    );
    mockTemplateFindUnique.mockResolvedValue({ jsonData: JSON.stringify(makeJson()) });
    mockFindInFlightRender.mockImplementation(async (slotId: string) =>
      slotId === "slot-1" ? { id: "render-x", status: "PROCESSING" } : null,
    );

    const { results } = await launchBulkRenders(
      [baseItem({ slotId: "slot-1" }), baseItem({ slotId: "slot-2" })],
      makeCtx(),
    );
    expect(results).toEqual([
      { slotId: "slot-1", ok: false, code: "in_flight", error: expect.any(String) },
      { slotId: "slot-2", ok: true, renderId: "render-1" },
    ]);
    expect(mockCreateAndStartRender).toHaveBeenCalledTimes(1);
  });

  it("invalid_asset quand le blockId n'est pas dans les blocs autorisés", async () => {
    mockSlotFindUnique.mockResolvedValue(makeSlotRow());
    mockTemplateFindUnique.mockResolvedValue({ jsonData: JSON.stringify(makeJson()) });
    // dryModel : aucun bloc autorisé.
    mockBuildGenerationFormModel.mockResolvedValue(makeModel({ context: undefined }));

    const { results } = await launchBulkRenders(
      [baseItem({ videoAssets: { "block-inconnu": "asset-1" } })],
      makeCtx(),
    );
    expect(results[0]).toMatchObject({ ok: false, code: "invalid_asset" });
    expect(mockCreateListingForRender).not.toHaveBeenCalled();
  });

  it("invalid_asset quand l'asset appartient à une autre bibliothèque", async () => {
    mockSlotFindUnique.mockResolvedValue(makeSlotRow());
    mockTemplateFindUnique.mockResolvedValue({ jsonData: JSON.stringify(makeJson()) });
    mockBuildGenerationFormModel.mockResolvedValue(
      makeModel({
        context: {
          fieldLibraryMap: { clip: { libraryId: "lib-attendue", blockId: "block-v", type: "video" } },
          initialSuggestions: {},
          prefilledKeys: {},
          dataSuggestion: null,
          instagramAccounts: [],
        } as never,
      }),
    );
    mockMediaAssetFindMany.mockResolvedValue([
      { id: "asset-1", libraryId: "lib-autre", disabled: false, url: "u", filename: "f" },
    ]);

    const { results } = await launchBulkRenders(
      [baseItem({ videoAssets: { "block-v": "asset-1" } })],
      makeCtx(),
    );
    expect(results[0]).toMatchObject({ ok: false, code: "invalid_asset" });
  });

  it("invalid_data_entry quand la fiche appartient à une autre bibliothèque", async () => {
    mockSlotFindUnique.mockResolvedValue(makeSlotRow());
    mockTemplateFindUnique.mockResolvedValue({
      jsonData: JSON.stringify(makeJson({ contentLibrary: { dataLibraryId: "data-lib-attendue" } } as never)),
    });
    mockBuildGenerationFormModel.mockResolvedValue(makeModel({ context: undefined }));
    mockDataEntryFindUnique.mockResolvedValue({
      id: "entry-1",
      libraryId: "data-lib-autre",
      fields: "{}",
      setTag: null,
      accesses: [],
    });

    const { results } = await launchBulkRenders(
      [baseItem({ dataEntryId: "entry-1" })],
      makeCtx(),
    );
    expect(results[0]).toMatchObject({ ok: false, code: "invalid_data_entry" });
  });

  it("missing_fields quand le template attend une fiche de données et qu'aucune n'est fournie — jamais de redraw", async () => {
    mockSlotFindUnique.mockResolvedValue(makeSlotRow());
    mockTemplateFindUnique.mockResolvedValue({
      jsonData: JSON.stringify(makeJson({ contentLibrary: { dataLibraryId: "data-lib-1" } } as never)),
    });
    mockBuildGenerationFormModel.mockResolvedValue(makeModel({ context: undefined }));

    const { results } = await launchBulkRenders([baseItem()], makeCtx());
    expect(results[0]).toMatchObject({ ok: false, code: "missing_fields" });
    expect(mockDataEntryFindUnique).not.toHaveBeenCalled();
  });

  it("écrit __provenance = manual pour les blocks changés, et laisse les autres inchangés", async () => {
    mockSlotFindUnique.mockResolvedValue(makeSlotRow());
    mockTemplateFindUnique.mockResolvedValue({ jsonData: JSON.stringify(makeJson()) });
    const context = {
      fieldLibraryMap: {
        clip: { libraryId: "lib-v", blockId: "block-v", type: "video" },
        song: { libraryId: "lib-a", blockId: "block-a", type: "audio" },
      },
      initialSuggestions: {},
      prefilledKeys: {},
      dataSuggestion: null,
      instagramAccounts: [],
    };
    mockBuildGenerationFormModel.mockResolvedValue(
      makeModel({
        finalSchema: [
          { key: "clip", label: "Clip", type: "video", required: false } as never,
          { key: "song", label: "Musique", type: "text", required: false } as never,
        ],
        initialValues: { clip: "https://r2.test/v1.mp4", song: "https://r2.test/a1.mp3" },
        provenance: {},
        context: context as never,
      }),
    );
    mockMediaAssetFindMany.mockResolvedValue([
      { id: "asset-v", libraryId: "lib-v", disabled: false, url: "https://r2.test/v1.mp4", filename: "v1.mp4" },
    ]);

    await launchBulkRenders(
      [baseItem({ videoAssets: { "block-v": "asset-v" }, changedBlockIds: ["block-v"] })],
      makeCtx(),
    );

    expect(mockCreateListingForRender).toHaveBeenCalledTimes(1);
    const listingArg = mockCreateListingForRender.mock.calls[0]![0] as { data: Record<string, unknown> };
    const provenance = listingArg.data.__provenance as Record<string, string>;
    expect(provenance.clip).toBe("manual");
    expect(provenance.song).not.toBe("manual");
  });

  it("fusionne l'audioAssetId d'une musique sans binding dans usedAssets", async () => {
    mockSlotFindUnique.mockResolvedValue(makeSlotRow());
    const musicJson = makeJson({
      blocks: [{ id: "music-1", type: "music", libraryId: "lib-audio", audioSelectionRule: "least_used" } as never],
    });
    mockTemplateFindUnique.mockResolvedValue({ jsonData: JSON.stringify(musicJson) });
    // dryModel : pas de champ formulaire pour la musique (non bindée) → fieldLibraryMap vide.
    mockBuildGenerationFormModel.mockResolvedValue(makeModel({ context: undefined }));
    mockMediaAssetFindMany.mockResolvedValue([
      { id: "asset-audio-1", libraryId: "lib-audio", disabled: false, url: "https://r2.test/a1.mp3", filename: "a1.mp3" },
    ]);

    await launchBulkRenders([baseItem({ audioAssetId: "asset-audio-1" })], makeCtx());

    expect(mockCreateAndStartRender).toHaveBeenCalledTimes(1);
    const [body] = mockCreateAndStartRender.mock.calls[0]! as [{ usedAssets?: { audioAssetId?: string } }];
    expect(body.usedAssets?.audioAssetId).toBe("asset-audio-1");
  });

  it("invalid_asset quand une musique est fournie mais que le template n'en attend aucune", async () => {
    mockSlotFindUnique.mockResolvedValue(makeSlotRow());
    mockTemplateFindUnique.mockResolvedValue({ jsonData: JSON.stringify(makeJson()) });
    mockBuildGenerationFormModel.mockResolvedValue(makeModel({ context: undefined }));

    const { results } = await launchBulkRenders([baseItem({ audioAssetId: "asset-audio-1" })], makeCtx());
    expect(results[0]).toMatchObject({ ok: false, code: "invalid_asset" });
  });

  it("invalid_asset quand changedBlockIds cible un blockId metadata-driven (fix metadata-driven-swap-dropped, lancement)", async () => {
    mockSlotFindUnique.mockResolvedValue(makeSlotRow());
    mockTemplateFindUnique.mockResolvedValue({ jsonData: JSON.stringify(makeJson()) });
    mockBuildGenerationFormModel.mockResolvedValue(
      makeModel({
        context: {
          fieldLibraryMap: { rva3raw: { libraryId: "lib-v", blockId: "slot-seq-1", type: "video" } },
          initialSuggestions: {},
          prefilledKeys: {},
          dataSuggestion: null,
          instagramAccounts: [],
          metadataDrivenLinks: [
            { sourceFieldKey: "client", targetFieldKey: "rva3raw", libraryId: "lib-meta", metadataKey: "nom_client" },
          ],
        } as never,
      }),
    );

    const { results } = await launchBulkRenders(
      [baseItem({ changedBlockIds: ["slot-seq-1"] })],
      makeCtx(),
    );
    expect(results[0]).toMatchObject({ ok: false, code: "invalid_asset" });
    expect(mockCreateListingForRender).not.toHaveBeenCalled();
  });

  it("not_eligible quand un select metadata-driven reste vide au lancement (fix launch-skips-empty-metadata-select-gate)", async () => {
    mockSlotFindUnique.mockResolvedValue(makeSlotRow());
    mockTemplateFindUnique.mockResolvedValue({ jsonData: JSON.stringify(makeJson()) });
    mockBuildGenerationFormModel.mockResolvedValue(makeModel({ context: undefined }));
    mockFindEmptyMetadataDrivenSelects.mockReturnValue([{ key: "client", label: "Client" }]);

    const { results } = await launchBulkRenders([baseItem()], makeCtx());
    expect(results[0]).toMatchObject({ ok: false, code: "not_eligible" });
    expect(mockCreateListingForRender).not.toHaveBeenCalled();
  });

  it("invalid_asset quand la musique choisie est plus courte que la vidéo réellement résolue (fix unbound-music-*, garde au lancement)", async () => {
    mockSlotFindUnique.mockResolvedValue(makeSlotRow());
    const musicJson = makeJson({
      blocks: [{ id: "music-1", type: "music", libraryId: "lib-audio", audioSelectionRule: "least_used" } as never],
    });
    mockTemplateFindUnique.mockResolvedValue({ jsonData: JSON.stringify(musicJson) });
    mockBuildGenerationFormModel.mockResolvedValue(
      makeModel({
        context: {
          fieldLibraryMap: { clip: { libraryId: "lib-v", blockId: "block-v", type: "video" } },
          initialSuggestions: {},
          prefilledKeys: {},
          dataSuggestion: null,
          instagramAccounts: [],
        } as never,
      }),
    );
    mockMediaAssetFindMany.mockResolvedValue([
      { id: "asset-v", libraryId: "lib-v", disabled: false, url: "u", filename: "f", duration: 60 },
      { id: "asset-audio-short", libraryId: "lib-audio", disabled: false, url: "u", filename: "f", duration: 10 },
    ]);

    const { results } = await launchBulkRenders(
      [baseItem({ videoAssets: { "block-v": "asset-v" }, audioAssetId: "asset-audio-short" })],
      makeCtx(),
    );
    expect(results[0]).toMatchObject({ ok: false, code: "invalid_asset" });
    expect(mockCreateListingForRender).not.toHaveBeenCalled();
  });

  it("accepte une musique assez longue pour la vidéo réellement résolue", async () => {
    mockSlotFindUnique.mockResolvedValue(makeSlotRow());
    const musicJson = makeJson({
      blocks: [{ id: "music-1", type: "music", libraryId: "lib-audio", audioSelectionRule: "least_used" } as never],
    });
    mockTemplateFindUnique.mockResolvedValue({ jsonData: JSON.stringify(musicJson) });
    mockBuildGenerationFormModel.mockResolvedValue(
      makeModel({
        context: {
          fieldLibraryMap: { clip: { libraryId: "lib-v", blockId: "block-v", type: "video" } },
          initialSuggestions: {},
          prefilledKeys: {},
          dataSuggestion: null,
          instagramAccounts: [],
        } as never,
      }),
    );
    mockMediaAssetFindMany.mockResolvedValue([
      { id: "asset-v", libraryId: "lib-v", disabled: false, url: "u", filename: "f", duration: 60 },
      { id: "asset-audio-ok", libraryId: "lib-audio", disabled: false, url: "u", filename: "f", duration: 90 },
    ]);

    const { results } = await launchBulkRenders(
      [baseItem({ videoAssets: { "block-v": "asset-v" }, audioAssetId: "asset-audio-ok" })],
      makeCtx(),
    );
    expect(results[0]).toMatchObject({ ok: true, renderId: "render-1" });
  });
});
