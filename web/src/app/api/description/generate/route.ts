/**
 * POST /api/description/generate
 *
 * Génère une description textuelle à partir d'une transcription (SRT/JSON)
 * en utilisant Claude ou GPT, avec un prompt personnalisé.
 *
 * Body JSON :
 *   {
 *     transcriptText: string,       // texte extrait du SRT/JSON (max 50 000 chars)
 *     promptId: string,             // ID du DescriptionPrompt
 *     personalization?: string,     // texte libre ajouté au prompt
 *     model: "claude" | "gpt",
 *     inputFilename?: string,       // nom du fichier source (pour l'historique)
 *     transcriptionId?: string,     // si source = TranscriptionJob existant
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

function buildUserMessage(
  promptText: string,
  transcriptText: string,
  personalization?: string
): string {
  let msg = promptText + "\n\n";
  if (personalization?.trim()) {
    msg += `Informations complémentaires :\n${personalization.trim()}\n\n`;
  }
  msg += `Transcription :\n${transcriptText.slice(0, MAX_TRANSCRIPT_CHARS)}`;
  return msg;
}

async function generateWithClaude(userMessage: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY non configuré");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system:
        "Tu es un expert en rédaction. Génère uniquement le texte demandé, sans commentaire, introduction ni balise markdown.",
      messages: [{ role: "user", content: userMessage }],
    }),
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

async function generateWithGPT(userMessage: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY non configuré");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5.4",
      messages: [
        {
          role: "system",
          content:
            "Tu es un expert en rédaction. Génère uniquement le texte demandé, sans commentaire, introduction ni balise markdown.",
        },
        { role: "user", content: userMessage },
      ],
      temperature: 0.5,
    }),
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

  const body = await req.json() as {
    transcriptText?: string;
    promptId?: string;
    personalization?: string;
    model?: string;
    inputFilename?: string;
    transcriptionId?: string;
  };

  const { transcriptText, promptId, personalization, model, inputFilename, transcriptionId } = body;

  if (!transcriptText?.trim()) {
    return NextResponse.json({ error: "Texte de transcription requis" }, { status: 400 });
  }
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

  const userMessage = buildUserMessage(prompt.prompt, transcriptText, personalization);

  let result: string;
  let errorMsg: string | undefined;

  try {
    result = model === "claude"
      ? await generateWithClaude(userMessage)
      : await generateWithGPT(userMessage);
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : "Erreur inconnue";

    const failedJob = await prisma.descriptionJob.create({
      data: {
        userId: session.user.id,
        status: "FAILED",
        inputType: transcriptionId ? "transcription" : "upload",
        inputFilename: inputFilename ?? null,
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
      inputFilename: inputFilename ?? null,
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
