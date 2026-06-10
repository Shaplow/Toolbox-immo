/**
 * triggerAutoTranslationFromTranscription.ts
 *
 * Appelé après qu'un TranscriptionJob multi-langue passe COMPLETED — depuis
 * le webhook RunPod et les paths local. Pour chaque segment, lit la langue
 * détectée par Whisper et appelle Claude pour produire la traduction inverse
 * dans la langue opposée (pair FR↔ZH, etc.).
 *
 * Skip silencieux si le job est en mode mono (`languages` vide) — le mono
 * n'a pas de chaîne auto de traduction par design (UX 2026-06-10).
 *
 * En cas d'échec → log + ne casse pas la chaîne (le user pourra retry via le
 * bouton manuel `/translate` du CaptionsGenerateForm).
 */

import "server-only";

import { prisma } from "@/lib/prisma";
import { getFromR2, r2Configured, uploadToR2 } from "@/lib/r2";
import {
  computeBilingualTargetLanguageMap,
  translateSegments,
  type TranslationSegmentInput,
} from "@/lib/translation";

type SegmentJSON = {
  start: number;
  end: number;
  text: string;
  speaker?: string;
  words?: Array<{ word: string; start: number; end: number; score?: number }>;
  avg_confidence?: number;
  language?: string;
  translation?: string;
};

async function loadSegments(job: {
  outputJsonKey: string | null;
  segmentsJson: string | null;
}): Promise<SegmentJSON[] | null> {
  if (job.outputJsonKey && r2Configured()) {
    try {
      const buf = await getFromR2(job.outputJsonKey);
      const parsed = JSON.parse(buf.toString("utf-8"));
      return Array.isArray(parsed) ? parsed : null;
    } catch (err) {
      console.error("[autoTranslation] R2 load failed:", err);
      return null;
    }
  }
  if (job.segmentsJson) {
    try {
      const parsed = JSON.parse(job.segmentsJson);
      return Array.isArray(parsed) ? parsed : null;
    } catch (err) {
      console.error("[autoTranslation] inline parse failed:", err);
      return null;
    }
  }
  return null;
}

async function persistSegments(
  job: { id: string; outputJsonKey: string | null; segmentsJson: string | null },
  segments: SegmentJSON[],
): Promise<void> {
  const json = JSON.stringify(segments, null, 2);
  if (job.outputJsonKey && r2Configured()) {
    await uploadToR2(job.outputJsonKey, Buffer.from(json, "utf-8"), "application/json");
    return;
  }
  if (job.segmentsJson != null) {
    await prisma.transcriptionJob.update({
      where: { id: job.id },
      data: { segmentsJson: json },
    });
  }
}

export async function triggerAutoTranslationForTranscription(
  transcriptionJobId: string,
): Promise<void> {
  const job = await prisma.transcriptionJob.findUnique({
    where: { id: transcriptionJobId },
    select: {
      id: true,
      status: true,
      languages: true,
      outputJsonKey: true,
      segmentsJson: true,
    },
  });

  if (!job) {
    console.warn(`[autoTranslation] job=${transcriptionJobId} introuvable`);
    return;
  }
  if (job.status !== "COMPLETED") {
    console.info(`[autoTranslation] job=${job.id} status=${job.status} — skip`);
    return;
  }

  // Gate : uniquement le mode multi-langue déclenche la chaîne auto.
  const isMultilingual = Array.isArray(job.languages) && job.languages.length >= 2;
  if (!isMultilingual) {
    return;
  }

  const targetByLanguage = computeBilingualTargetLanguageMap(job.languages);
  if (!targetByLanguage) {
    console.warn(`[autoTranslation] job=${job.id} multi avec ≠2 langues — skip`);
    return;
  }

  const segments = await loadSegments(job);
  if (!segments || segments.length === 0) {
    console.warn(`[autoTranslation] job=${job.id} segments vides ou illisibles — skip`);
    return;
  }

  // Idempotence : skip si tous les segments éligibles ont déjà une traduction.
  const eligible = segments.filter((s) => typeof s.text === "string" && s.text.trim().length > 0);
  const alreadyTranslated = segments.filter(
    (s) => typeof s.translation === "string" && s.translation.trim().length > 0
  );
  if (eligible.length > 0 && alreadyTranslated.length >= eligible.length) {
    console.info(`[autoTranslation] job=${job.id} déjà traduit — skip`);
    return;
  }

  const inputs: TranslationSegmentInput[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const text = (seg.text ?? "").trim();
    const sourceLanguage = (seg.language ?? "").toLowerCase();
    if (!text || !sourceLanguage) continue;
    const targetLanguage = targetByLanguage[sourceLanguage];
    if (!targetLanguage) continue;
    inputs.push({ index: i, text, sourceLanguage, targetLanguage });
  }

  if (inputs.length === 0) {
    console.info(`[autoTranslation] job=${job.id} aucun segment éligible — skip`);
    return;
  }

  let translations: Awaited<ReturnType<typeof translateSegments>>;
  try {
    translations = await translateSegments(inputs);
  } catch (err) {
    console.error(`[autoTranslation] Claude API failed for job=${job.id}:`, err);
    return;
  }

  let appliedCount = 0;
  for (const { index, translation } of translations) {
    if (typeof translation === "string") {
      segments[index] = { ...segments[index], translation };
      if (translation.trim().length > 0) appliedCount += 1;
    }
  }

  try {
    await persistSegments(job, segments);
    console.info(
      `[autoTranslation] job=${job.id} terminé — ${appliedCount}/${segments.length} segments traduits`
    );
  } catch (err) {
    console.error(`[autoTranslation] persistance failed for job=${job.id}:`, err);
  }
}
