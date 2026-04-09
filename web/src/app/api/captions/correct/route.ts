/**
 * POST /api/captions/correct
 *
 * Corrige automatiquement des sous-titres via IA (Claude ou GPT).
 *
 * Body JSON :
 *   {
 *     captions: Array<{ index: number; start: string; end: string; text: string }>,
 *     prompt: string,   // instructions de correction
 *     model: "claude" | "gpt"   // fournisseur IA
 *   }
 *
 * Réponse :
 *   { captions: Caption[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

type Caption = { index: number; start: string; end: string; text: string };

type RequestBody = {
  captions: Caption[];
  prompt: string;
  model: "claude" | "gpt";
};

function buildSystemPrompt(userPrompt: string): string {
  return `Tu es un assistant spécialisé dans la correction de sous-titres vidéo.
${userPrompt}

RÈGLES STRICTES — à respecter absolument :
- Conserve EXACTEMENT la même structure JSON (tableau d'objets avec index, start, end, text).
- Ne modifie JAMAIS les horodatages (start, end) ni les numéros d'index.
- Retourne UNIQUEMENT le tableau JSON corrigé, sans texte, commentaire ou balise markdown avant ou après.
- Préserve les sauts de ligne à l'intérieur des champs text.
- Ne fusionne pas et ne découpe pas les sous-titres.
- CONSERVE IMPÉRATIVEMENT les balises de surlignage de la forme {HL:N}mot{/HL:N} exactement telles quelles, sans les modifier, déplacer ou supprimer. Ces balises sont des marqueurs techniques invisibles à l'écran.`;
}

async function correctWithClaude(captions: Caption[], prompt: string): Promise<Caption[]> {
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
      max_tokens: 8192,
      system: buildSystemPrompt(prompt),
      messages: [
        {
          role: "user",
          content: `Voici les sous-titres à corriger (JSON) :\n\n${JSON.stringify(captions, null, 2)}\n\nRetourne uniquement le JSON corrigé.`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API ${res.status}: ${errText}`);
  }

  const data = await res.json() as {
    content: Array<{ type: string; text: string }>;
  };
  const text = data.content.find((c) => c.type === "text")?.text ?? "";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("Réponse Claude invalide : JSON introuvable");
  return JSON.parse(jsonMatch[0]) as Caption[];
}

async function correctWithGPT(captions: Caption[], prompt: string): Promise<Caption[]> {
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
        { role: "system", content: buildSystemPrompt(prompt) },
        {
          role: "user",
          content: `Voici les sous-titres à corriger (JSON) :\n\n${JSON.stringify(captions, null, 2)}\n\nRetourne uniquement le JSON corrigé.`,
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${errText}`);
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
  };
  const text = data.choices[0]?.message?.content ?? "";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("Réponse GPT invalide : JSON introuvable");
  return JSON.parse(jsonMatch[0]) as Caption[];
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const { captions, prompt, model } = body;

  if (!captions || !Array.isArray(captions) || captions.length === 0) {
    return NextResponse.json({ error: "Aucune caption fournie" }, { status: 400 });
  }
  if (!prompt || typeof prompt !== "string") {
    return NextResponse.json({ error: "Prompt manquant" }, { status: 400 });
  }
  if (model !== "claude" && model !== "gpt") {
    return NextResponse.json({ error: "Modèle invalide (claude | gpt)" }, { status: 400 });
  }

  try {
    const corrected =
      model === "claude"
        ? await correctWithClaude(captions, prompt)
        : await correctWithGPT(captions, prompt);

    return NextResponse.json({ captions: corrected });
  } catch (err) {
    console.error("[captions/correct]", err);
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 502 }
    );
  }
}
