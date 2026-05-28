/**
 * triggerAutoDescriptionFromTranscription.ts
 *
 * Déclenche automatiquement une génération de description (Claude) après la
 * fin d'un TranscriptionJob issu du pipeline auto (job.renderId non null).
 *
 * Pré-conditions (toutes doivent être vraies sinon skip silencieux) :
 *  - Le job a un renderId rattaché à un slot
 *  - Le pattern du slot a needsDescription === "autoGenerate"
 *  - Le slot a un prompt résolu (descriptionPromptIdOverride OU
 *    pattern.descriptionPromptId)
 *  - slot.description est vide ou null (on n'écrase JAMAIS la rédaction
 *    manuelle CM — le job est skip, pas créé avec result mort)
 *  - Le transcription job a un outputJsonKey lisible
 *
 * Comportement :
 *  - Crée un DescriptionJob (claude par défaut), lance l'appel API, écrit
 *    le résultat dans slot.description si toujours vide au moment d'écrire.
 *  - Loggue chaque skip avec une raison structurée pour debug.
 *  - Non bloquant : toutes les erreurs sont catch + log (jamais throw).
 *
 * Appelé depuis le webhook RunPod transcription après COMPLETED.
 */

import { prisma } from "@/lib/prisma";
import { getFromR2, r2Configured } from "@/lib/r2";
import { logActivity } from "@/lib/services/slot/activity";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const MAX_TRANSCRIPT_CHARS = 50_000;

type SkipReason =
  | "no_render"
  | "no_slot"
  | "needs_description_not_auto"
  | "description_already_set"
  | "no_prompt_resolved"
  | "prompt_inactive"
  | "no_transcription_output"
  | "r2_not_configured"
  | "no_anthropic_key";

function logSkip(jobId: string, reason: SkipReason, extra?: Record<string, unknown>) {
  console.info(
    `[autoDescription] transcriptionJob=${jobId} skipped: ${reason}`,
    extra ?? {},
  );
}

/**
 * Lit le JSON segments d'une transcription depuis R2 et reconstitue le texte.
 * Retourne null si lecture impossible (R2 absent, fichier absent, JSON malformé).
 */
async function readTranscriptionTextFromR2(outputJsonKey: string): Promise<string | null> {
  if (!r2Configured()) return null;
  try {
    const buf = await getFromR2(outputJsonKey);
    if (!buf) return null;
    const parsed = JSON.parse(buf.toString("utf-8")) as {
      segments?: Array<{ text?: string }>;
    };
    const segments = parsed.segments ?? [];
    return segments
      .map((s) => (s.text ?? "").trim())
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_TRANSCRIPT_CHARS);
  } catch (err) {
    console.warn(`[autoDescription] readTranscriptionTextFromR2 failed for key=${outputJsonKey}:`, err);
    return null;
  }
}

export async function triggerAutoDescriptionForTranscription(
  transcriptionJobId: string,
): Promise<void> {
  if (!ANTHROPIC_API_KEY) {
    logSkip(transcriptionJobId, "no_anthropic_key");
    return;
  }

  const job = await prisma.transcriptionJob.findUnique({
    where: { id: transcriptionJobId },
    select: {
      id: true,
      userId: true,
      renderId: true,
      publicationVersionId: true,
      outputJsonKey: true,
      render: {
        select: {
          id: true,
          publicationSlotId: true,
        },
      },
      publicationVersion: {
        select: { id: true, slotId: true },
      },
    },
  });

  // Source du slot : soit via render (auto_template) soit via version
  // (manual_rushes / external_upload — Phase 2.4).
  const slotId =
    job?.render?.publicationSlotId ?? job?.publicationVersion?.slotId ?? null;
  if (!job || !slotId) {
    logSkip(transcriptionJobId, "no_render");
    return;
  }

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      description: true,
      descriptionPromptIdOverride: true,
      needsDescriptionOverride: true,
      pattern: {
        select: {
          needsDescription: true,
          descriptionPromptId: true,
        },
      },
    },
  });

  if (!slot) {
    logSkip(transcriptionJobId, "no_slot", { slotId });
    return;
  }

  const effectiveNeedsDescription =
    slot.needsDescriptionOverride ?? slot.pattern?.needsDescription ?? "none";
  if (effectiveNeedsDescription !== "autoGenerate") {
    logSkip(transcriptionJobId, "needs_description_not_auto", {
      slotId,
      effective: effectiveNeedsDescription,
    });
    return;
  }

  // Anti-écrasement de la rédaction CM : si déjà du contenu, on s'arrête.
  if (slot.description && slot.description.trim().length > 0) {
    logSkip(transcriptionJobId, "description_already_set", { slotId });
    return;
  }

  const promptId =
    slot.descriptionPromptIdOverride ?? slot.pattern?.descriptionPromptId ?? null;
  if (!promptId) {
    logSkip(transcriptionJobId, "no_prompt_resolved", { slotId });
    return;
  }

  const prompt = await prisma.descriptionPrompt.findUnique({
    where: { id: promptId, isActive: true },
  });
  if (!prompt) {
    logSkip(transcriptionJobId, "prompt_inactive", { slotId, promptId });
    return;
  }

  if (!job.outputJsonKey) {
    logSkip(transcriptionJobId, "no_transcription_output", { slotId });
    return;
  }

  const transcriptText = await readTranscriptionTextFromR2(job.outputJsonKey);
  if (!transcriptText) {
    logSkip(transcriptionJobId, "r2_not_configured", { slotId });
    return;
  }

  // Construit le user message comme /api/description/generate — version minimale
  // recipe = transcript_only (auto-trigger : on n'a pas d'image, juste le transcript)
  const userMessage = `${prompt.prompt}\n\nTranscription :\n${transcriptText}`;

  let result: string;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system:
          "Tu es un expert en rédaction. Génère uniquement le texte demandé, sans commentaire, introduction ni balise markdown.",
        messages: [{ role: "user", content: [{ type: "text", text: userMessage }] }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Claude API ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    result = data.content.find((c) => c.type === "text")?.text?.trim() ?? "";
  } catch (err) {
    console.error(`[autoDescription] Claude call failed for slot=${slotId}:`, err);
    await prisma.descriptionJob.create({
      data: {
        userId: job.userId,
        status: "FAILED",
        inputType: "transcription",
        transcriptionId: job.id,
        slotId,
        promptId,
        promptSnapshot: prompt.prompt,
        model: "claude",
        errorMsg: (err instanceof Error ? err.message : String(err)).slice(0, 200),
      },
    });
    return;
  }

  if (!result) {
    logSkip(transcriptionJobId, "no_transcription_output", { slotId, reason: "empty_llm_response" });
    return;
  }

  // Re-check anti-écrasement après l'appel Claude — la CM a pu rédiger pendant
  // que Claude réfléchissait. On utilise updateMany avec condition WHERE pour
  // un check-then-set atomique côté DB (pas de race window).
  const update = await prisma.publicationSlot.updateMany({
    where: { id: slotId, OR: [{ description: null }, { description: "" }] },
    data: { description: result },
  });

  const job_ = await prisma.descriptionJob.create({
    data: {
      userId: job.userId,
      status: "COMPLETED",
      inputType: "transcription",
      transcriptionId: job.id,
      slotId,
      promptId,
      promptSnapshot: prompt.prompt,
      model: "claude",
      result,
    },
  });

  if (update.count > 0) {
    await logActivity(prisma, {
      slotId,
      actorId: null, // auto-trigger système
      type: "DESCRIPTION_COMPLETED",
      payload: {
        descriptionJobId: job_.id,
        model: "claude",
        promptId,
        autoTriggered: true,
      },
    });
    console.info(`[autoDescription] slot=${slotId} description filled via auto-trigger`);
  } else {
    console.info(
      `[autoDescription] slot=${slotId} description was filled manually mid-generation — kept user input, IA result logged in DescriptionJob ${job_.id}`,
    );
  }
}
