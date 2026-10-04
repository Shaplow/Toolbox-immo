/**
 * segments — chargement des segments d'une transcription terminée, pour les
 * téléchargements (SRT / JSON, à l'unité ou en ZIP de lot).
 *
 * Sources, dans l'ordre :
 * 1. `outputJsonKey` en `local/…` : fichier sous `public/` (mode dev sans R2) ;
 * 2. `outputJsonKey` R2 : le cas de production ;
 * 3. `segmentsJson` inline : repli quand aucun fichier n'est référencé.
 *
 * Accepte le tableau nu écrit par le worker et la forme enveloppée
 * `{ segments }`. Contrairement à `parseTranscriptSegments` (volontairement
 * tolérant pour la génération de texte), un JSON illisible LÈVE : un
 * téléchargement ne doit pas livrer un SRT vide sans le signaler.
 */

import path from "path";
import { readFile } from "fs/promises";
import { getFromR2 } from "@/lib/r2";
import type { Segment } from "@/lib/transcriptionProcess";

export type SegmentSource = {
  outputJsonKey: string | null;
  segmentsJson?: string | null;
};

export function hasSegmentSource(job: SegmentSource): boolean {
  return Boolean(job.outputJsonKey || job.segmentsJson);
}

export function parseSegmentsStrict(raw: string): Segment[] {
  const parsed: unknown = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed as Segment[];
  if (parsed && typeof parsed === "object") {
    const wrapped = (parsed as { segments?: unknown }).segments;
    if (Array.isArray(wrapped)) return wrapped as Segment[];
  }
  throw new Error("Format de segments inattendu");
}

async function readOutputJson(outputJsonKey: string): Promise<string> {
  if (outputJsonKey.startsWith("local/")) {
    const localPath = path.join(process.cwd(), "public", outputJsonKey.replace(/^local\//, ""));
    return (await readFile(localPath)).toString("utf-8");
  }
  return (await getFromR2(outputJsonKey)).toString("utf-8");
}

/** Lève si aucune source n'est lisible : l'appelant décide du message. */
export async function loadTranscriptionSegments(job: SegmentSource): Promise<Segment[]> {
  if (job.outputJsonKey) {
    try {
      return parseSegmentsStrict(await readOutputJson(job.outputJsonKey));
    } catch (err) {
      if (!job.segmentsJson) throw err;
      // Fichier illisible mais copie inline disponible (mode local) : on s'en sert.
    }
  }
  if (job.segmentsJson) return parseSegmentsStrict(job.segmentsJson);
  throw new Error("Aucun fichier de segments pour ce job");
}
