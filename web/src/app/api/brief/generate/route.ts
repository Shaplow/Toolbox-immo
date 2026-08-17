/**
 * POST /api/brief/generate
 *
 * Génère un brief de montage destiné au monteur, à partir d'une transcription,
 * d'un prompt de type "brief" et d'infos complémentaires.
 *
 * Body JSON :
 *   {
 *     promptId: string,                    // DescriptionPrompt avec kind="brief"
 *     transcriptText?: string,             // texte collé ou extrait d'un fichier côté client
 *     transcriptionId?: string,            // ou TranscriptionJob existant (lu côté serveur)
 *     extraInfo?: string,                  // infos complémentaires (max 2000 chars)
 *     model: "claude" | "gpt",
 *     format: "markdown" | "plain",        // pilote les consignes de mise en forme
 *     inputFilename?: string,              // pour l'historique
 *   }
 *
 * Réponse : { jobId: string; result: string }
 *
 * ## Pourquoi une route distincte de /api/description/generate
 *
 * Celle-ci porte tout le couplage au pipeline publication : résolution du slot,
 * auto-fetch du transcript depuis le slot, `canUserAccessSlot`, `logActivity`,
 * recettes à image, contexte `<field>` anti-prompt-injection. Un brief standalone
 * n'a besoin d'aucun de ces mécanismes. Deux routes minces au-dessus d'une même
 * lib (`lib/llm/*`) restent plus lisibles qu'une route polymorphe à branches.
 *
 * Le brief n'écrit sur aucun slot : la sortie est copiée par l'admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { canAccessTool } from "@/lib/permissions/tools";
import { TOOLS } from "@/lib/permissions";
import { readTranscriptText } from "@/lib/transcription/transcriptText";
import { BRIEF_LABELS, systemPromptForBrief } from "@/lib/llm/prompts";
import {
  BRIEF_ALLOWED_RECIPES,
  normalizeRecipeKind,
  runRecipe,
  type RecipeConfig,
} from "@/lib/llm/recipes";

const MAX_EXTRA_INFO_CHARS = 2_000;

/**
 * Validation en Zod — la route description parse son body à la main, ce qui a
 * produit une cascade de dix `if` de validation. On ne reproduit pas ça.
 */
const bodySchema = z.object({
  promptId: z.string().min(1, "Prompt requis"),
  transcriptText: z.string().optional(),
  transcriptionId: z.string().optional(),
  extraInfo: z
    .string()
    .max(MAX_EXTRA_INFO_CHARS, `Infos complémentaires trop longues (max ${MAX_EXTRA_INFO_CHARS} caractères)`)
    .optional(),
  model: z.enum(["claude", "gpt"]),
  format: z.enum(["markdown", "plain"]),
  inputFilename: z.string().optional(),
});

export async function POST(req: NextRequest) {
  // ─── Auth ──────────────────────────────────────────────────────────────────
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;
  const effectiveUserId = userContext.effectiveUser.id;

  // canAccessTool (et non hasTool) : combine ROLE_TOOL_SCOPE et User.permissions,
  // donc un ADMIN passe par la sentinelle "*" et un CM/MONTEUR peut recevoir
  // l'accès au cas par cas sans changement de code.
  if (!canAccessTool(userContext.effectiveUser, TOOLS.BRIEF)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // ─── Validation du corps ───────────────────────────────────────────────────
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? (err.issues[0]?.message ?? "Corps de requête invalide")
        : "Corps JSON invalide";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { promptId, transcriptionId, extraInfo, model, format, inputFilename } = body;

  // ─── Prompt ────────────────────────────────────────────────────────────────
  // Le filtre sur kind="brief" est une garde, pas un détail : sans lui, un prompt
  // de légende Instagram passerait ici et produirait un « brief » hors sujet.
  const prompt = await prisma.descriptionPrompt.findFirst({
    where: { id: promptId, isActive: true, kind: "brief" },
  });
  if (!prompt) {
    return NextResponse.json(
      { error: "Prompt de brief introuvable ou désactivé" },
      { status: 404 },
    );
  }

  const recipeKind = normalizeRecipeKind(prompt.recipeKind);
  if (!BRIEF_ALLOWED_RECIPES.includes(recipeKind)) {
    // Les recettes à image supposent une frame de référence et `context_enriched`
    // suppose un slot de publication : un brief standalone n'a ni l'un ni l'autre.
    return NextResponse.json(
      {
        error:
          `La recette « ${recipeKind} » n'est pas utilisable pour un brief ` +
          `(elle requiert une image ou une publication). Recettes disponibles : ` +
          `${BRIEF_ALLOWED_RECIPES.join(", ")}.`,
      },
      { status: 400 },
    );
  }
  const recipeConfig = (prompt.recipeConfig ?? null) as RecipeConfig;

  // ─── Résolution du transcript ──────────────────────────────────────────────
  let transcriptText = body.transcriptText?.trim() ?? "";

  if (!transcriptText && transcriptionId) {
    // Ownership : un utilisateur ne lit pas la transcription d'un autre.
    const txJob = await prisma.transcriptionJob.findUnique({
      where: { id: transcriptionId },
      select: {
        userId: true,
        status: true,
        segmentsJson: true,
        outputJsonKey: true,
      },
    });
    if (!txJob || (txJob.userId !== effectiveUserId && !userContext.canAdminBypass)) {
      // 404 et non 403 : évite de confirmer l'existence d'un id.
      return NextResponse.json({ error: "Transcription introuvable" }, { status: 404 });
    }
    if (txJob.status !== "COMPLETED") {
      return NextResponse.json(
        { error: "Cette transcription n'est pas terminée" },
        { status: 409 },
      );
    }
    transcriptText = (await readTranscriptText(txJob)) ?? "";
  }

  if (!transcriptText) {
    return NextResponse.json(
      { error: "Ajoute une transcription (fichier, transcription existante ou texte collé)" },
      { status: 400 },
    );
  }

  const normalizedInputFilename = inputFilename?.trim() || null;

  // ─── Génération ────────────────────────────────────────────────────────────
  let result: string;
  try {
    result = await runRecipe({
      recipeKind,
      recipeConfig,
      promptText: prompt.prompt,
      rawPromptText: prompt.prompt,
      transcriptText,
      extraInfo,
      image: null,
      model,
      // Le format pilote les consignes de mise en forme : markdown pour un collage
      // dans Notion ou un doc, texte brut pour WhatsApp / mail où le balisage
      // s'afficherait en clair.
      system: systemPromptForBrief(format),
      labels: BRIEF_LABELS,
      logPrefix: "[brief/generate]",
    });
  } catch (err) {
    const errorMsg = (err instanceof Error ? err.message : "Erreur inconnue").slice(0, 200);
    console.error("[brief/generate] Provider failure", {
      userId: effectiveUserId,
      promptId,
      model,
      format,
      transcriptionId: transcriptionId ?? null,
      error: errorMsg,
    });

    const failedJob = await prisma.descriptionJob.create({
      data: {
        userId: effectiveUserId,
        kind: "brief",
        status: "FAILED",
        inputType: transcriptionId ? "transcription" : "upload",
        inputFilename: normalizedInputFilename,
        transcriptionId: transcriptionId ?? null,
        promptId,
        promptSnapshot: prompt.prompt,
        personalization: extraInfo ?? null,
        model,
        errorMsg,
      },
    });
    return NextResponse.json({ error: errorMsg, jobId: failedJob.id }, { status: 500 });
  }

  // Réponse vide (filtre de contenu, refus) : on trace un FAILED explicite plutôt
  // que de renvoyer un brief vide que l'utilisateur croirait valide.
  if (!result.trim()) {
    const emptyMsg = "Le modèle a renvoyé une réponse vide (filtre de contenu probable)";
    const failedJob = await prisma.descriptionJob.create({
      data: {
        userId: effectiveUserId,
        kind: "brief",
        status: "FAILED",
        inputType: transcriptionId ? "transcription" : "upload",
        inputFilename: normalizedInputFilename,
        transcriptionId: transcriptionId ?? null,
        promptId,
        promptSnapshot: prompt.prompt,
        personalization: extraInfo ?? null,
        model,
        errorMsg: emptyMsg,
      },
    });
    return NextResponse.json({ error: emptyMsg, jobId: failedJob.id }, { status: 500 });
  }

  const job = await prisma.descriptionJob.create({
    data: {
      userId: effectiveUserId,
      kind: "brief",
      status: "COMPLETED",
      inputType: transcriptionId ? "transcription" : "upload",
      inputFilename: normalizedInputFilename,
      transcriptionId: transcriptionId ?? null,
      // Volontairement pas de slotId ni de logActivity : le brief est standalone,
      // il n'est rattaché à aucune publication et n'écrit sur aucun slot.
      promptId,
      promptSnapshot: prompt.prompt,
      personalization: extraInfo ?? null,
      model,
      result,
    },
  });

  return NextResponse.json({ jobId: job.id, result });
}
