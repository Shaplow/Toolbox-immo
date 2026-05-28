/**
 * POST /api/description/generate
 *
 * Génère une description textuelle à partir d'une transcription (SRT/JSON)
 * et/ou d'une image de référence en utilisant Claude ou GPT, avec un prompt personnalisé.
 *
 * Body JSON :
 *   {
 *     transcriptText?: string,      // texte extrait du SRT/JSON (max 50 000 chars)
 *     promptId: string,             // ID du DescriptionPrompt
 *     personalization?: string,     // texte libre ajouté au prompt
 *     model: "claude" | "gpt",
 *     inputFilename?: string,       // nom du fichier source (pour l'historique)
 *     transcriptionId?: string,     // si source = TranscriptionJob existant
 *     referenceImage?: {            // image facultative, peut suffire sans transcription
 *       dataUrl: string,
 *       filename?: string,
 *     }
 *   }
 *
 * Réponse :
 *   { jobId: string; result: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { hasTool } from "@/lib/permissions";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { logActivity } from "@/lib/services/slot/activity";

const MAX_TRANSCRIPT_CHARS = 50_000;
const MAX_PERSONALIZATION_CHARS = 2_000;
const MAX_REFERENCE_IMAGE_BYTES = 4 * 1024 * 1024;
const REFERENCE_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const OPENAI_MODEL  = process.env.OPENAI_MODEL  ?? "gpt-5.4";

type ReferenceImageInput = {
  dataUrl?: string;
  filename?: string;
};

type ValidatedReferenceImage = {
  dataUrl: string;
  base64: string;
  mimeType: string;
};

// ─── Recipes ─────────────────────────────────────────────────────────────────
// Cf. DescriptionPrompt.recipeKind (Phase P6). Avant ce dispatcher, toutes les
// recipes dégradaient silencieusement en "transcript_only".

type RecipeKind =
  | "transcript_only"
  | "transcript_and_frame"
  | "transcript_multi_frame"
  | "two_pass_reformulate"
  | "context_enriched";

type RecipeConfig = {
  frameCount?: number;
  contextFieldKeys?: string[];
} | null;

const VALID_RECIPE_KINDS = new Set<RecipeKind>([
  "transcript_only",
  "transcript_and_frame",
  "transcript_multi_frame",
  "two_pass_reformulate",
  "context_enriched",
]);

function normalizeRecipeKind(value: unknown): RecipeKind {
  return typeof value === "string" && VALID_RECIPE_KINDS.has(value as RecipeKind)
    ? (value as RecipeKind)
    : "transcript_only";
}

function buildUserMessage(
  promptText: string,
  transcriptText: string | undefined,
  personalization?: string,
  hasReferenceImage = false
): string {
  const normalizedTranscriptText = transcriptText?.trim() ?? "";
  let msg = promptText + "\n\n";
  if (personalization?.trim()) {
    msg += `Informations complémentaires :\n${personalization.trim()}\n\n`;
  }
  if (hasReferenceImage) {
    msg +=
      "Une image de référence est jointe. Utilise uniquement les informations visibles et lisibles qui peuvent enrichir la description, sans rien inventer.\n\n";
  }

  if (normalizedTranscriptText) {
    msg += `Transcription :\n${normalizedTranscriptText.slice(0, MAX_TRANSCRIPT_CHARS)}`;
    return msg;
  }

  msg +=
    "Aucune transcription n'est fournie. Base-toi uniquement sur l'image de référence et les informations complémentaires ci-dessus. Si une information n'est pas visible, lisible ou certaine, ne l'invente pas.";
  return msg;
}

function validateReferenceImage(
  referenceImage?: ReferenceImageInput
): ValidatedReferenceImage | null {
  if (!referenceImage) {
    return null;
  }

  if (typeof referenceImage.dataUrl !== "string" || !referenceImage.dataUrl.trim()) {
    throw new Error("Image de référence invalide");
  }

  const match = referenceImage.dataUrl
    .trim()
    .match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);

  if (!match) {
    throw new Error("Formats d'image acceptés : PNG, JPG ou WEBP");
  }

  const [, mimeType, base64] = match;
  if (!REFERENCE_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error("Formats d'image acceptés : PNG, JPG ou WEBP");
  }

  const byteSize = Buffer.from(base64, "base64").byteLength;
  if (!byteSize) {
    throw new Error("Image de référence vide");
  }
  if (byteSize > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error("Image de référence trop volumineuse (4 Mo max)");
  }

  return {
    dataUrl: `data:${mimeType};base64,${base64}`,
    base64,
    mimeType,
  };
}

async function generateWithClaude(
  userMessage: string,
  referenceImage: ValidatedReferenceImage | null
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY non configuré");

  const content: Array<
    | { type: "text"; text: string }
    | {
        type: "image";
        source: {
          type: "base64";
          media_type: string;
          data: string;
        };
      }
  > = [];

  if (referenceImage) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: referenceImage.mimeType,
        data: referenceImage.base64,
      },
    });
  }
  content.push({ type: "text", text: userMessage });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system:
        "Tu es un expert en rédaction. Génère uniquement le texte demandé, sans commentaire, introduction ni balise markdown.",
      messages: [{ role: "user", content }],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API ${res.status}: ${errText}`);
  }

  const data = await res.json() as {
    content: Array<{ type: string; text: string }>;
  };
  return data.content.find((c) => c.type === "text")?.text?.trim() ?? "";
}

async function generateWithGPT(
  userMessage: string,
  referenceImage: ValidatedReferenceImage | null
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY non configuré");

  const userContent: string | Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "high" } }
  > = referenceImage
    ? [
        { type: "text", text: userMessage },
        {
          type: "image_url",
          image_url: {
            url: referenceImage.dataUrl,
            detail: "high",
          },
        },
      ]
    : userMessage;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "Tu es un expert en rédaction. Génère uniquement le texte demandé, sans commentaire, introduction ni balise markdown.",
        },
        { role: "user", content: userContent },
      ],
      temperature: 0.5,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${errText}`);
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content?.trim() ?? "";
}

export async function POST(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const effectiveUserId = userContext.effectiveUser.id;

  const hasAccess = userContext.canAdminBypass || await hasTool(effectiveUserId, "description");
  if (!hasAccess) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  let body: {
    transcriptText?: string;
    promptId?: string;
    personalization?: string;
    model?: string;
    inputFilename?: string;
    transcriptionId?: string;
    slotId?: string;
    referenceImage?: ReferenceImageInput;
  };

  try {
    body = await req.json() as {
      transcriptText?: string;
      promptId?: string;
      personalization?: string;
      model?: string;
      inputFilename?: string;
      transcriptionId?: string;
      slotId?: string;
      referenceImage?: ReferenceImageInput;
    };
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const {
    transcriptText,
    promptId,
    personalization,
    model,
    inputFilename,
    transcriptionId,
    slotId,
    referenceImage: referenceImageInput,
  } = body;

  if (!promptId) {
    return NextResponse.json({ error: "Prompt requis" }, { status: 400 });
  }
  if (model !== "claude" && model !== "gpt") {
    return NextResponse.json({ error: "Modèle invalide" }, { status: 400 });
  }

  // Guard isActive : un prompt désactivé par l'admin ne doit plus pouvoir
  // être utilisé (cas du promptId qui traîne dans une URL bookmark, dans
  // pattern.descriptionPromptId, ou dans slot.descriptionPromptIdOverride).
  const prompt = await prisma.descriptionPrompt.findUnique({
    where: { id: promptId, isActive: true },
  });
  if (!prompt) {
    return NextResponse.json({ error: "Prompt introuvable ou désactivé" }, { status: 404 });
  }

  // Validate transcriptionId ownership: the referenced job must belong to the current user.
  if (transcriptionId) {
    const txJob = await prisma.transcriptionJob.findUnique({
      where: { id: transcriptionId },
      select: { userId: true },
    });
    if (!txJob || txJob.userId !== effectiveUserId) {
      return NextResponse.json({ error: "Transcription introuvable" }, { status: 404 });
    }
  }

  // Validate slotId access (404 anti-énumération si non accessible).
  let resolvedSlotId: string | null = null;
  if (slotId) {
    const slot = await prisma.publicationSlot.findUnique({
      where: { id: slotId },
      select: { id: true, assigneeMonteurId: true, assigneeCmId: true },
    });
    const role = toUserRole(userContext.effectiveUser.role);
    if (!slot || !canUserAccessSlot(slot, role, effectiveUserId)) {
      return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
    }
    resolvedSlotId = slot.id;
  }

  let referenceImage: ValidatedReferenceImage | null;
  try {
    referenceImage = validateReferenceImage(referenceImageInput);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Image de référence invalide" },
      { status: 400 }
    );
  }

  const normalizedTranscriptText = transcriptText?.trim() ?? "";
  if (!normalizedTranscriptText && !referenceImage) {
    return NextResponse.json(
      { error: "Ajoute une transcription ou une image de référence" },
      { status: 400 }
    );
  }

  if (personalization && personalization.length > MAX_PERSONALIZATION_CHARS) {
    return NextResponse.json(
      { error: `Texte personnalisé trop long (${personalization.length} / ${MAX_PERSONALIZATION_CHARS} caractères max)` },
      { status: 400 }
    );
  }
  const clampedPersonalization = personalization;

  // ── Dispatcher recipes ────────────────────────────────────────────────────
  // Lecture des champs P6 (peut être absent sur des prompts antérieurs à la
  // migration, d'où le normalize avec fallback transcript_only).
  const recipeKind = normalizeRecipeKind(
    (prompt as { recipeKind?: string }).recipeKind,
  );
  const recipeConfig = ((prompt as { recipeConfig?: unknown }).recipeConfig ??
    null) as RecipeConfig;

  // Validations spécifiques par recipe (avant tout appel LLM).
  if (
    (recipeKind === "transcript_and_frame" ||
      recipeKind === "transcript_multi_frame") &&
    !referenceImage
  ) {
    return NextResponse.json(
      {
        error:
          "Cette recette requiert une image de référence — joignez-en une ou choisissez un autre prompt.",
      },
      { status: 400 },
    );
  }

  // Pour context_enriched : charger les champs métier du slot (adresse,
  // prix, etc.). Sans slotId, on dégrade en transcript_only avec un warn.
  let slotContext: { title: string | null; fields: Record<string, string> } | null = null;
  if (recipeKind === "context_enriched") {
    if (!resolvedSlotId) {
      console.warn(
        "[description/generate] recipe=context_enriched sans slotId — dégrade en transcript_only",
      );
    } else {
      const slotFull = await prisma.publicationSlot.findUnique({
        where: { id: resolvedSlotId },
        select: { title: true, fields: true },
      });
      if (slotFull) {
        let parsed: Record<string, string> = {};
        try {
          const raw = JSON.parse(slotFull.fields ?? "{}") as unknown;
          if (raw && typeof raw === "object") {
            parsed = Object.fromEntries(
              Object.entries(raw as Record<string, unknown>)
                .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
                .map(([k, v]) => [k, String(v)]),
            );
          }
        } catch {
          // JSON malformé — on ignore et continue avec un contexte vide.
        }
        // Filtre par contextFieldKeys si configuré (sinon tous les champs).
        const keys = Array.isArray(recipeConfig?.contextFieldKeys)
          ? recipeConfig.contextFieldKeys
          : null;
        if (keys && keys.length > 0) {
          parsed = Object.fromEntries(
            Object.entries(parsed).filter(([k]) => keys.includes(k)),
          );
        }
        slotContext = { title: slotFull.title, fields: parsed };
      }
    }
  }

  // Build le prompt de base. Pour context_enriched : on injecte les champs
  // slot directement dans le promptText (rien de plus à faire dans le user
  // message — le LLM reçoit tout dans un seul payload cohérent).
  let basePromptText = prompt.prompt;
  if (recipeKind === "context_enriched" && slotContext) {
    const contextLines: string[] = [];
    if (slotContext.title) contextLines.push(`Titre : ${slotContext.title}`);
    for (const [k, v] of Object.entries(slotContext.fields)) {
      contextLines.push(`${k} : ${v}`);
    }
    if (contextLines.length > 0) {
      basePromptText =
        prompt.prompt +
        "\n\nContexte de la publication (ne pas inventer d'autres informations) :\n" +
        contextLines.join("\n");
    }
  }

  const userMessage = buildUserMessage(
    basePromptText,
    normalizedTranscriptText,
    clampedPersonalization,
    !!referenceImage,
  );
  const normalizedInputFilename = inputFilename?.trim()
    || (!normalizedTranscriptText ? referenceImageInput?.filename?.trim() : undefined)
    || null;

  let result: string;
  let errorMsg: string | undefined;

  try {
    if (recipeKind === "two_pass_reformulate") {
      // Pass 1 : résumé en bullets, sans rédaction finale. Limite max_tokens
      // implicite via le contrat LLM (~4k tokens). Pas d'image en pass 1
      // pour rester rapide et déterministe.
      const pass1Message =
        prompt.prompt +
        "\n\n[Étape 1/2] Résume cette transcription en bullets concis (max 12 points), sans rédiger la description finale. Pas d'introduction.\n\n" +
        (clampedPersonalization?.trim()
          ? `Informations complémentaires :\n${clampedPersonalization.trim()}\n\n`
          : "") +
        (normalizedTranscriptText
          ? `Transcription :\n${normalizedTranscriptText.slice(0, MAX_TRANSCRIPT_CHARS)}`
          : "Aucune transcription fournie — base-toi uniquement sur les informations complémentaires.");

      const summary = model === "claude"
        ? await generateWithClaude(pass1Message, null)
        : await generateWithGPT(pass1Message, null);

      // Pass 2 : rédaction finale à partir du résumé.
      const pass2Message =
        prompt.prompt +
        "\n\n[Étape 2/2] À partir du résumé ci-dessous, rédige la description finale conformément aux instructions du prompt. Ne reproduis pas le résumé tel quel — rédige du texte fluide.\n\nRésumé :\n" +
        summary;

      result = model === "claude"
        ? await generateWithClaude(pass2Message, referenceImage)
        : await generateWithGPT(pass2Message, referenceImage);
    } else {
      // transcript_only | transcript_and_frame | transcript_multi_frame |
      // context_enriched (single-pass) : un seul appel avec userMessage
      // construit ci-dessus.
      //
      // Note pour transcript_multi_frame : la config peut spécifier
      // frameCount > 1, mais l'extraction de N frames depuis la vidéo
      // source nécessite un pipeline FFmpeg côté serveur qui n'est pas
      // implémenté ici — on consomme la frame fournie comme une seule
      // image et on logue un warn pour signaler la dégradation.
      if (
        recipeKind === "transcript_multi_frame" &&
        (recipeConfig?.frameCount ?? 1) > 1
      ) {
        console.warn(
          `[description/generate] recipe=transcript_multi_frame frameCount=${recipeConfig?.frameCount} ` +
            "demandé mais extraction multi-frame non implémentée — dégrade en 1 frame.",
        );
      }
      result = model === "claude"
        ? await generateWithClaude(userMessage, referenceImage)
        : await generateWithGPT(userMessage, referenceImage);
    }
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : "Erreur inconnue";
    errorMsg = rawMsg.slice(0, 200);
    console.error("[description/generate] Provider failure", {
      userId: effectiveUserId,
      promptId,
      model,
      transcriptionId: transcriptionId ?? null,
      hasReferenceImage: !!referenceImage,
      error: errorMsg,
    });

    const failedJob = await prisma.descriptionJob.create({
      data: {
        userId: effectiveUserId,
        status: "FAILED",
        inputType: transcriptionId ? "transcription" : "upload",
        inputFilename: normalizedInputFilename,
        transcriptionId: transcriptionId ?? null,
        slotId: resolvedSlotId,
        promptId,
        promptSnapshot: prompt.prompt,
        personalization: personalization ?? null,
        model,
        errorMsg,
      },
    });

    return NextResponse.json({ error: errorMsg, jobId: failedJob.id }, { status: 500 });
  }

  const job = await prisma.descriptionJob.create({
    data: {
      userId: effectiveUserId,
      status: "COMPLETED",
      inputType: transcriptionId ? "transcription" : "upload",
      inputFilename: normalizedInputFilename,
      transcriptionId: transcriptionId ?? null,
      slotId: resolvedSlotId,
      promptId,
      promptSnapshot: prompt.prompt,
      personalization: personalization ?? null,
      model,
      result,
    },
  });

  if (resolvedSlotId) {
    await logActivity(prisma, {
      slotId: resolvedSlotId,
      actorId: userContext.actualUser.id,
      type: "DESCRIPTION_COMPLETED",
      payload: { descriptionJobId: job.id, model, promptId },
    });
  }

  return NextResponse.json({ jobId: job.id, result });
}
