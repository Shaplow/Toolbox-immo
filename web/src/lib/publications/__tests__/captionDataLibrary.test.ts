/**
 * Tests resolveCaptionWithDataLibrary — orchestrateur du tirage DataLibrary
 * pour la légende pré-remplie (Wave 4 — bibliothèque de données comme source
 * de légendes qui varient par compte et tournent dans le temps).
 *
 * `selectDataEntry` (lecture DB) est mocké ; `resolvePrefilledCaptionFromEntities`
 * (résolution pure) est le vrai module — l'intégration réelle des deux est ce
 * qu'on veut couvrir.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelectDataEntry = vi.fn();
const mockDataLibraryFindUnique = vi.fn();

vi.mock("@/lib/contentLibraryResolver", () => ({
  selectDataEntry: (...args: unknown[]) => mockSelectDataEntry(...args),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dataLibrary: { findUnique: (...args: unknown[]) => mockDataLibraryFindUnique(...args) },
  },
}));

import { resolveCaptionWithDataLibrary } from "@/lib/publications/captionDataLibrary";

beforeEach(() => {
  vi.clearAllMocks();
  mockDataLibraryFindUnique.mockResolvedValue({ rotationScope: "per_account" });
});

const baseConfig = {
  needsDescription: "preFilled",
  descriptionFixedText: "🏡 {{adresse}} — {{ville}}",
  descriptionSourceFieldKey: null,
  descriptionDataLibraryId: "lib-1" as string | null,
};

describe("resolveCaptionWithDataLibrary", () => {
  it("sans descriptionDataLibraryId → délégation pure 3-sources, aucun accès DB", async () => {
    const res = await resolveCaptionWithDataLibrary({
      config: { ...baseConfig, descriptionDataLibraryId: null },
      accountId: "acc-1",
      storedEntry: null,
      shootEntityFieldsJson: null,
      entityFieldsJson: JSON.stringify({ adresse: "12 rue de la Paix", ville: "Paris" }),
    });
    expect(res).toEqual({
      caption: "🏡 12 rue de la Paix — Paris",
      usedEntry: null,
      drewNewEntry: false,
    });
    expect(mockSelectDataEntry).not.toHaveBeenCalled();
    expect(mockDataLibraryFindUnique).not.toHaveBeenCalled();
  });

  it("storedEntry présent + pas de redraw → réutilisation, aucun tirage", async () => {
    const res = await resolveCaptionWithDataLibrary({
      config: baseConfig,
      accountId: "acc-1",
      storedEntry: { id: "e-stored", fields: JSON.stringify({ adresse: "Depuis storedEntry", ville: "Lyon" }), setTag: "quartiers", libraryId: "lib-1" },
      shootEntityFieldsJson: null,
      entityFieldsJson: null,
    });
    expect(mockSelectDataEntry).not.toHaveBeenCalled();
    expect(res.drewNewEntry).toBe(false);
    expect(res.usedEntry).toEqual({
      entryId: "e-stored",
      fields: { adresse: "Depuis storedEntry", ville: "Lyon" },
      setTag: "quartiers",
      libraryId: "lib-1",
    });
    expect(res.caption).toBe("🏡 Depuis storedEntry — Lyon");
  });

  it("redraw=true ignore storedEntry et tire une nouvelle entrée", async () => {
    mockSelectDataEntry.mockResolvedValue({
      entryId: "e-new",
      fields: { adresse: "Nouvelle entrée", ville: "Nice" },
      resolvedSetTag: "nouveaux",
    });
    const res = await resolveCaptionWithDataLibrary({
      config: baseConfig,
      accountId: "acc-1",
      storedEntry: { id: "e-stored", fields: JSON.stringify({ adresse: "Ancienne entrée" }), setTag: null, libraryId: "lib-1" },
      redraw: true,
      shootEntityFieldsJson: null,
      entityFieldsJson: null,
    });
    expect(mockSelectDataEntry).toHaveBeenCalledWith("lib-1", undefined, "acc-1");
    expect(res.drewNewEntry).toBe(true);
    expect(res.usedEntry?.entryId).toBe("e-new");
    expect(res.caption).toBe("🏡 Nouvelle entrée — Nice");
  });

  it("garde anti-gaspillage : modèle sans clé du candidat → candidat jeté, pas de claim", async () => {
    mockSelectDataEntry.mockResolvedValue({
      entryId: "e-unrelated",
      fields: { quartier: "Marais" }, // ne correspond à aucune {{clé}} du modèle (adresse/ville)
      resolvedSetTag: "quartiers",
    });
    const res = await resolveCaptionWithDataLibrary({
      config: baseConfig,
      accountId: "acc-1",
      storedEntry: null,
      shootEntityFieldsJson: null,
      entityFieldsJson: JSON.stringify({ adresse: "12 rue de la Paix", ville: "Paris" }),
    });
    expect(res.usedEntry).toBeNull();
    expect(res.drewNewEntry).toBe(false);
    // La légende reste résolue via les fiches seules — le candidat jeté n'a
    // pas pollué le contexte de templating.
    expect(res.caption).toBe("🏡 12 rue de la Paix — Paris");
  });

  it("résolution finale vide/blanche → drewNewEntry toujours false même si un candidat a été tiré", async () => {
    mockSelectDataEntry.mockResolvedValue({
      entryId: "e-blank",
      fields: { adresse: "" }, // référencé par le modèle, mais vide
      resolvedSetTag: null,
    });
    // Modèle réduit à la seule variable (pas de texte littéral autour) pour
    // que le résultat "vide" trimme réellement à "" — cf. règle « jamais de
    // wipe » de resolvePrefilledCaption.
    const bareConfig = { ...baseConfig, descriptionFixedText: "{{adresse}}" };
    const res = await resolveCaptionWithDataLibrary({
      config: bareConfig,
      accountId: "acc-1",
      storedEntry: null,
      shootEntityFieldsJson: null,
      entityFieldsJson: null,
    });
    expect(res.caption).toBeNull();
    expect(res.usedEntry).toBeNull();
    expect(res.drewNewEntry).toBe(false);
  });

  it("mode legacy (descriptionSourceFieldKey) : la clé legacy compte comme variable du modèle pour la garde anti-gaspillage", async () => {
    mockSelectDataEntry.mockResolvedValue({
      entryId: "e-legacy",
      fields: { prix: "350 000 €" },
      resolvedSetTag: null,
    });
    const legacyConfig = {
      needsDescription: "preFilled",
      descriptionFixedText: null,
      descriptionSourceFieldKey: "prix",
      descriptionDataLibraryId: "lib-1",
    };
    const res = await resolveCaptionWithDataLibrary({
      config: legacyConfig,
      accountId: "acc-1",
      storedEntry: null,
      shootEntityFieldsJson: null,
      entityFieldsJson: null,
    });
    // "prix" est référencé (alias legacy) → le candidat n'est PAS jeté.
    expect(res.usedEntry?.entryId).toBe("e-legacy");
    expect(res.drewNewEntry).toBe(true);
    expect(res.caption).toBe("350 000 €");
  });
});
