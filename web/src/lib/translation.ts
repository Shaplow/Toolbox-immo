/**
 * translation.ts
 *
 * Helper de traduction batch via Claude API. Utilisé par
 * /api/transcription/[id]/translate pour produire les traductions inverses
 * des segments d'une transcription multi-langue (bilingue FR↔ZH typiquement).
 *
 * Réutilise le pattern HTTP direct de captionCorrector.ts (pas de SDK).
 */

// Cohérent avec captionCorrector.ts (correcteur IA) : on garde le même modèle
// Sonnet 4.6 pour assurer une qualité de traduction homogène avec le reste du
// pipeline Claude. Override possible via ANTHROPIC_TRANSLATION_MODEL.
const DEFAULT_MODEL = process.env.ANTHROPIC_TRANSLATION_MODEL ?? "claude-sonnet-4-6";
const BATCH_SIZE = 30;
const CLAUDE_TIMEOUT_MS = 45_000;

export interface TranslationSegmentInput {
  /** Index original dans le tableau de segments (utilisé pour le mapping retour). */
  index: number;
  /** Texte source à traduire. */
  text: string;
  /** Code ISO de la langue source de ce segment (ex: "fr", "zh"). */
  sourceLanguage: string;
  /** Code ISO de la langue cible pour ce segment (ex: "zh", "fr"). */
  targetLanguage: string;
}

export interface TranslationSegmentResult {
  index: number;
  /** Texte traduit dans la langue cible. `null` si l'appel Claude n'a pas
   *  pu produire de traduction (segment vide, erreur de parsing, etc.). */
  translation: string | null;
}

const LANGUAGE_NAMES: Record<string, string> = {
  fr: "français",
  en: "anglais",
  zh: "chinois (mandarin simplifié)",
  es: "espagnol",
  de: "allemand",
  it: "italien",
  pt: "portugais",
  ru: "russe",
  ja: "japonais",
  ko: "coréen",
  ar: "arabe",
};

function languageLabel(code: string): string {
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}

function buildSystemPrompt(): string {
  return `Tu es un traducteur professionnel spécialisé dans le sous-titrage vidéo.

RÈGLES STRICTES :
- Tu reçois un tableau JSON de segments, chacun avec un champ "index", un "text" source, une "source_language" et une "target_language".
- Pour chaque segment, traduis le "text" depuis la langue source vers la langue cible.
- Garde la traduction concise et naturelle, adaptée à un sous-titre (1-2 lignes max, lecture rapide).
- Préserve la ponctuation et la casse appropriée à la langue cible.
- Si le texte source est manifestement une hallucination phonétique (charabia phonétique sans sens dans la langue source), retourne une chaîne vide "" pour la traduction — n'invente pas de contenu.
- Retourne UNIQUEMENT le tableau JSON au format [{"index": <int>, "translation": "<texte traduit>"}], sans texte, commentaire ou balise markdown avant ou après.
- Conserve exactement les mêmes "index" que ceux reçus en entrée.`;
}

function parseClaudeResponse(text: string): Array<{ index: number; translation: string }> {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("Réponse Claude invalide : JSON introuvable");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("Réponse Claude invalide : JSON malformé");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Réponse Claude invalide : tableau attendu");
  }
  const out: Array<{ index: number; translation: string }> = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const obj = item as { index?: unknown; translation?: unknown };
    if (typeof obj.index !== "number" || !Number.isFinite(obj.index)) continue;
    const translation = typeof obj.translation === "string" ? obj.translation : "";
    out.push({ index: obj.index, translation });
  }
  return out;
}

async function translateBatch(
  batch: TranslationSegmentInput[],
  model: string,
  signal?: AbortSignal,
): Promise<Map<number, string>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY non configuré");

  const userPayload = batch.map((seg) => ({
    index: seg.index,
    text: seg.text,
    source_language: languageLabel(seg.sourceLanguage),
    target_language: languageLabel(seg.targetLanguage),
  }));

  // Toujours imposer un timeout côté serveur : sans cap, un Claude qui ne
  // répond jamais bloquerait l'API route jusqu'au cold-cut Vercel (504 muet).
  // Si le caller a son propre signal, on combine via AbortSignal.any.
  const timeoutSignal = AbortSignal.timeout(CLAUDE_TIMEOUT_MS);
  const effectiveSignal: AbortSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: buildSystemPrompt(),
      messages: [
        {
          role: "user",
          content: `Voici les segments à traduire :\n\n${JSON.stringify(userPayload, null, 2)}\n\nRetourne uniquement le tableau JSON des traductions.`,
        },
      ],
    }),
    signal: effectiveSignal,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as { content: Array<{ type: string; text: string }> };
  const text = data.content.find((c) => c.type === "text")?.text ?? "";
  const parsed = parseClaudeResponse(text);

  const byIndex = new Map<number, string>();
  for (const item of parsed) {
    byIndex.set(item.index, item.translation);
  }
  return byIndex;
}

export interface TranslateSegmentsOptions {
  model?: string;
  batchSize?: number;
  signal?: AbortSignal;
}

/**
 * Traduit un lot de segments par batches successifs vers Claude.
 *
 * Retourne un tableau parallèle à `segments` (même longueur, même ordre).
 * Pour chaque segment, `translation` est `null` si l'API n'a pas répondu
 * pour cet index (segment ignoré, parsing partiel, etc.).
 *
 * En cas d'erreur API sur un batch, l'erreur remonte au caller. L'ensemble
 * des batches précédents reste traduit (à charge du caller d'écraser
 * partiellement ou de retry).
 */
export async function translateSegments(
  segments: TranslationSegmentInput[],
  options: TranslateSegmentsOptions = {},
): Promise<TranslationSegmentResult[]> {
  const model = options.model ?? DEFAULT_MODEL;
  const batchSize = Math.max(1, Math.min(options.batchSize ?? BATCH_SIZE, BATCH_SIZE));
  const signal = options.signal;

  if (segments.length === 0) return [];

  const allTranslations = new Map<number, string>();

  for (let i = 0; i < segments.length; i += batchSize) {
    const batch = segments.slice(i, i + batchSize);
    const batchResults = await translateBatch(batch, model, signal);
    for (const [index, translation] of batchResults.entries()) {
      allTranslations.set(index, translation);
    }
  }

  return segments.map((seg) => ({
    index: seg.index,
    translation: allTranslations.has(seg.index) ? allTranslations.get(seg.index)! : null,
  }));
}

/**
 * Calcule la langue cible pour chaque segment en mode bilingue strict (2 langues).
 * Retourne `null` si plus ou moins de 2 langues : la route appelante doit alors
 * refuser la traduction (ambiguïté sur la cible).
 */
export function computeBilingualTargetLanguageMap(jobLanguages: string[]): Record<string, string> | null {
  const uniques = Array.from(new Set(jobLanguages.map((l) => l.toLowerCase())));
  if (uniques.length !== 2) return null;
  const [a, b] = uniques;
  return { [a]: b, [b]: a };
}
