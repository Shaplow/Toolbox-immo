/**
 * captionCorrector.ts
 *
 * Logique partagée de correction IA des sous-titres (Claude / GPT).
 * Peut être appelé depuis une route Next.js ou depuis le pipeline automatique.
 */

import { parseHighlightedCaptions, type Caption } from "@/lib/srt";
import {
  type AutoHighlightMode,
  type CaptionPromptAutoHighlight,
} from "@/lib/captionPrompt";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CorrectionModel = "claude" | "gpt";

// ─── Helpers ─────────────────────────────────────────────────────────────────

export const AUTO_HIGHLIGHT_GROUPS: Record<AutoHighlightMode, number[]> = {
  highlight1: [0],
  highlight2: [1],
  both: [0, 1],
};

export function isCaption(value: unknown): value is Caption {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Caption>;
  return (
    typeof candidate.index === "number" &&
    typeof candidate.start === "string" &&
    typeof candidate.end === "string" &&
    typeof candidate.text === "string"
  );
}

/**
 * Convert seconds (float) to an SRT timestamp string "HH:MM:SS,mmm".
 * Negative values are clamped to 0 (Whisper occasionally outputs small negative offsets).
 */
export function secondsToSrtTimestamp(s: number): string {
  const clamped = Math.max(0, s);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const sec = Math.floor(clamped % 60);
  // Clamp ms to 999 to avoid a 4-digit value when the fractional part rounds up to 1.0
  const ms = Math.min(999, Math.round((clamped % 1) * 1000));
  return (
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(sec).padStart(2, "0") +
    "," +
    String(ms).padStart(3, "0")
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

export async function correctWithClaude(
  captions: Caption[],
  promptText: string,
  autoHighlight: CaptionPromptAutoHighlight,
  signal?: AbortSignal,
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
    signal,
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
  try {
    return JSON.parse(jsonMatch[0]) as Caption[];
  } catch {
    throw new Error("Réponse Claude invalide : JSON malformé");
  }
}

export async function correctWithGPT(
  captions: Caption[],
  promptText: string,
  autoHighlight: CaptionPromptAutoHighlight,
  signal?: AbortSignal,
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
    signal,
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
  try {
    return JSON.parse(jsonMatch[0]) as Caption[];
  } catch {
    throw new Error("Réponse GPT invalide : JSON malformé");
  }
}

/**
 * Parse an SRT timestamp to seconds. Accepts both comma and dot as the ms separator.
 * Returns NaN for unparseable strings.
 */
function srtToSeconds(ts: string): number {
  const m = ts.match(/(\d+):(\d+):(\d+)[,.]+(\d+)/);
  if (!m) return NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

export function validateCorrectedCaptions(
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
    // Use numeric comparison (1ms tolerance) to accept minor timestamp reformatting by the LLM
    // (e.g. comma vs dot separator, missing leading zeros).
    const startDiff = srtToSeconds(item.start) - srtToSeconds(expected.start);
    const endDiff   = srtToSeconds(item.end)   - srtToSeconds(expected.end);
    if (
      item.index !== expected.index ||
      !isFinite(startDiff) || Math.abs(startDiff) > 0.001 ||
      !isFinite(endDiff)   || Math.abs(endDiff) > 0.001
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
