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
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasTool } from "@/lib/permissions";

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
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const hasAccess = await hasTool(session.user.id, "description");
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
    referenceImage: referenceImageInput,
  } = body;

  if (!promptId) {
    return NextResponse.json({ error: "Prompt requis" }, { status: 400 });
  }
  if (model !== "claude" && model !== "gpt") {
    return NextResponse.json({ error: "Modèle invalide" }, { status: 400 });
  }

  const prompt = await prisma.descriptionPrompt.findUnique({ where: { id: promptId } });
  if (!prompt) {
    return NextResponse.json({ error: "Prompt introuvable" }, { status: 404 });
  }

  // Validate transcriptionId ownership: the referenced job must belong to the current user.
  if (transcriptionId) {
    const txJob = await prisma.transcriptionJob.findUnique({
      where: { id: transcriptionId },
      select: { userId: true },
    });
    if (!txJob || txJob.userId !== session.user.id) {
      return NextResponse.json({ error: "Transcription introuvable" }, { status: 404 });
    }
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

  const clampedPersonalization = personalization?.slice(0, MAX_PERSONALIZATION_CHARS);
  const userMessage = buildUserMessage(
    prompt.prompt,
    normalizedTranscriptText,
    clampedPersonalization,
    !!referenceImage
  );
  const normalizedInputFilename = inputFilename?.trim()
    || (!normalizedTranscriptText ? referenceImageInput?.filename?.trim() : undefined)
    || null;

  let result: string;
  let errorMsg: string | undefined;

  try {
    result = model === "claude"
      ? await generateWithClaude(userMessage, referenceImage)
      : await generateWithGPT(userMessage, referenceImage);
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : "Erreur inconnue";
    errorMsg = rawMsg.slice(0, 200);
    console.error("[description/generate] Provider failure", {
      userId: session.user.id,
      promptId,
      model,
      transcriptionId: transcriptionId ?? null,
      hasReferenceImage: !!referenceImage,
      error: errorMsg,
    });

    const failedJob = await prisma.descriptionJob.create({
      data: {
        userId: session.user.id,
        status: "FAILED",
        inputType: transcriptionId ? "transcription" : "upload",
        inputFilename: normalizedInputFilename,
        transcriptionId: transcriptionId ?? null,
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
      userId: session.user.id,
      status: "COMPLETED",
      inputType: transcriptionId ? "transcription" : "upload",
      inputFilename: normalizedInputFilename,
      transcriptionId: transcriptionId ?? null,
      promptId,
      promptSnapshot: prompt.prompt,
      personalization: personalization ?? null,
      model,
      result,
    },
  });

  return NextResponse.json({ jobId: job.id, result });
}
