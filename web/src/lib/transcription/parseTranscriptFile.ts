/**
 * parseTranscriptFile — extraction de texte depuis un fichier de transcription
 * déposé par l'utilisateur (`.srt` ou `.json`).
 *
 * Parsing **côté client** : le fichier n'est jamais uploadé, seul le texte extrait
 * part dans la requête. C'est le comportement historique de l'outil descriptions,
 * conservé — et partagé désormais avec l'outil briefs.
 *
 * Ne pas confondre avec `lib/transcription/transcriptText.ts`, qui lit côté serveur
 * le `segments.json` produit par le worker.
 */

import { parseSRT } from "@/lib/srt";
import { parseTranscriptSegments } from "@/lib/transcription/transcriptText";

/** Extensions acceptées par les dropzones de transcription. */
export const TRANSCRIPT_FILE_ACCEPT = ".srt,.json";

/**
 * Texte d'un fichier SRT, débarrassé des marqueurs de highlight `{HL:n}`.
 *
 * Ces marqueurs sont une extension maison du format (cf. `lib/srt.ts`) : les
 * laisser passerait des `{HL:2}` au LLM, qui les traiterait comme du contenu.
 */
export function extractTextFromSRT(raw: string): string {
  return parseSRT(raw)
    .map((c) => c.text.replace(/\{HL:\d+\}|\{\/HL:\d+\}/g, ""))
    .join(" ");
}

/**
 * Texte d'un JSON de segments.
 *
 * Accepte le tableau nu comme la forme `{ segments: [...] }` — même tolérance que
 * le lecteur serveur, pour qu'un `segments.json` téléchargé depuis l'app et
 * redéposé ici donne le même résultat.
 */
export function extractTextFromJSON(raw: string): string {
  return parseTranscriptSegments(raw)
    .map((s) => s.text?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}

/**
 * Aiguille sur le bon parseur selon l'extension du fichier.
 *
 * @returns Le texte extrait, ou `null` si l'extension n'est pas supportée.
 */
export function extractTranscriptText(filename: string, raw: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "srt") return extractTextFromSRT(raw);
  if (ext === "json") return extractTextFromJSON(raw);
  return null;
}
