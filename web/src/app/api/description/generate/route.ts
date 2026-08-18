/**
 * POST /api/description/generate
 *
 * Génère une description textuelle à partir d'une transcription (SRT/JSON)
 * et/ou d'une image de référence en utilisant Claude ou GPT, avec un prompt personnalisé.
 *
 * Body JSON :
 *   {
 *     transcriptText?: string,      // texte extrait du SRT/JSON (max 50 000 chars)
 *     promptId: string,             // ID du DescriptionPrompt
 *     personalization?: string,     // texte libre ajouté au prompt
 *     model: "claude" | "gpt",
 *     inputFilename?: string,       // nom du fichier source (pour l'historique)
 *     transcriptionId?: string,     // si source = TranscriptionJob existant
 *     referenceImage?: {            // image facultative, peut suffire sans transcription
 *       dataUrl: string,
 *       filename?: string,
 *     }
 *   }
 *
 * Réponse :
 *   { jobId: string; result: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { canAccessTool } from "@/lib/permissions/tools";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { logActivity } from "@/lib/services/slot/activity";
// Le plafond de caractères est appliqué par le helper de lecture et par
// buildUserMessage — plus besoin de le connaître ici.
import { getSlotTranscriptText } from "@/lib/transcription/transcriptText";
import type { LlmImage } from "@/lib/llm/client";
import { DESCRIPTION_LABELS, SYSTEM_PROMPT_DESCRIPTION } from "@/lib/llm/prompts";
import { normalizeRecipeKind, validateRecipeInputs } from "@/lib/llm/recipes";
import { runDescriptionForSlot } from "@/lib/services/description/runDescriptionForSlot";

const MAX_PERSONALIZATION_CHARS = 2_000;
const MAX_REFERENCE_IMAGE_BYTES = 4 * 1024 * 1024;
const REFERENCE_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type ReferenceImageInput = {
  dataUrl?: string;
  filename?: string;
};

/** Une image validée est exactement ce qu'attend le client LLM. */
type ValidatedReferenceImage = LlmImage;

function validateReferenceImage(
  referenceImage?: ReferenceImageInput
): ValidatedReferenceImage | null {
  if (!referenceImage) {
    return null;
  }

  if (typeof referenceImage.dataUrl !== "string" || !referenceImage.dataUrl.trim()) {
    throw new Error("Image de référence invalide");
  }

  const match = referenceImage.dataUrl
    .trim()
    .match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);

  if (!match) {
    throw new Error("Formats d'image acceptés : PNG, JPG ou WEBP");
  }

  const [, mimeType, base64] = match;
  if (!REFERENCE_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error("Formats d'image acceptés : PNG, JPG ou WEBP");
  }

  const byteSize = Buffer.from(base64, "base64").byteLength;
  if (!byteSize) {
    throw new Error("Image de référence vide");
  }
  if (byteSize > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error("Image de référence trop volumineuse (4 Mo max)");
  }

  return {
    dataUrl: `data:${mimeType};base64,${base64}`,
    base64,
    mimeType,
  };
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const effectiveUserId = userContext.effectiveUser.id;

  // canAccessTool combine ROLE_TOOL_SCOPE (CM/MONTEUR ont description par défaut)
  // + User.permissions JSON (EXTERNAL_GENERATOR). hasTool() ignore le scope de
  // rôle et bloque silencieusement CM/MONTEUR — bug Phase 1.9 fix.
  if (!canAccessTool(userContext.effectiveUser, "description")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  let body: {
    transcriptText?: string;
    promptId?: string;
    personalization?: string;
    model?: string;
    inputFilename?: string;
    transcriptionId?: string;
    slotId?: string;
    referenceImage?: ReferenceImageInput;
  };

  try {
    body = await req.json() as {
      transcriptText?: string;
      promptId?: string;
      personalization?: string;
      model?: string;
      inputFilename?: string;
      transcriptionId?: string;
      slotId?: string;
      referenceImage?: ReferenceImageInput;
    };
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const {
    transcriptText,
    promptId,
    personalization,
    model,
    inputFilename,
    transcriptionId,
    slotId,
    referenceImage: referenceImageInput,
  } = body;

  if (!promptId) {
    return NextResponse.json({ error: "Prompt requis" }, { status: 400 });
  }
  if (model !== "claude" && model !== "gpt") {
    return NextResponse.json({ error: "Modèle invalide" }, { status: 400 });
  }

  // Guard isActive : un prompt désactivé par l'admin ne doit plus pouvoir
  // être utilisé (cas du promptId qui traîne dans une URL bookmark, dans
  // pattern.descriptionPromptId, ou dans slot.descriptionPromptIdOverride).
  const prompt = await prisma.descriptionPrompt.findUnique({
    where: { id: promptId, isActive: true },
  });
  if (!prompt) {
    return NextResponse.json({ error: "Prompt introuvable ou désactivé" }, { status: 404 });
  }

  // Validate transcriptionId ownership: the referenced job must belong to the current user.
  if (transcriptionId) {
    const txJob = await prisma.transcriptionJob.findUnique({
      where: { id: transcriptionId },
      select: { userId: true },
    });
    if (!txJob || txJob.userId !== effectiveUserId) {
      return NextResponse.json({ error: "Transcription introuvable" }, { status: 404 });
    }
  }

  // Validate slotId access (404 anti-énumération si non accessible).
  let resolvedSlotId: string | null = null;
  if (slotId) {
    const slot = await prisma.publicationSlot.findUnique({
      where: { id: slotId },
      select: { id: true, assigneeMonteurId: true, assigneeCmId: true },
    });
    const role = toUserRole(userContext.effectiveUser.role);
    if (!slot || !canUserAccessSlot(slot, role, effectiveUserId)) {
      return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
    }
    resolvedSlotId = slot.id;
  }

  let referenceImage: ValidatedReferenceImage | null;
  try {
    referenceImage = validateReferenceImage(referenceImageInput);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Image de référence invalide" },
      { status: 400 }
    );
  }

  let normalizedTranscriptText = transcriptText?.trim() ?? "";

  // Phase 3 — Bug bug-hunter #11 du audit 2026-05-31 : avant, le bouton
  // "Générer avec IA" inline dans DescriptionSection appelait cette route
  // sans transcriptText, ce qui forçait un 400. Désormais, si on a un
  // slotId valide et que le slot porte une transcription COMPLETED, on
  // charge automatiquement son texte (segmentsJson inline ou outputJsonKey
  // sur R2). Le client n'a rien à faire — appel cohérent avec la chaîne
  // auto.
  if (!normalizedTranscriptText && !referenceImage && resolvedSlotId) {
    const fetched = await getSlotTranscriptText(resolvedSlotId);
    if (fetched) {
      normalizedTranscriptText = fetched;
    }
  }

  if (!normalizedTranscriptText && !referenceImage) {
    return NextResponse.json(
      { error: "Ajoute une transcription ou une image de référence" },
      { status: 400 }
    );
  }

  if (personalization && personalization.length > MAX_PERSONALIZATION_CHARS) {
    return NextResponse.json(
      { error: `Texte personnalisé trop long (${personalization.length} / ${MAX_PERSONALIZATION_CHARS} caractères max)` },
      { status: 400 }
    );
  }
  // Validé en longueur ; aucun clamp à appliquer (rejet pur 400 ci-dessus).
  const validatedPersonalization = personalization;

  // ── Dispatcher recipes ────────────────────────────────────────────────────
  // Lecture des champs P6 (peut être absent sur des prompts antérieurs à la
  // migration, d'où le normalize avec fallback transcript_only).
  const recipeKind = normalizeRecipeKind(
    (prompt as { recipeKind?: string }).recipeKind,
  );

  // Validations spécifiques par recipe (avant tout appel LLM, donc avant de
  // facturer des tokens, et avant toute persistance de DescriptionJob — une
  // erreur de saisie utilisateur n'est pas un échec de job).
  const recipeError = validateRecipeInputs({ recipeKind, hasImage: !!referenceImage });
  if (recipeError) {
    return NextResponse.json({ error: recipeError }, { status: 400 });
  }

  const normalizedInputFilename = inputFilename?.trim()
    || (!normalizedTranscriptText ? referenceImageInput?.filename?.trim() : undefined)
    || null;

  let result: string;
  let errorMsg: string | undefined;

  try {
    // Le dispatcher de recettes (normalise recipeKind/config, enrichit le
    // prompt via le contexte fiche du slot pour context_enriched, puis
    // exécute mono-passe / double passe / image) vit dans
    // `lib/services/description/runDescriptionForSlot.ts` — partagé avec
    // l'auto-trigger post-transcription (triggerAutoDescriptionFromTranscription.ts).
    result = await runDescriptionForSlot({
      promptText: prompt.prompt,
      recipeKind: (prompt as { recipeKind?: string }).recipeKind,
      recipeConfig: (prompt as { recipeConfig?: unknown }).recipeConfig,
      slotId: resolvedSlotId,
      transcriptText: normalizedTranscriptText,
      extraInfo: validatedPersonalization,
      image: referenceImage,
      model,
      system: SYSTEM_PROMPT_DESCRIPTION,
      labels: DESCRIPTION_LABELS,
      logPrefix: "[description/generate]",
    });
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : "Erreur inconnue";
    errorMsg = rawMsg.slice(0, 200);
    console.error("[description/generate] Provider failure", {
      userId: effectiveUserId,
      promptId,
      model,
      transcriptionId: transcriptionId ?? null,
      hasReferenceImage: !!referenceImage,
      error: errorMsg,
    });

    const failedJob = await prisma.descriptionJob.create({
      data: {
        userId: effectiveUserId,
        status: "FAILED",
        inputType: transcriptionId ? "transcription" : "upload",
        inputFilename: normalizedInputFilename,
        transcriptionId: transcriptionId ?? null,
        slotId: resolvedSlotId,
        promptId,
        promptSnapshot: prompt.prompt,
        personalization: personalization ?? null,
        model,
        errorMsg,
      },
    });

    return NextResponse.json({ error: errorMsg, jobId: failedJob.id }, { status: 500 });
  }

  // Garde anti-écrasement : si le provider renvoie une réponse vide (rare mais
  // possible — filtre de contenu, réponse refusée), on enregistre FAILED plutôt
  // que de stocker "" qui pourrait écraser une description précédente côté UI.
  if (!result?.trim()) {
    const emptyMsg = "Le modèle a renvoyé une réponse vide (filtre de contenu probable)";
    const failedJob = await prisma.descriptionJob.create({
      data: {
        userId: effectiveUserId,
        status: "FAILED",
        inputType: transcriptionId ? "transcription" : "upload",
        inputFilename: normalizedInputFilename,
        transcriptionId: transcriptionId ?? null,
        slotId: resolvedSlotId,
        promptId,
        promptSnapshot: prompt.prompt,
        personalization: personalization ?? null,
        model,
        errorMsg: emptyMsg,
      },
    });
    return NextResponse.json({ error: emptyMsg, jobId: failedJob.id }, { status: 500 });
  }

  const job = await prisma.descriptionJob.create({
    data: {
      userId: effectiveUserId,
      status: "COMPLETED",
      inputType: transcriptionId ? "transcription" : "upload",
      inputFilename: normalizedInputFilename,
      transcriptionId: transcriptionId ?? null,
      slotId: resolvedSlotId,
      promptId,
      promptSnapshot: prompt.prompt,
      personalization: personalization ?? null,
      model,
      result,
    },
  });

  if (resolvedSlotId) {
    await logActivity(prisma, {
      slotId: resolvedSlotId,
      actorId: userContext.actualUser.id,
      type: "DESCRIPTION_COMPLETED",
      payload: { descriptionJobId: job.id, model, promptId },
    });
  }

  return NextResponse.json({ jobId: job.id, result });
}
