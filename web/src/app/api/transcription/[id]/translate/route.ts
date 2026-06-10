/**
 * POST /api/transcription/[id]/translate
 *
 * Mode bilingue (chemin séparé du mono).
 *
 * Lit les segments du TranscriptionJob (mode multi-langue, languages.length === 2),
 * traduit chaque segment vers la langue opposée via Claude API, persiste le
 * champ `translation` sur chaque segment dans le JSON segments (R2 et/ou inline),
 * puis retourne le JSON enrichi.
 *
 * Pré-requis :
 *   - job.languages contient exactement 2 codes ISO (FR↔ZH par exemple).
 *   - chaque segment du JSON contient un champ `language` (alimenté par
 *     transcribe_multilingual_with_word_timestamps).
 *
 * Réponse 200 :
 *   { segmentCount, translated, segments }
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { getFromR2, uploadToR2, r2Configured } from "@/lib/r2";
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;

  const job = await prisma.transcriptionJob.findUnique({ where: { id } });
  if (!job) {
    return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  }
  if (job.userId !== userContext.effectiveUser.id && !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  if (job.status !== "COMPLETED") {
    return NextResponse.json(
      { error: "La transcription doit être terminée avant de pouvoir être traduite." },
      { status: 409 }
    );
  }
  if (!Array.isArray(job.languages) || job.languages.length < 2) {
    return NextResponse.json(
      { error: "Ce job n'est pas en mode multi-langue — rien à traduire." },
      { status: 409 }
    );
  }

  const targetByLanguage = computeBilingualTargetLanguageMap(job.languages);
  if (!targetByLanguage) {
    return NextResponse.json(
      { error: "La traduction inverse n'est supportée qu'avec exactement 2 langues distinctes." },
      { status: 409 }
    );
  }

  // Charger les segments — R2 d'abord, fallback inline
  let segments: SegmentJSON[];
  try {
    if (job.outputJsonKey && r2Configured()) {
      const buf = await getFromR2(job.outputJsonKey);
      segments = JSON.parse(buf.toString("utf-8")) as SegmentJSON[];
    } else if (job.segmentsJson) {
      segments = JSON.parse(job.segmentsJson) as SegmentJSON[];
    } else {
      return NextResponse.json(
        { error: "Aucun fichier de segments disponible pour ce job." },
        { status: 422 }
      );
    }
  } catch (err) {
    console.error("[transcription/translate] Failed to load segments:", err);
    return NextResponse.json(
      { error: `Impossible de charger les segments : ${String(err)}` },
      { status: 500 }
    );
  }

  if (!Array.isArray(segments) || segments.length === 0) {
    return NextResponse.json(
      { error: "Le fichier de segments est vide." },
      { status: 422 }
    );
  }

  // Le bouton "Retraduire" passe ?force=1 pour bypass le guard idempotent.
  const forceRetranslate = new URL(req.url).searchParams.get("force") === "1";

  // Guard idempotence : si la majorité des segments ont déjà une traduction,
  // on considère que /translate a déjà tourné — on retourne le résultat
  // existant sans rappeler Claude. Évite la race condition d'un double-click
  // qui ferait 2 appels Claude concurrents puis 2 uploads R2 sur la même clé
  // (le dernier gagne, peut écraser des traductions partielles).
  const alreadyTranslatedCount = segments.filter(
    (s) => typeof s.translation === "string" && s.translation.trim().length > 0
  ).length;
  const eligibleCount = segments.filter(
    (s) => typeof s.text === "string" && s.text.trim().length > 0
  ).length;
  if (!forceRetranslate && eligibleCount > 0 && alreadyTranslatedCount >= eligibleCount) {
    return NextResponse.json({
      segmentCount: segments.length,
      translated: alreadyTranslatedCount,
      segments,
      alreadyTranslated: true,
    });
  }

  // Préparer les inputs pour le helper de traduction. On skip les segments sans
  // texte ou sans langue détectée — leur translation restera undefined.
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
    return NextResponse.json(
      { error: "Aucun segment éligible à la traduction (langue manquante ou texte vide)." },
      { status: 422 }
    );
  }

  let translations: Awaited<ReturnType<typeof translateSegments>>;
  try {
    translations = await translateSegments(inputs);
  } catch (err) {
    console.error("[transcription/translate] Claude API failed:", err);
    return NextResponse.json(
      { error: `Erreur de traduction : ${String(err)}` },
      { status: 502 }
    );
  }

  // Mapper sur les segments. Garde le champ `translation` même si null/empty
  // pour signaler que le pipeline a été appliqué.
  let appliedCount = 0;
  for (const { index, translation } of translations) {
    if (typeof translation === "string") {
      segments[index] = { ...segments[index], translation };
      if (translation.trim().length > 0) appliedCount += 1;
    }
  }

  // Persister
  const enrichedJson = JSON.stringify(segments, null, 2);
  if (job.outputJsonKey && r2Configured()) {
    try {
      await uploadToR2(job.outputJsonKey, Buffer.from(enrichedJson, "utf-8"), "application/json");
    } catch (err) {
      console.error("[transcription/translate] R2 upload failed:", err);
      return NextResponse.json(
        { error: `Échec persistance R2 : ${String(err)}` },
        { status: 500 }
      );
    }
  } else if (job.segmentsJson != null) {
    await prisma.transcriptionJob.update({
      where: { id: job.id },
      data: { segmentsJson: enrichedJson },
    });
  }

  return NextResponse.json({
    segmentCount: segments.length,
    translated: appliedCount,
    segments,
  });
}
