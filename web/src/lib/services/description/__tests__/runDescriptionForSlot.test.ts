/**
 * Tests runDescriptionForSlot — chargeur de contexte context_enriched +
 * dispatcher de recette, extraits de app/api/description/generate/route.ts
 * (Vague 3 phase 3) pour être partagés avec l'auto-trigger.
 *
 * Invariants couverts :
 *  1. Précédence de merge : fiche tournage < fiche data < overrides slot.
 *  2. Filtre string non-vide (les valeurs vides/non-string sont écartées).
 *  3. Filtre par contextFieldKeys quand configuré.
 *  4. Cap de longueur par champ (500 chars) + balisage <field>.
 *  5. context_enriched sans slotId → dégrade en promptText inchangé (warn).
 *  6. context_enriched avec slotId → enrichit le promptText avant runRecipe.
 *
 * Prisma et runRecipe sont mockés — tests vitest unit purs, pas de DB ni
 * d'appel LLM réel.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSlotFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicationSlot: {
      findUnique: (...args: unknown[]) => mockSlotFindUnique(...args),
    },
  },
}));

const mockRunRecipe = vi.fn().mockResolvedValue("résultat généré");

vi.mock("@/lib/llm/recipes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/recipes")>();
  return {
    ...actual,
    runRecipe: (...args: unknown[]) => mockRunRecipe(...args),
  };
});

import {
  runDescriptionForSlot,
  loadSlotDescriptionContext,
  buildContextEnrichedPrompt,
} from "../runDescriptionForSlot";

const baseRunInput = {
  model: "claude" as const,
  system: "system prompt",
  labels: {
    extraInfoLabel: "Infos",
    transcriptLabel: "Transcription",
    imageInstruction: "image",
    noTranscriptInstruction: "no transcript",
  },
};

beforeEach(() => {
  mockSlotFindUnique.mockReset();
  mockRunRecipe.mockReset().mockResolvedValue("résultat généré");
});

describe("loadSlotDescriptionContext", () => {
  it("merge avec la précédence fiche tournage < fiche data < overrides slot", async () => {
    mockSlotFindUnique.mockResolvedValue({
      title: "Titre du slot",
      fields: JSON.stringify({ adresse: "Override slot" }),
      entity: { fields: JSON.stringify({ adresse: "Fiche data", prix: "300 000 €" }) },
      shootEntity: { fields: JSON.stringify({ adresse: "Fiche tournage", date_tournage: "12/06" }) },
    });

    const ctx = await loadSlotDescriptionContext("slot-1", null);

    expect(ctx).toEqual({
      title: "Titre du slot",
      fields: {
        adresse: "Override slot", // slot.fields gagne sur entity ET shootEntity
        prix: "300 000 €", // entity gagne (pas dans shootEntity)
        date_tournage: "12/06", // uniquement dans shootEntity
      },
    });
  });

  it("écarte les valeurs vides/espaces et non-string du merge", async () => {
    mockSlotFindUnique.mockResolvedValue({
      title: null,
      fields: JSON.stringify({ vide: "   ", nombre: 42 }),
      entity: { fields: JSON.stringify({ present: "ok" }) },
      shootEntity: null,
    });

    const ctx = await loadSlotDescriptionContext("slot-1", null);
    expect(ctx?.fields).toEqual({ present: "ok" });
  });

  it("filtre par contextFieldKeys quand fourni", async () => {
    mockSlotFindUnique.mockResolvedValue({
      title: "T",
      fields: "{}",
      entity: { fields: JSON.stringify({ adresse: "A", prix: "B", surface: "C" }) },
      shootEntity: null,
    });

    const ctx = await loadSlotDescriptionContext("slot-1", ["adresse", "prix"]);
    expect(ctx?.fields).toEqual({ adresse: "A", prix: "B" });
  });

  it("contextFieldKeys vide ([]) ne filtre rien (comportement 'tous les champs')", async () => {
    mockSlotFindUnique.mockResolvedValue({
      title: "T",
      fields: "{}",
      entity: { fields: JSON.stringify({ adresse: "A" }) },
      shootEntity: null,
    });

    const ctx = await loadSlotDescriptionContext("slot-1", []);
    expect(ctx?.fields).toEqual({ adresse: "A" });
  });

  it("retourne null si le slot est introuvable", async () => {
    mockSlotFindUnique.mockResolvedValue(null);
    expect(await loadSlotDescriptionContext("slot-inexistant", null)).toBeNull();
  });
});

describe("buildContextEnrichedPrompt", () => {
  it("balise chaque champ + le titre, et cap à 500 chars", () => {
    const longValue = "x".repeat(600);
    const prompt = buildContextEnrichedPrompt("Prompt de base", {
      title: "Mon titre",
      fields: { adresse: longValue },
    });

    expect(prompt).toContain("Prompt de base");
    expect(prompt).toContain('<field name="titre">Mon titre</field>');
    expect(prompt).toContain(`<field name="adresse">${"x".repeat(500)}</field>`);
    expect(prompt).not.toContain("x".repeat(501));
  });

  it("sans titre ni champ → retourne le promptText inchangé", () => {
    expect(buildContextEnrichedPrompt("Prompt de base", { title: null, fields: {} })).toBe(
      "Prompt de base",
    );
  });

  it("échappe les caractères <>\" dans les noms de clé", () => {
    const prompt = buildContextEnrichedPrompt("P", {
      title: null,
      fields: { 'a<b>c"d': "v" },
    });
    expect(prompt).toContain('<field name="abcd">v</field>');
  });
});

describe("runDescriptionForSlot", () => {
  it("context_enriched sans slotId dégrade en promptText inchangé", async () => {
    await runDescriptionForSlot({
      ...baseRunInput,
      promptText: "Prompt nu",
      recipeKind: "context_enriched",
      recipeConfig: null,
      slotId: null,
      transcriptText: "un transcript",
    });

    expect(mockSlotFindUnique).not.toHaveBeenCalled();
    expect(mockRunRecipe).toHaveBeenCalledTimes(1);
    const call = mockRunRecipe.mock.calls[0][0];
    expect(call.promptText).toBe("Prompt nu");
    expect(call.rawPromptText).toBe("Prompt nu");
    expect(call.recipeKind).toBe("context_enriched");
  });

  it("context_enriched avec slotId enrichit le promptText avant runRecipe", async () => {
    mockSlotFindUnique.mockResolvedValue({
      title: "Bel appartement",
      fields: "{}",
      entity: { fields: JSON.stringify({ adresse: "10 rue X" }) },
      shootEntity: null,
    });

    await runDescriptionForSlot({
      ...baseRunInput,
      promptText: "Prompt nu",
      recipeKind: "context_enriched",
      recipeConfig: { contextFieldKeys: ["adresse"] },
      slotId: "slot-42",
      transcriptText: null,
    });

    expect(mockSlotFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "slot-42" } }),
    );
    const call = mockRunRecipe.mock.calls[0][0];
    expect(call.promptText).toContain("Prompt nu");
    expect(call.promptText).toContain('<field name="titre">Bel appartement</field>');
    expect(call.promptText).toContain('<field name="adresse">10 rue X</field>');
    expect(call.rawPromptText).toBe("Prompt nu"); // le prompt nu reste non-enrichi
  });

  it("recipeKind inconnu/absent normalise vers transcript_only", async () => {
    await runDescriptionForSlot({
      ...baseRunInput,
      promptText: "P",
      recipeKind: undefined,
      recipeConfig: undefined,
      slotId: null,
      transcriptText: "t",
    });
    expect(mockRunRecipe.mock.calls[0][0].recipeKind).toBe("transcript_only");
  });

  it("retourne le résultat de runRecipe tel quel", async () => {
    const result = await runDescriptionForSlot({
      ...baseRunInput,
      promptText: "P",
      recipeKind: "transcript_only",
      recipeConfig: null,
      slotId: null,
      transcriptText: "t",
    });
    expect(result).toBe("résultat généré");
  });
});
