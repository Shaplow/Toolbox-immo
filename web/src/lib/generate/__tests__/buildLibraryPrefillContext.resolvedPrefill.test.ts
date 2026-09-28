/**
 * Mode validation du lot (`resolvedPrefill`) — plan « lancer les rendus
 * depuis le calendrier », étape 3/4. Le service de lot connaît déjà les
 * picks exacts de l'aperçu (éventuellement modifiés via « Changer ») : le
 * serveur ne doit JAMAIS re-tirer au lancement, sinon décocher une ligne
 * décalerait toutes les suivantes (cf. `types/bulkRender.ts`).
 *
 * Miroir de `buildLibraryPrefillContext.test.ts` (précédence fiche >
 * DataEntry), qui couvre déjà le mode tirage frais — celui-ci ne couvre QUE
 * la branche `resolvedPrefill`.
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
import type { LibraryPrefill } from "@/lib/contentLibraryResolver";

const SCHEMA: SchemaField[] = [
  { key: "clip", label: "Clip", type: "text", required: false },
  { key: "song", label: "Musique", type: "text", required: false },
];

function makeJson(): TemplateJSON {
  return {
    canvas: {} as TemplateJSON["canvas"],
    theme: {} as TemplateJSON["theme"],
    blocks: [
      { id: "block-video-1", type: "video", binding: "clip", libraryId: "lib-video", selectionRule: "least_used" },
      { id: "block-music-1", type: "music", binding: "song", libraryId: "lib-audio", audioSelectionRule: "least_used" },
    ],
    groups: [],
    formSections: [],
    schema: SCHEMA,
  } as unknown as TemplateJSON;
}

function makeResolvedPrefill(): LibraryPrefill {
  return {
    videoSuggestions: {
      "block-video-1": { id: "v9", url: "https://r2.test/v9.mp4", filename: "v9.mp4" },
    },
    audioSuggestion: { id: "a9", url: "https://r2.test/a9.mp3", filename: "a9.mp3" },
    dataSuggestion: null,
    setSequencedLibraryIds: [],
    usedSetTagByLibrary: {},
    usageKeyByPick: {
      "video:block-video-1": { libraryId: "lib-video", usageKey: "acc-1" },
      audio: { libraryId: "lib-audio", usageKey: "acc-1" },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInstagramAccountFindMany.mockResolvedValue([]);
});

describe("buildLibraryPrefillContext — mode validation du lot (resolvedPrefill)", () => {
  it("n'appelle JAMAIS resolveLibraryPrefill quand resolvedPrefill est fourni", async () => {
    await buildLibraryPrefillContext({
      json: makeJson(),
      mergedSchema: SCHEMA,
      initialValues: undefined,
      accountId: "acc-1",
      slotId: "slot-1",
      listingId: null,
      resolvedPrefill: makeResolvedPrefill(),
    });
    expect(mockResolveLibraryPrefill).not.toHaveBeenCalled();
  });

  it("applique les picks donnés aux mêmes boucles que le tirage frais (binding vidéo + musique)", async () => {
    const { context, updatedInitialValues } = await buildLibraryPrefillContext({
      json: makeJson(),
      mergedSchema: SCHEMA,
      initialValues: undefined,
      accountId: "acc-1",
      slotId: "slot-1",
      listingId: null,
      resolvedPrefill: makeResolvedPrefill(),
    });

    expect(updatedInitialValues?.clip).toBe("https://r2.test/v9.mp4");
    expect(updatedInitialValues?.song).toBe("https://r2.test/a9.mp3");
    expect(context?.initialSuggestions.clip).toEqual({ id: "v9", url: "https://r2.test/v9.mp4", filename: "v9.mp4" });
    expect(context?.initialSuggestions.song).toEqual({ id: "a9", url: "https://r2.test/a9.mp3", filename: "a9.mp3" });
  });

  it("propage usageKeyByPick tel que reçu de resolvedPrefill", async () => {
    const { usageKeyByPick } = await buildLibraryPrefillContext({
      json: makeJson(),
      mergedSchema: SCHEMA,
      initialValues: undefined,
      accountId: "acc-1",
      slotId: "slot-1",
      listingId: null,
      resolvedPrefill: makeResolvedPrefill(),
    });
    expect(usageKeyByPick).toEqual({
      "video:block-video-1": { libraryId: "lib-video", usageKey: "acc-1" },
      audio: { libraryId: "lib-audio", usageKey: "acc-1" },
    });
  });

  it("resolvedPrefill est prioritaire même si listingId est fourni (pas de re-match par URL)", async () => {
    const { updatedInitialValues } = await buildLibraryPrefillContext({
      json: makeJson(),
      mergedSchema: SCHEMA,
      initialValues: { clip: "https://old.test/stale.mp4" },
      accountId: "acc-1",
      slotId: "slot-1",
      listingId: "listing-existing",
      resolvedPrefill: makeResolvedPrefill(),
    });
    // Le pick du lot l'emporte sur la valeur déjà stockée dans le listing —
    // aucun re-match par URL (mediaAsset.findFirst) n'a lieu.
    expect(updatedInitialValues?.clip).toBe("https://r2.test/v9.mp4");
    expect(mockMediaAssetFindFirst).not.toHaveBeenCalled();
    expect(mockResolveLibraryPrefill).not.toHaveBeenCalled();
  });

  it("sans resolvedPrefill ni listingId : le tirage frais habituel appelle resolveLibraryPrefill (non-régression)", async () => {
    mockResolveLibraryPrefill.mockResolvedValue({
      videoSuggestions: {},
      audioSuggestion: null,
      dataSuggestion: null,
      setSequencedLibraryIds: [],
      usedSetTagByLibrary: {},
    });
    await buildLibraryPrefillContext({
      json: makeJson(),
      mergedSchema: SCHEMA,
      initialValues: undefined,
      accountId: "acc-1",
      slotId: "slot-1",
      listingId: null,
    });
    expect(mockResolveLibraryPrefill).toHaveBeenCalledTimes(1);
  });

  it("musique bindée : n'expose PAS unboundAudioSuggestion (le pick est déjà appliqué via initialSuggestions)", async () => {
    const { unboundAudioSuggestion } = await buildLibraryPrefillContext({
      json: makeJson(),
      mergedSchema: SCHEMA,
      initialValues: undefined,
      accountId: "acc-1",
      slotId: "slot-1",
      listingId: null,
      resolvedPrefill: makeResolvedPrefill(),
    });
    expect(unboundAudioSuggestion).toBeUndefined();
  });
});

/**
 * Fix unbound-music-duration-floor-dropped / unbound-music-ignores-video-duration :
 * une musique SANS binding (`musicBlock.libraryId` posé, pas de
 * `musicBlock.binding`) n'a aucun champ de formulaire — la boucle
 * d'application n'y touche donc jamais `prefill.audioSuggestion`, qui
 * repartait silencieusement à la poubelle. `unboundAudioSuggestion` /
 * `audioMinDuration` récupèrent ce pick (et son plancher de durée) pour un
 * appelant qui ne consomme pas `initialSuggestions` (`bulkRenderService`).
 */
describe("buildLibraryPrefillContext — musique SANS binding (unboundAudioSuggestion)", () => {
  function makeUnboundMusicJson(): TemplateJSON {
    return {
      canvas: {} as TemplateJSON["canvas"],
      theme: {} as TemplateJSON["theme"],
      blocks: [
        { id: "music-1", type: "music", libraryId: "lib-audio", audioSelectionRule: "least_used", minDuration: 5 },
      ],
      groups: [],
      formSections: [],
      schema: [],
    } as unknown as TemplateJSON;
  }

  it("tirage frais : récupère le pick + le plancher calculés par resolveLibraryPrefill", async () => {
    mockResolveLibraryPrefill.mockResolvedValue({
      videoSuggestions: {},
      audioSuggestion: { id: "a-long", url: "https://r2.test/a-long.mp3", filename: "a-long.mp3" },
      dataSuggestion: null,
      setSequencedLibraryIds: [],
      usedSetTagByLibrary: {},
      audioMinDuration: 42,
      usageKeyByPick: { audio: { libraryId: "lib-audio", usageKey: "acc-1" } },
    });

    const { unboundAudioSuggestion, audioMinDuration, updatedInitialValues } = await buildLibraryPrefillContext({
      json: makeUnboundMusicJson(),
      mergedSchema: [],
      initialValues: undefined,
      accountId: "acc-1",
      slotId: "slot-1",
      listingId: null,
    });

    expect(unboundAudioSuggestion).toEqual({ id: "a-long", url: "https://r2.test/a-long.mp3", filename: "a-long.mp3" });
    expect(audioMinDuration).toBe(42);
    // Aucun champ de formulaire pour cette musique : `initialValues` n'est pas
    // touché par le pick (c'est précisément pourquoi il fallait l'exposer à part).
    expect(updatedInitialValues).toBeUndefined();
  });

  it("mode validation du lot (resolvedPrefill) : même récupération, sans re-tirer", async () => {
    const { unboundAudioSuggestion } = await buildLibraryPrefillContext({
      json: makeUnboundMusicJson(),
      mergedSchema: [],
      initialValues: undefined,
      accountId: "acc-1",
      slotId: "slot-1",
      listingId: null,
      resolvedPrefill: {
        videoSuggestions: {},
        audioSuggestion: { id: "a-chosen", url: "https://r2.test/a-chosen.mp3", filename: "a-chosen.mp3" },
        dataSuggestion: null,
        setSequencedLibraryIds: [],
        usedSetTagByLibrary: {},
      },
    });
    expect(mockResolveLibraryPrefill).not.toHaveBeenCalled();
    expect(unboundAudioSuggestion).toEqual({ id: "a-chosen", url: "https://r2.test/a-chosen.mp3", filename: "a-chosen.mp3" });
  });

  it("résolveur sans pick (pool vide) → unboundAudioSuggestion null, pas undefined", async () => {
    mockResolveLibraryPrefill.mockResolvedValue({
      videoSuggestions: {},
      audioSuggestion: null,
      dataSuggestion: null,
      setSequencedLibraryIds: [],
      usedSetTagByLibrary: {},
    });
    const { unboundAudioSuggestion } = await buildLibraryPrefillContext({
      json: makeUnboundMusicJson(),
      mergedSchema: [],
      initialValues: undefined,
      accountId: "acc-1",
      slotId: "slot-1",
      listingId: null,
    });
    expect(unboundAudioSuggestion).toBeNull();
  });
});
