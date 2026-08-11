/**
 * recipes — stratégies d'exécution d'un prompt (mono-passe, double passe, image…).
 *
 * Cf. `DescriptionPrompt.recipeKind`. Ce dispatcher vivait inline dans le handler
 * HTTP de `api/description/generate/route.ts` : non exporté, non testable, et
 * impossible à réutiliser pour un autre usage.
 *
 * La liste des recettes valides était en outre écrite **cinq fois** dans le repo —
 * trois côté serveur (`description/generate`, `description/prompts`,
 * `description/prompts/[id]`) et deux côté front (`DescriptionPromptsPanel`,
 * `admin/prompts/page`). Ce module est désormais la seule source.
 */

import { buildUserMessage } from "@/lib/llm/buildUserMessage";
import { callLlm, type LlmImage, type LlmModel } from "@/lib/llm/client";
import type { MessageLabels } from "@/lib/llm/prompts";

export type RecipeKind =
  | "transcript_only"
  | "transcript_and_frame"
  | "transcript_multi_frame"
  | "two_pass_reformulate"
  | "context_enriched";

export type RecipeConfig = {
  frameCount?: number;
  contextFieldKeys?: string[];
} | null;

export const VALID_RECIPE_KINDS: readonly RecipeKind[] = [
  "transcript_only",
  "transcript_and_frame",
  "transcript_multi_frame",
  "two_pass_reformulate",
  "context_enriched",
] as const;

const VALID_RECIPE_SET = new Set<string>(VALID_RECIPE_KINDS);

export function isRecipeKind(value: unknown): value is RecipeKind {
  return typeof value === "string" && VALID_RECIPE_SET.has(value);
}

/**
 * Normalise avec repli sur `transcript_only`.
 *
 * Le repli est nécessaire : des prompts créés avant l'ajout de `recipeKind`
 * (migration `20260528002000_add_description_prompt_recipes`) n'ont pas de valeur.
 */
export function normalizeRecipeKind(value: unknown): RecipeKind {
  return isRecipeKind(value) ? value : "transcript_only";
}

/** Recettes exigeant une image de référence pour pouvoir s'exécuter. */
export const RECIPES_REQUIRING_IMAGE: readonly RecipeKind[] = [
  "transcript_and_frame",
  "transcript_multi_frame",
] as const;

/**
 * Recettes utilisables pour un brief standalone.
 *
 * Les recettes à image supposent une frame de référence, et `context_enriched`
 * suppose un slot de publication — un brief standalone n'a ni l'un ni l'autre.
 */
export const BRIEF_ALLOWED_RECIPES: readonly RecipeKind[] = [
  "transcript_only",
  "two_pass_reformulate",
] as const;

/**
 * Valide la cohérence entrées / recette **avant** tout appel LLM (donc avant de
 * facturer des tokens).
 *
 * @returns Un message d'erreur prêt à afficher, ou `null` si tout est bon.
 */
export function validateRecipeInputs(opts: {
  recipeKind: RecipeKind;
  hasImage: boolean;
}): string | null {
  if (RECIPES_REQUIRING_IMAGE.includes(opts.recipeKind) && !opts.hasImage) {
    return "Cette recette requiert une image de référence — joignez-en une ou choisissez un autre prompt.";
  }
  return null;
}

export type RunRecipeInput = {
  recipeKind: RecipeKind;
  recipeConfig: RecipeConfig;
  /**
   * Prompt de base tel qu'envoyé au modèle, éventuellement déjà enrichi (bloc
   * `<field>` de `context_enriched`).
   */
  promptText: string;
  /**
   * Prompt brut, sans enrichissement. Utilisé par les deux passes de
   * `two_pass_reformulate` — comportement conservé à l'identique de l'original.
   */
  rawPromptText: string;
  transcriptText?: string | null;
  extraInfo?: string | null;
  image?: LlmImage | null;
  model: LlmModel;
  system: string;
  labels: MessageLabels;
  maxTranscriptChars?: number;
  /** Préfixe des logs de dégradation. */
  logPrefix?: string;
};

/**
 * Exécute une recette et retourne le texte produit (jamais trimé au-delà de ce que
 * fait le client).
 *
 * L'appelant reste responsable de traiter une sortie vide — c'est une condition
 * d'échec métier (filtre de contenu), pas une erreur technique.
 */
export async function runRecipe(input: RunRecipeInput): Promise<string> {
  const {
    recipeKind,
    recipeConfig,
    promptText,
    rawPromptText,
    transcriptText,
    extraInfo,
    image = null,
    model,
    system,
    labels,
    maxTranscriptChars,
    logPrefix = "[runRecipe]",
  } = input;

  const normalizedTranscript = transcriptText?.trim() ?? "";

  if (recipeKind === "two_pass_reformulate") {
    // Passe 1 — résumé en bullets, sans image : on veut du rapide et du
    // déterministe, le visuel n'apporte rien à cette étape.
    const pass1Message =
      rawPromptText +
      "\n\n[Étape 1/2] Résume cette transcription en bullets concis (max 12 points), sans rédiger la description finale. Pas d'introduction.\n\n" +
      (extraInfo?.trim() ? `${labels.extraInfoLabel} :\n${extraInfo.trim()}\n\n` : "") +
      (normalizedTranscript
        ? `${labels.transcriptLabel} :\n${normalizedTranscript.slice(0, maxTranscriptChars)}`
        : "Aucune transcription fournie — base-toi uniquement sur les informations complémentaires.");

    const summary = await callLlm(model, { system, userMessage: pass1Message, image: null });

    // Passe 2 — rédaction finale depuis le résumé, cette fois avec l'image.
    const pass2Message =
      rawPromptText +
      "\n\n[Étape 2/2] À partir du résumé ci-dessous, rédige la description finale conformément aux instructions du prompt. Ne reproduis pas le résumé tel quel — rédige du texte fluide.\n\nRésumé :\n" +
      summary;

    return callLlm(model, { system, userMessage: pass2Message, image });
  }

  // transcript_only | transcript_and_frame | transcript_multi_frame |
  // context_enriched → une seule passe.
  //
  // `transcript_multi_frame` dégrade volontairement : la config peut demander
  // frameCount > 1, mais l'extraction de N frames depuis la vidéo source
  // demanderait un pipeline FFmpeg côté serveur qui n'existe pas ici. On consomme
  // la frame fournie et on logue, plutôt que d'échouer silencieusement.
  if (recipeKind === "transcript_multi_frame" && (recipeConfig?.frameCount ?? 1) > 1) {
    console.warn(
      `${logPrefix} recipe=transcript_multi_frame frameCount=${recipeConfig?.frameCount} ` +
        "demandé mais extraction multi-frame non implémentée — dégrade en 1 frame.",
    );
  }

  const userMessage = buildUserMessage({
    promptText,
    transcriptText: normalizedTranscript,
    extraInfo,
    hasImage: !!image,
    labels,
    maxTranscriptChars,
  });

  return callLlm(model, { system, userMessage, image });
}
