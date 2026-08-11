/**
 * client — appels aux fournisseurs LLM (Anthropic / OpenAI).
 *
 * Extrait de `api/description/generate/route.ts`, où les deux appels vivaient
 * inline avec le **même system prompt écrit en dur trois fois** (deux fois dans la
 * route, une fois dans `triggerAutoDescriptionFromTranscription.ts`). Toute
 * évolution devait être répliquée à la main, avec dérive garantie.
 *
 * Le system prompt devient donc un paramètre : c'est ce qui permet au générateur de
 * briefs d'imposer ses propres consignes de format sans dupliquer la plomberie.
 *
 * Portée volontairement limitée à ces trois call-sites. `lib/captionCorrector.ts`
 * et `lib/translation.ts` appellent aussi ces API directement et pourraient migrer
 * ici — dette identifiée, hors périmètre de ce chantier.
 */

/** Fournisseur sélectionnable côté UI. */
export type LlmModel = "claude" | "gpt";

/** Image jointe à la requête, déjà validée et décodée. */
export type LlmImage = {
  /** `data:<mime>;base64,<...>` — forme attendue par OpenAI. */
  dataUrl: string;
  /** Base64 nu — forme attendue par Anthropic. */
  base64: string;
  mimeType: string;
};

export type LlmCallOptions = {
  /** Consignes de cadrage. Paramétrable : c'est ce qui distingue un brief d'une légende. */
  system: string;
  userMessage: string;
  image?: LlmImage | null;
  maxTokens?: number;
  /** Uniquement honoré par OpenAI ; Anthropic garde sa température par défaut. */
  temperature?: number;
  timeoutMs?: number;
};

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_GPT_TEMPERATURE = 0.5;

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.4";

/** Modèles réellement joignables selon les clés d'API présentes. */
export function llmAvailability(): { hasClaude: boolean; hasGPT: boolean } {
  return {
    hasClaude: !!process.env.ANTHROPIC_API_KEY,
    hasGPT: !!process.env.OPENAI_API_KEY,
  };
}

export async function callClaude(opts: LlmCallOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY non configuré");

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  > = [];

  // L'image d'abord : Anthropic recommande de placer le visuel avant la consigne
  // textuelle qui s'y réfère.
  if (opts.image) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: opts.image.mimeType,
        data: opts.image.base64,
      },
    });
  }
  content.push({ type: "text", text: opts.userMessage });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: opts.system,
      messages: [{ role: "user", content }],
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as { content: Array<{ type: string; text: string }> };
  return data.content.find((c) => c.type === "text")?.text?.trim() ?? "";
}

export async function callGPT(opts: LlmCallOptions): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY non configuré");

  const userContent:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string; detail: "high" } }
      > = opts.image
    ? [
        { type: "text", text: opts.userMessage },
        { type: "image_url", image_url: { url: opts.image.dataUrl, detail: "high" } },
      ]
    : opts.userMessage;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: userContent },
      ],
      temperature: opts.temperature ?? DEFAULT_GPT_TEMPERATURE,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content?.trim() ?? "";
}

/** Dispatcher : évite un `model === "claude" ? … : …` à chaque call-site. */
export async function callLlm(model: LlmModel, opts: LlmCallOptions): Promise<string> {
  return model === "claude" ? callClaude(opts) : callGPT(opts);
}
