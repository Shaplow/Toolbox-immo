/**
 * Tests sur l'assemblage du message LLM et la normalisation des recettes.
 *
 * Enjeu : l'ordre et les libellés des blocs sont ce que les prompts déjà réglés en
 * base attendent. Les changer modifierait silencieusement la sortie de tous les
 * prompts existants — ces tests figent le contrat.
 */

import { describe, it, expect } from "vitest";
import { buildUserMessage } from "@/lib/llm/buildUserMessage";
import { DESCRIPTION_LABELS, BRIEF_LABELS, systemPromptForBrief } from "@/lib/llm/prompts";
import {
  normalizeRecipeKind,
  isRecipeKind,
  validateRecipeInputs,
  VALID_RECIPE_KINDS,
  BRIEF_ALLOWED_RECIPES,
} from "@/lib/llm/recipes";

describe("buildUserMessage", () => {
  it("respecte l'ordre historique prompt → infos → image → transcription", () => {
    const msg = buildUserMessage({
      promptText: "INSTRUCTIONS",
      extraInfo: "INFOS",
      transcriptText: "TRANSCRIPT",
      hasImage: true,
      labels: DESCRIPTION_LABELS,
    });

    const iPrompt = msg.indexOf("INSTRUCTIONS");
    const iInfos = msg.indexOf("INFOS");
    const iImage = msg.indexOf(DESCRIPTION_LABELS.imageInstruction);
    const iTranscript = msg.indexOf("TRANSCRIPT");

    expect(iPrompt).toBeLessThan(iInfos);
    expect(iInfos).toBeLessThan(iImage);
    expect(iImage).toBeLessThan(iTranscript);
  });

  it("omet le bloc infos complémentaires quand il est vide ou blanc", () => {
    const withoutInfo = buildUserMessage({
      promptText: "P",
      transcriptText: "T",
      labels: DESCRIPTION_LABELS,
    });
    expect(withoutInfo).not.toContain(DESCRIPTION_LABELS.extraInfoLabel);

    const blankInfo = buildUserMessage({
      promptText: "P",
      extraInfo: "   ",
      transcriptText: "T",
      labels: DESCRIPTION_LABELS,
    });
    expect(blankInfo).not.toContain(DESCRIPTION_LABELS.extraInfoLabel);
  });

  it("omet la consigne image quand aucune image n'est jointe", () => {
    const msg = buildUserMessage({
      promptText: "P",
      transcriptText: "T",
      labels: DESCRIPTION_LABELS,
    });
    expect(msg).not.toContain(DESCRIPTION_LABELS.imageInstruction);
  });

  it("remplace le bloc transcription par une consigne anti-invention si elle manque", () => {
    const msg = buildUserMessage({
      promptText: "P",
      transcriptText: "",
      hasImage: true,
      labels: DESCRIPTION_LABELS,
    });
    expect(msg).toContain(DESCRIPTION_LABELS.noTranscriptInstruction);
    expect(msg).not.toContain(`${DESCRIPTION_LABELS.transcriptLabel} :`);
  });

  it("tronque la transcription au plafond demandé", () => {
    const msg = buildUserMessage({
      promptText: "P",
      transcriptText: "x".repeat(500),
      labels: DESCRIPTION_LABELS,
      maxTranscriptChars: 100,
    });
    // 100 x + le préfixe de libellé, pas 500.
    expect(msg).toContain("x".repeat(100));
    expect(msg).not.toContain("x".repeat(101));
  });

  it("utilise les libellés injectés — c'est ce qui permet de servir brief et description", () => {
    const msg = buildUserMessage({
      promptText: "P",
      transcriptText: "T",
      labels: BRIEF_LABELS,
    });
    expect(msg).toContain("Transcription des rushs :");
    expect(msg).not.toContain("Transcription :\n");
  });
});

describe("systemPromptForBrief", () => {
  it("autorise le markdown en mode markdown", () => {
    expect(systemPromptForBrief("markdown")).toContain("Markdown");
  });

  it("interdit explicitement tout balisage en mode texte brut", () => {
    const plain = systemPromptForBrief("plain");
    expect(plain).toContain("TEXTE BRUT");
    expect(plain).toMatch(/astérisques/);
  });

  it("interdit d'inventer dans les deux modes", () => {
    expect(systemPromptForBrief("markdown")).toMatch(/N'invente/);
    expect(systemPromptForBrief("plain")).toMatch(/N'invente/);
  });
});

describe("normalizeRecipeKind", () => {
  it("laisse passer les recettes valides", () => {
    for (const kind of VALID_RECIPE_KINDS) {
      expect(normalizeRecipeKind(kind)).toBe(kind);
    }
  });

  it("replie sur transcript_only les valeurs inconnues ou absentes", () => {
    // Les prompts créés avant la migration recipeKind n'ont pas de valeur.
    expect(normalizeRecipeKind(undefined)).toBe("transcript_only");
    expect(normalizeRecipeKind(null)).toBe("transcript_only");
    expect(normalizeRecipeKind("")).toBe("transcript_only");
    expect(normalizeRecipeKind("recette_imaginaire")).toBe("transcript_only");
    expect(normalizeRecipeKind(42)).toBe("transcript_only");
  });

  it("isRecipeKind discrimine correctement", () => {
    expect(isRecipeKind("two_pass_reformulate")).toBe(true);
    expect(isRecipeKind("nope")).toBe(false);
  });
});

describe("validateRecipeInputs", () => {
  it("refuse les recettes à image quand aucune image n'est fournie", () => {
    expect(validateRecipeInputs({ recipeKind: "transcript_and_frame", hasImage: false }))
      .toMatch(/image de référence/);
    expect(validateRecipeInputs({ recipeKind: "transcript_multi_frame", hasImage: false }))
      .toMatch(/image de référence/);
  });

  it("accepte ces mêmes recettes avec une image", () => {
    expect(validateRecipeInputs({ recipeKind: "transcript_and_frame", hasImage: true })).toBeNull();
  });

  it("n'exige pas d'image pour les recettes textuelles", () => {
    expect(validateRecipeInputs({ recipeKind: "transcript_only", hasImage: false })).toBeNull();
    expect(validateRecipeInputs({ recipeKind: "two_pass_reformulate", hasImage: false })).toBeNull();
    expect(validateRecipeInputs({ recipeKind: "context_enriched", hasImage: false })).toBeNull();
  });
});

describe("BRIEF_ALLOWED_RECIPES", () => {
  it("exclut les recettes qui exigent un slot ou une frame", () => {
    // Un brief standalone n'a ni image de référence ni slot de publication : ces
    // recettes échoueraient en 400 ou dégraderaient silencieusement.
    expect(BRIEF_ALLOWED_RECIPES).not.toContain("transcript_and_frame");
    expect(BRIEF_ALLOWED_RECIPES).not.toContain("transcript_multi_frame");
    expect(BRIEF_ALLOWED_RECIPES).not.toContain("context_enriched");
  });

  it("garde les recettes purement textuelles", () => {
    expect(BRIEF_ALLOWED_RECIPES).toContain("transcript_only");
    expect(BRIEF_ALLOWED_RECIPES).toContain("two_pass_reformulate");
  });
});
