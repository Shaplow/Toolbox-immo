/**
 * transcriptText — lecteur unique du texte d'une transcription terminée.
 *
 * ## Le bug que ce module corrige
 *
 * Le worker écrit `segments.json` sur R2 comme **tableau nu** :
 * `render-engine/runpod_worker.py:1385` fait `_json.dumps(segments)` où `segments`
 * est une `list[dict]`. Le fichier vaut donc `[{start, end, text, …}, …]`.
 *
 * Or deux consommateurs le parsaient comme un objet enveloppé — `parsed.segments ?? []` :
 *   - `api/description/generate/route.ts` (loadSlotTranscriptionText)
 *   - `lib/triggerAutoDescriptionFromTranscription.ts` (readTranscriptionTextFromR2)
 *
 * Résultat en production : dès que `segmentsJson` inline est absent — c'est-à-dire
 * le cas normal, l'inline n'étant peuplé qu'en dev local — le texte lu était
 * **vide**. La génération automatique de description tombait alors sur son
 * fallback « extraire une frame vidéo » et rédigeait depuis une image au lieu du
 * transcript, sans que rien ne signale le problème.
 *
 * Deux autres lecteurs faisaient déjà le bon parsing (`Array.isArray`) :
 * `triggerAutoTranslationFromTranscription.ts` et
 * `api/transcription/[id]/download/route.ts`. Ce module unifie les quatre et
 * accepte **les deux formes**, pour rester compatible quoi qu'écrive le worker.
 */

import { getFromR2, r2Configured } from "@/lib/r2";
import { prisma } from "@/lib/prisma";
import type { Segment } from "@/lib/transcriptionProcess";

/**
 * Plafond de caractères envoyés à un LLM. Aligné sur ce que la route description
 * appliquait déjà (`MAX_TRANSCRIPT_CHARS`).
 */
export const MAX_TRANSCRIPT_CHARS = 50_000;

/** Forme minimale d'un job de transcription suffisante pour en lire le texte. */
export type TranscriptSource = {
  status: string;
  segmentsJson: string | null;
  outputJsonKey: string | null;
};

/**
 * Parse un JSON de segments, quelle que soit sa forme.
 *
 * Accepte le tableau nu (ce que produit le worker) **et** la forme enveloppée
 * `{ segments: [...] }`. Retourne un tableau vide plutôt que de lever : un JSON
 * illisible ne doit pas faire échouer une génération, juste produire un texte vide
 * détectable par l'appelant.
 */
export function parseTranscriptSegments(raw: string): Segment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (Array.isArray(parsed)) {
    return parsed as Segment[];
  }
  if (parsed && typeof parsed === "object") {
    const wrapped = (parsed as { segments?: unknown }).segments;
    if (Array.isArray(wrapped)) return wrapped as Segment[];
  }
  return [];
}

/**
 * Reconstitue le texte lisible d'une liste de segments (une ligne par segment).
 */
export function segmentsToText(segments: Segment[], maxChars = MAX_TRANSCRIPT_CHARS): string {
  return segments
    .map((s) => (s.text ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, maxChars);
}

/**
 * Lit le texte d'un job de transcription.
 *
 * Ordre : `segmentsJson` inline (dev local, ou fallback) puis R2 via
 * `outputJsonKey` (le cas de production).
 *
 * @returns Le texte, ou `null` si le job n'est pas terminé / rien de lisible.
 */
export async function readTranscriptText(
  job: TranscriptSource | null | undefined,
  maxChars = MAX_TRANSCRIPT_CHARS,
): Promise<string | null> {
  if (!job || job.status !== "COMPLETED") return null;

  if (job.segmentsJson) {
    const text = segmentsToText(parseTranscriptSegments(job.segmentsJson), maxChars);
    if (text) return text;
    // Inline présent mais vide/illisible : on tente R2 plutôt que d'abandonner.
  }

  if (job.outputJsonKey && r2Configured()) {
    try {
      const buf = await getFromR2(job.outputJsonKey);
      if (!buf) return null;
      const text = segmentsToText(parseTranscriptSegments(buf.toString("utf-8")), maxChars);
      return text || null;
    } catch (err) {
      console.warn(
        `[transcriptText] lecture R2 échouée key=${job.outputJsonKey}:`,
        err,
      );
      return null;
    }
  }

  return null;
}

/**
 * Lit le texte de la transcription rattachée à un slot de publication.
 *
 * Résolution : la transcription du render, sinon celle de la version courante —
 * même ordre que ce que faisait `loadSlotTranscriptionText`.
 *
 * Note : ce helper ne filtre pas sur `staleSince`. Pour une réutilisation qui doit
 * exclure les transcriptions périmées, résoudre le job en amont avec
 * `resolveReusableTranscription` (`lib/publications/jobLifecycle.ts`) puis appeler
 * `readTranscriptText` dessus.
 */
export async function getSlotTranscriptText(
  slotId: string,
  maxChars = MAX_TRANSCRIPT_CHARS,
): Promise<string | null> {
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      render: {
        select: {
          transcriptionJob: {
            select: { status: true, segmentsJson: true, outputJsonKey: true },
          },
        },
      },
      currentVersion: {
        select: {
          transcriptionJob: {
            select: { status: true, segmentsJson: true, outputJsonKey: true },
          },
        },
      },
    },
  });
  if (!slot) return null;

  const job = slot.render?.transcriptionJob ?? slot.currentVersion?.transcriptionJob ?? null;
  return readTranscriptText(job, maxChars);
}
