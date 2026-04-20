/**
 * POST /api/captions/correct
 *
 * Corrige automatiquement des sous-titres via IA à partir d'un prompt stocké en base.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { hasTool, TOOLS } from "@/lib/permissions";
import { parseHighlightedCaptions, type Caption } from "@/lib/srt";
import {
  normalizeCaptionAutoHighlight,
  type AutoHighlightMode,
  type CaptionPromptAutoHighlight,
} from "@/lib/captionPrompt";
import {
  CaptionPromptStorageUnavailableError,
  findCaptionPromptForCorrection,
  getCaptionPromptStorageMessage,
} from "@/lib/captionPromptStore";

type RequestBody = {
  captions: Caption[];
  promptId: string;
  model: "claude" | "gpt";
};

const AUTO_HIGHLIGHT_GROUPS: Record<AutoHighlightMode, number[]> = {
  highlight1: [0],
  highlight2: [1],
  both: [0, 1],
};

function isCaption(value: unknown): value is Caption {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<Caption>;
  return (
    typeof candidate.index === "number" &&
    typeof candidate.start === "string" &&
    typeof candidate.end === "string" &&
    typeof candidate.text === "string"
  );
}

function buildAutoHighlightPrompt(config: CaptionPromptAutoHighlight): string {
  if (!config.enabled) return "";

  const prompt =
    config.prompt ||
    "Ajoute des highlights uniquement quand cela améliore la lisibilité, en restant parcimonieux.";
  const modeRules =
    config.mode === "highlight1"
      ? "- Utilise uniquement les balises {HL:0}mot{/HL:0}."
      : config.mode === "highlight2"
        ? "- Utilise uniquement les balises {HL:1}mot{/HL:1}."
        : "- Utilise {HL:0}mot{/HL:0} pour le highlight principal et {HL:1}mot{/HL:1} pour un accent secondaire.";

  return `OPTION AUTO-HIGHLIGHT\n${prompt}\n\nRÈGLES AUTO-HIGHLIGHT :\n${modeRules}\n- Entoure un seul mot/token à la fois avec une paire complète de balises.\n- Si plusieurs mots consécutifs doivent être surlignés, répète les balises sur chaque mot.\n- N'utilise jamais d'autres balises que les balises HL autorisées.\n- Si aucun highlight n'est pertinent, n'en ajoute pas.`;
}

function buildSystemPrompt(
  promptText: string,
  autoHighlight: CaptionPromptAutoHighlight,
): string {
  const promptSections: string[] = [];
  const autoHighlightPrompt = buildAutoHighlightPrompt(autoHighlight);

  if (autoHighlightPrompt && autoHighlight.placement === "before") {
    promptSections.push(autoHighlightPrompt);
  }

  promptSections.push(promptText.trim());

  if (autoHighlightPrompt && autoHighlight.placement === "after") {
    promptSections.push(autoHighlightPrompt);
  }

  return `Tu es un assistant spécialisé dans la correction de sous-titres vidéo.
${promptSections.filter(Boolean).join("\n\n")}

RÈGLES STRICTES — à respecter absolument :
- Conserve EXACTEMENT la même structure JSON (tableau d'objets avec index, start, end, text).
- Ne modifie JAMAIS les horodatages (start, end) ni les numéros d'index.
- Retourne UNIQUEMENT le tableau JSON corrigé, sans texte, commentaire ou balise markdown avant ou après.
- Préserve les sauts de ligne à l'intérieur des champs text.
- Ne fusionne pas et ne découpe pas les sous-titres.
- CONSERVE IMPÉRATIVEMENT les balises de surlignage existantes de la forme {HL:N}mot{/HL:N}, sauf si l'option auto-highlight demande explicitement d'en ajouter de nouvelles. Ces balises sont des marqueurs techniques invisibles à l'écran.
- Les balises HL doivent toujours entourer un mot/token complet, jamais un fragment de mot ni plusieurs mots à la fois.`;
}

async function correctWithClaude(
  captions: Caption[],
  promptText: string,
  autoHighlight: CaptionPromptAutoHighlight,
): Promise<Caption[]> {
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
      system: buildSystemPrompt(promptText, autoHighlight),
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

async function correctWithGPT(
  captions: Caption[],
  promptText: string,
  autoHighlight: CaptionPromptAutoHighlight,
): Promise<Caption[]> {
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
        { role: "system", content: buildSystemPrompt(promptText, autoHighlight) },
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

function validateCorrectedCaptions(
  source: Caption[],
  corrected: Caption[],
  allowedHighlightGroups: Set<number>,
): { captions: Caption[]; highlighted: Array<[string, number]> } {
  if (!Array.isArray(corrected) || corrected.length !== source.length) {
    throw new Error("Réponse IA invalide : nombre de sous-titres incohérent");
  }

  const normalized = corrected.map((item, index) => {
    if (!isCaption(item)) {
      throw new Error(`Réponse IA invalide : caption ${index + 1} mal formée`);
    }

    const expected = source[index];
    if (
      item.index !== expected.index ||
      item.start !== expected.start ||
      item.end !== expected.end
    ) {
      throw new Error(`Réponse IA invalide : la caption ${expected.index} a modifié sa structure`);
    }

    return {
      index: item.index,
      start: item.start,
      end: item.end,
      text: item.text,
    };
  });

  const parsed = parseHighlightedCaptions(normalized);
  const hasDanglingMarkers = parsed.captions.some(
    (caption) => caption.text.includes("{HL:") || caption.text.includes("{/HL:"),
  );
  if (hasDanglingMarkers) {
    throw new Error("Réponse IA invalide : balises de highlight mal formées");
  }

  for (const group of parsed.highlighted.values()) {
    if (!allowedHighlightGroups.has(group)) {
      throw new Error(`Réponse IA invalide : groupe de highlight ${group} non autorisé`);
    }
  }

  return {
    captions: parsed.captions,
    highlighted: Array.from(parsed.highlighted.entries()),
  };
}

export async function POST(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  if (
    !userContext.canAdminBypass &&
    !(await hasTool(userContext.effectiveUser.id, TOOLS.CAPTIONS))
  ) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const { captions, promptId, model } = body;

  if (!captions || !Array.isArray(captions) || captions.length === 0) {
    return NextResponse.json({ error: "Aucune caption fournie" }, { status: 400 });
  }
  if (captions.some((caption) => !isCaption(caption))) {
    return NextResponse.json({ error: "Format de captions invalide" }, { status: 400 });
  }
  if (!promptId || typeof promptId !== "string") {
    return NextResponse.json({ error: "Prompt manquant" }, { status: 400 });
  }
  if (model !== "claude" && model !== "gpt") {
    return NextResponse.json({ error: "Modèle invalide (claude | gpt)" }, { status: 400 });
  }

  let storedPrompt;
  try {
    storedPrompt = await findCaptionPromptForCorrection(promptId);
  } catch (error) {
    if (error instanceof CaptionPromptStorageUnavailableError) {
      return NextResponse.json(
        { error: getCaptionPromptStorageMessage(error) },
        { status: 503 }
      );
    }
    throw error;
  }
  if (!storedPrompt) {
    return NextResponse.json({ error: "Prompt introuvable" }, { status: 404 });
  }

  const autoHighlight = normalizeCaptionAutoHighlight({
    enabled: storedPrompt.autoHighlightEnabled,
    mode: storedPrompt.autoHighlightMode,
    placement: storedPrompt.autoHighlightPlacement,
    prompt: storedPrompt.autoHighlightPrompt ?? "",
  });

  try {
    const sourceCaptions = captions.map((caption) => ({
      index: caption.index,
      start: caption.start,
      end: caption.end,
      text: caption.text,
    }));
    const existingHighlights = new Set<number>(
      Array.from(parseHighlightedCaptions(sourceCaptions).highlighted.values()),
    );
    const allowedHighlightGroups = new Set(existingHighlights);
    if (autoHighlight.enabled) {
      for (const group of AUTO_HIGHLIGHT_GROUPS[autoHighlight.mode]) {
        allowedHighlightGroups.add(group);
      }
    }

    const corrected =
      model === "claude"
        ? await correctWithClaude(sourceCaptions, storedPrompt.prompt, autoHighlight)
        : await correctWithGPT(sourceCaptions, storedPrompt.prompt, autoHighlight);

    return NextResponse.json(
      validateCorrectedCaptions(sourceCaptions, corrected, allowedHighlightGroups),
    );
  } catch (err) {
    console.error("[captions/correct]", err);
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 502 }
    );
  }
}
