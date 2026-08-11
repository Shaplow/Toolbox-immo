/**
 * prompts — system prompts et libellés d'assemblage, par usage.
 *
 * Auparavant ces chaînes étaient écrites en dur au point d'appel : le system prompt
 * de description existait en trois copies identiques, et les libellés
 * « Informations complémentaires : » / « Transcription : » étaient enfouis dans
 * `buildUserMessage`. Impossible d'avoir un usage aux consignes différentes sans
 * dupliquer la fonction.
 */

/**
 * Description / légende Instagram : sortie destinée à être collée telle quelle,
 * donc **aucun balisage** — c'est le comportement historique, à ne pas changer.
 */
export const SYSTEM_PROMPT_DESCRIPTION =
  "Tu es un expert en rédaction. Génère uniquement le texte demandé, sans commentaire, introduction ni balise markdown.";

/**
 * Brief de montage, variante markdown : contrairement à une légende, un brief est
 * un document de travail structuré que le monteur parcourt — les titres et les
 * listes y sont utiles.
 */
export const SYSTEM_PROMPT_BRIEF_MARKDOWN =
  "Tu es un directeur de post-production. Tu rédiges un brief de montage destiné à un monteur vidéo. " +
  "Structure ta réponse en Markdown : titres de section (##), listes à puces, et gras pour les points " +
  "critiques. Sois concret et actionnable — chaque ligne doit dire au monteur quoi faire. " +
  "Ne réponds que par le brief, sans introduction ni commentaire sur ta démarche. " +
  "N'invente aucune information absente des éléments fournis.";

/**
 * Brief de montage, variante texte brut : même contenu, mais collable dans
 * WhatsApp, un mail ou un Slack où le markdown s'afficherait en clair.
 */
export const SYSTEM_PROMPT_BRIEF_PLAIN =
  "Tu es un directeur de post-production. Tu rédiges un brief de montage destiné à un monteur vidéo. " +
  "Réponds en TEXTE BRUT uniquement : aucun balisage Markdown, pas d'astérisques, pas de dièses, " +
  "pas de tables. Structure avec des lignes vides entre les sections, des titres en majuscules et " +
  "des tirets pour les listes. Sois concret et actionnable. " +
  "Ne réponds que par le brief, sans introduction ni commentaire sur ta démarche. " +
  "N'invente aucune information absente des éléments fournis.";

/** Format de sortie demandé pour un brief. */
export type BriefFormat = "markdown" | "plain";

export function systemPromptForBrief(format: BriefFormat): string {
  return format === "plain" ? SYSTEM_PROMPT_BRIEF_PLAIN : SYSTEM_PROMPT_BRIEF_MARKDOWN;
}

/** Libellés injectés par `buildUserMessage` pour délimiter les blocs d'entrée. */
export type MessageLabels = {
  extraInfoLabel: string;
  transcriptLabel: string;
  imageInstruction: string;
  noTranscriptInstruction: string;
};

/** Libellés historiques du générateur de descriptions — inchangés. */
export const DESCRIPTION_LABELS: MessageLabels = {
  extraInfoLabel: "Informations complémentaires",
  transcriptLabel: "Transcription",
  imageInstruction:
    "Une image de référence est jointe. Utilise uniquement les informations visibles et lisibles qui peuvent enrichir la description, sans rien inventer.",
  noTranscriptInstruction:
    "Aucune transcription n'est fournie. Base-toi uniquement sur l'image de référence et les informations complémentaires ci-dessus. Si une information n'est pas visible, lisible ou certaine, ne l'invente pas.",
};

/** Libellés du générateur de briefs. */
export const BRIEF_LABELS: MessageLabels = {
  extraInfoLabel: "Informations complémentaires",
  transcriptLabel: "Transcription des rushs",
  imageInstruction:
    "Une image de référence est jointe. Utilise uniquement ce qui y est visible et lisible, sans rien inventer.",
  noTranscriptInstruction:
    "Aucune transcription n'est fournie. Base-toi uniquement sur les informations complémentaires ci-dessus, sans rien inventer.",
};
