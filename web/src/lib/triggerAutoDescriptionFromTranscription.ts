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
import { notifyUser } from "@/lib/sseStore";
import {
  parseTranscriptSegments,
  segmentsToText,
  readTranscriptText,
} from "@/lib/transcription/transcriptText";
import { DESCRIPTION_LABELS, SYSTEM_PROMPT_DESCRIPTION } from "@/lib/llm/prompts";
import { normalizeRecipeKind, validateRecipeInputs } from "@/lib/llm/recipes";
import { runDescriptionForSlot } from "@/lib/services/description/runDescriptionForSlot";
import { logActivity } from "@/lib/services/slot/activity";
import { POST_VALIDATION_STATUSES } from "@/lib/publications/constants";
import { slotEffectivePatternSelect, resolveSlotEffectivePattern } from "@/lib/services/slot/effectivePattern";

// Conservé pour la garde de configuration ci-dessous : on veut un DescriptionJob
// FAILED explicite plutôt qu'une erreur opaque du client LLM.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MAX_TRANSCRIPT_CHARS = 50_000;
const CAPTIONS_API = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";

/**
 * Extrait 1 frame de fallback depuis une vidéo via le render-engine.
 * Utilisé quand le transcript est vide (vidéo silencieuse) — on bascule
 * sur une description "image-based" pour ne pas bloquer la chaîne.
 */
async function extractFallbackFrame(
  videoUrl: string,
  timestampSec = 1.5,
): Promise<{ base64: string; mediaType: "image/png" | "image/jpeg" } | null> {
  try {
    // Résoudre videoUrl relative → absolue côté render-engine
    let resolvedUrl = videoUrl;
    if (videoUrl.startsWith("/api/captions/")) {
      resolvedUrl = `${CAPTIONS_API}${videoUrl.replace("/api/captions", "")}`;
    } else if (videoUrl.startsWith("/")) {
      resolvedUrl = `${CAPTIONS_API}${videoUrl}`;
    }

    const form = new FormData();
    form.append("video_url", resolvedUrl);
    form.append("timestamps_json", JSON.stringify([timestampSec]));
    const res = await fetch(`${CAPTIONS_API}/api/extract-covers`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.warn(`[autoDescription] extractFallbackFrame failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const frames = (await res.json()) as Array<{ url: string }>;
    if (!frames.length) return null;

    const frameUrl = frames[0].url.startsWith("http")
      ? frames[0].url
      : `${CAPTIONS_API}${frames[0].url.startsWith("/") ? frames[0].url : `/${frames[0].url}`}`;
    const frameRes = await fetch(frameUrl, { signal: AbortSignal.timeout(30_000) });
    if (!frameRes.ok) {
      console.warn(`[autoDescription] frame download failed (${frameRes.status}): ${frameUrl}`);
      return null;
    }
    const buf = Buffer.from(await frameRes.arrayBuffer());
    const mediaType: "image/png" | "image/jpeg" = frameUrl.toLowerCase().endsWith(".jpg") || frameUrl.toLowerCase().endsWith(".jpeg")
      ? "image/jpeg"
      : "image/png";
    return { base64: buf.toString("base64"), mediaType };
  } catch (err) {
    console.warn(`[autoDescription] extractFallbackFrame threw:`, err);
    return null;
  }
}

type SkipReason =
  | "no_render"
  | "no_slot"
  | "needs_description_not_auto"
  | "description_already_set"
  | "description_already_in_flight"
  | "no_prompt_resolved"
  | "prompt_inactive"
  | "no_transcription_output"
  | "r2_not_configured"
  | "no_anthropic_key"
  | "awaiting_client_validation"
  | "client_review_in_flight"
  | "recipe_incompatible_with_inputs";

function logSkip(jobId: string, reason: SkipReason, extra?: Record<string, unknown>) {
  console.info(
    `[autoDescription] transcriptionJob=${jobId} skipped: ${reason}`,
    extra ?? {},
  );
}


/**
 * Helper : crée un DescriptionJob FAILED avec errorMsg + notify SSE.
 * Utilisé pour matérialiser les échecs de config/infra qui empêcheraient le
 * trigger de démarrer — sans ça, le job restait invisible et la fiche
 * affichait "Lancement imminent…" éternellement.
 */
async function createFailedJob(params: {
  userId: string;
  slotId: string;
  transcriptionId: string | null;
  promptId: string | null;
  promptSnapshot: string | null;
  errorMsg: string;
}): Promise<void> {
  const job = await prisma.descriptionJob.create({
    data: {
      userId: params.userId,
      status: "FAILED",
      inputType: "transcription",
      transcriptionId: params.transcriptionId,
      slotId: params.slotId,
      promptId: params.promptId,
      promptSnapshot: params.promptSnapshot ?? "",
      model: "claude",
      errorMsg: params.errorMsg.slice(0, 500),
    },
  });
  notifyUser(params.userId, {
    jobType: "description",
    jobId: job.id,
    status: "FAILED",
    slotId: params.slotId,
    errorMsg: params.errorMsg,
  });
}

export async function triggerAutoDescriptionForTranscription(
  transcriptionJobId: string,
  /**
   * Optionnel : transcript déjà en mémoire (dev local sans R2).
   * Si fourni, on skip la lecture R2 et on l'utilise directement.
   */
  providedTranscriptText?: string | null,
): Promise<void> {
  // ── 1. Récupération transcription + slot ────────────────────────────────
  const job = await prisma.transcriptionJob.findUnique({
    where: { id: transcriptionJobId },
    select: {
      id: true,
      userId: true,
      renderId: true,
      publicationVersionId: true,
      outputJsonKey: true,
      segmentsJson: true,
      render: {
        select: {
          id: true,
          publicationSlotId: true,
          videoUrl: true,
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
      status: true,
      description: true,
      descriptionPromptIdOverride: true,
      needsDescriptionOverride: true,
      needsClientValidationOverride: true,
      // Pattern legacy + binding (recette par compte) — voir effectivePattern.ts.
      ...slotEffectivePatternSelect,
    },
  });

  if (!slot) {
    logSkip(transcriptionJobId, "no_slot", { slotId });
    return;
  }

  // Config recette effective : PatternBinding ou PatternTemplate global.
  const effPattern = resolveSlotEffectivePattern(slot);

  // ── 2. Skips légitimes (silencieux, AUCUN job créé) ──────────────────────
  // Ces cas ne sont pas des erreurs — le slot n'attend pas de description IA.
  const effectiveNeedsDescription =
    slot.needsDescriptionOverride ?? effPattern?.needsDescription ?? "none";
  if (effectiveNeedsDescription !== "autoGenerate") {
    logSkip(transcriptionJobId, "needs_description_not_auto", {
      slotId,
      effective: effectiveNeedsDescription,
    });
    return;
  }

  // Garde "client en train de revoir" : si l'admin a manuellement envoyé le
  // slot au client (AWAITING_CLIENT ou CLIENT_REVISION), on diffère quoi qu'il
  // arrive — même si needsValidation=false. Sans cette garde, la description IA
  // pouvait s'écrire pendant que le client validait, créant une divergence
  // entre la version vue par le client et celle vue côté back-office.
  if (slot.status === "AWAITING_CLIENT" || slot.status === "CLIENT_REVISION") {
    logSkip(transcriptionJobId, "client_review_in_flight", {
      slotId,
      status: slot.status,
    });
    return;
  }

  // Garde "post-validation client" : si validation requise et pas encore
  // approuvée, on diffère sans créer de job (il sera retentré après approve).
  const needsValidation =
    slot.needsClientValidationOverride ??
    effPattern?.needsClientValidation ??
    false;
  if (needsValidation && !POST_VALIDATION_STATUSES.has(slot.status)) {
    logSkip(transcriptionJobId, "awaiting_client_validation", {
      slotId,
      status: slot.status,
    });
    return;
  }

  // Anti-écrasement de la rédaction CM : si déjà du contenu, on s'arrête.
  if (slot.description && slot.description.trim().length > 0) {
    logSkip(transcriptionJobId, "description_already_set", { slotId });
    return;
  }

  // V4 bug bug-hunter #7 : anti-double-trigger. Pour les slots manual_rushes,
  // l'admin pouvait cliquer "Relancer la chaîne" pendant que le webhook
  // RunPod transcription créait déjà un DescriptionJob → 2 jobs concurrents
  // pour le même slot, le second écrasait potentiellement le premier dans
  // slot.description et l'historique avait des doublons COMPLETED.
  // Garde : skip si un DescriptionJob actif (PROCESSING) existe déjà.
  // COMPLETED couvert par "description_already_set" ci-dessus.
  // FAILED n'est pas skip : on veut retenter.
  const inFlightDescriptionJob = await prisma.descriptionJob.findFirst({
    where: { slotId, status: "PROCESSING" },
    select: { id: true },
  });
  if (inFlightDescriptionJob) {
    logSkip(transcriptionJobId, "description_already_in_flight", {
      slotId,
      existingJobId: inFlightDescriptionJob.id,
    });
    return;
  }

  // ── 3. À partir d'ici, un DescriptionJob DOIT exister (succès ou échec) ─
  // Fix 2026-05-30 : avant ce refactor, tous les skips ci-dessous ne créaient
  // AUCUN job → la fiche restait sur "Lancement imminent…" éternellement et
  // /admin/jobs n'avait aucune trace. Maintenant chaque échec de config /
  // d'infra matérialise un DescriptionJob FAILED visible avec sa raison.

  if (!ANTHROPIC_API_KEY) {
    logSkip(transcriptionJobId, "no_anthropic_key");
    await createFailedJob({
      userId: job.userId,
      slotId,
      transcriptionId: job.id,
      promptId: null,
      promptSnapshot: null,
      errorMsg: "Clé ANTHROPIC_API_KEY manquante côté serveur — contacter l'admin.",
    });
    return;
  }

  const promptId =
    slot.descriptionPromptIdOverride ?? effPattern?.descriptionPromptId ?? null;
  if (!promptId) {
    logSkip(transcriptionJobId, "no_prompt_resolved", { slotId });
    await createFailedJob({
      userId: job.userId,
      slotId,
      transcriptionId: job.id,
      promptId: null,
      promptSnapshot: null,
      errorMsg: "Aucun prompt configuré sur le pattern (ni override slot). Configurer un prompt par défaut depuis l'admin du pattern.",
    });
    return;
  }

  const prompt = await prisma.descriptionPrompt.findUnique({
    where: { id: promptId, isActive: true },
  });
  if (!prompt) {
    logSkip(transcriptionJobId, "prompt_inactive", { slotId, promptId });
    await createFailedJob({
      userId: job.userId,
      slotId,
      transcriptionId: job.id,
      promptId,
      promptSnapshot: null,
      errorMsg: "Prompt référencé inactif ou supprimé — réactiver ou changer le prompt par défaut du pattern.",
    });
    return;
  }

  // Résolution du transcript en cascade :
  //  1. providedTranscriptText (appelant fournit, ex dev local synchrone)
  //  2. job.segmentsJson (segments persistés en DB par transcribeRenderLocal)
  //  3. R2 via outputJsonKey (mode RunPod prod)
  // Si les trois échouent → DescriptionJob FAILED avec message clair.
  let transcriptText: string | null = null;
  let transcriptSource: "provided" | "db" | "r2" | null = null;

  if (providedTranscriptText && providedTranscriptText.trim().length > 0) {
    transcriptText = providedTranscriptText.slice(0, MAX_TRANSCRIPT_CHARS);
    transcriptSource = "provided";
  } else if (job.segmentsJson) {
    const text = segmentsToText(parseTranscriptSegments(job.segmentsJson));
    if (text.length > 0) {
      transcriptText = text;
      transcriptSource = "db";
    }
  }
  // Lecture R2 via le helper partagé. Correctif de production : l'ancien lecteur
  // local parsait `parsed.segments`, alors que le worker écrit un TABLEAU NU
  // (runpod_worker.py fait `_json.dumps(list)`). En prod — où `segmentsJson`
  // inline est absent — le texte lu était donc systématiquement vide, et cette
  // fonction basculait sur son fallback "frame vidéo" : les descriptions étaient
  // rédigées depuis une image au lieu du transcript, sans aucun signal.
  if (!transcriptText && job.outputJsonKey) {
    transcriptText = await readTranscriptText({
      status: "COMPLETED",
      segmentsJson: null,
      outputJsonKey: job.outputJsonKey,
    });
    if (transcriptText) transcriptSource = "r2";
  }

  // Fallback "frame-only" : si on n'a aucun transcript (vidéo silencieuse),
  // on extrait 1 frame de la vidéo + on demande à Claude de décrire
  // l'image au lieu d'abandonner. Couvre les cas immobilier où la vidéo
  // montre un bien sans voix-off.
  let fallbackFrame: { base64: string; mediaType: "image/png" | "image/jpeg" } | null = null;
  if (!transcriptText && job.render?.videoUrl) {
    console.info(`[autoDescription] transcript vide pour ${transcriptionJobId} → tentative fallback frame depuis ${job.render.videoUrl.slice(0, 80)}`);
    fallbackFrame = await extractFallbackFrame(job.render.videoUrl);
    if (fallbackFrame) {
      console.info(`[autoDescription] frame extraite (${fallbackFrame.base64.length} chars base64) — bascule en mode image-only`);
    }
  }

  if (!transcriptText && !fallbackFrame) {
    logSkip(transcriptionJobId, "no_transcription_output", { slotId });
    await createFailedJob({
      userId: job.userId,
      slotId,
      transcriptionId: job.id,
      promptId,
      promptSnapshot: prompt.prompt,
      errorMsg: !job.render?.videoUrl
        ? "Transcription vide et aucune vidéo source — impossible de générer la description."
        : "Transcription vide et extraction d'une frame fallback échouée. Vérifier que le render-engine répond sur /api/extract-covers.",
    });
    return;
  }

  if (transcriptText) {
    console.info(`[autoDescription] transcript résolu via ${transcriptSource} (${transcriptText.length} chars) pour ${transcriptionJobId}`);
  }

  // Recette effective : dispatcher partagé avec la route manuelle
  // (`lib/services/description/runDescriptionForSlot.ts`) — avant ce fix,
  // l'auto-trigger ignorait totalement `recipeKind`/`recipeConfig` du prompt
  // et construisait son message en dur (recipe implicite `transcript_only`).
  // Un prompt configuré en `context_enriched` ou `two_pass_reformulate` se
  // comporte désormais à l'identique, qu'il soit lancé à la main ou par la
  // chaîne auto.
  const recipeKind = normalizeRecipeKind((prompt as { recipeKind?: string }).recipeKind);

  // Image de référence : la frame de fallback extraite ci-dessus (§3), s'il y
  // en a une — le cas « transcript vide → décrit la frame » reste couvert.
  const image = fallbackFrame
    ? {
        base64: fallbackFrame.base64,
        mimeType: fallbackFrame.mediaType,
        dataUrl: `data:${fallbackFrame.mediaType};base64,${fallbackFrame.base64}`,
      }
    : null;

  // Garde recette/image AVANT tout DescriptionJob PROCESSING : une recette
  // qui exige une image (transcript_and_frame / transcript_multi_frame) sans
  // frame disponible ici (le fallback ne s'extrait que si le transcript est
  // vide, cf. §3) n'est pas une erreur infra — c'est une config de recette
  // incompatible avec ce slot, matérialisée en FAILED comme les autres
  // erreurs de config ci-dessus (no_prompt_resolved, prompt_inactive…).
  const recipeError = validateRecipeInputs({ recipeKind, hasImage: !!image });
  if (recipeError) {
    logSkip(transcriptionJobId, "recipe_incompatible_with_inputs", { slotId, recipeKind });
    await createFailedJob({
      userId: job.userId,
      slotId,
      transcriptionId: job.id,
      promptId,
      promptSnapshot: prompt.prompt,
      errorMsg: `${recipeError} (recette « ${recipeKind} » du prompt configuré sur la recette).`,
    });
    return;
  }

  // ── 4. Lifecycle visible : QUEUED → PROCESSING → COMPLETED/FAILED ────────
  const lifecycleJob = await prisma.descriptionJob.create({
    data: {
      userId: job.userId,
      status: "PROCESSING",
      inputType: "transcription",
      transcriptionId: job.id,
      slotId,
      promptId,
      promptSnapshot: prompt.prompt,
      model: "claude",
    },
  });
  notifyUser(job.userId, {
    jobType: "description",
    jobId: lifecycleJob.id,
    status: "PROCESSING",
    slotId,
  });

  let result: string;
  try {
    result = await runDescriptionForSlot({
      promptText: prompt.prompt,
      recipeKind: (prompt as { recipeKind?: string }).recipeKind,
      recipeConfig: (prompt as { recipeConfig?: unknown }).recipeConfig,
      slotId,
      transcriptText,
      image,
      model: "claude",
      system: SYSTEM_PROMPT_DESCRIPTION,
      labels: DESCRIPTION_LABELS,
      logPrefix: "[autoDescription]",
    });
  } catch (err) {
    console.error(`[autoDescription] Claude call failed for slot=${slotId}:`, err);
    const errorMsg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await prisma.descriptionJob.update({
      where: { id: lifecycleJob.id },
      data: { status: "FAILED", errorMsg },
    });
    notifyUser(job.userId, {
      jobType: "description",
      jobId: lifecycleJob.id,
      status: "FAILED",
      slotId,
      errorMsg,
    });
    return;
  }

  if (!result) {
    logSkip(transcriptionJobId, "no_transcription_output", { slotId, reason: "empty_llm_response" });
    const errorMsg = "Réponse Claude vide — relancer ou vérifier le prompt.";
    await prisma.descriptionJob.update({
      where: { id: lifecycleJob.id },
      data: { status: "FAILED", errorMsg },
    });
    notifyUser(job.userId, {
      jobType: "description",
      jobId: lifecycleJob.id,
      status: "FAILED",
      slotId,
      errorMsg,
    });
    return;
  }

  // Re-check anti-écrasement après l'appel Claude — la CM a pu rédiger pendant
  // que Claude réfléchissait. On utilise updateMany avec condition WHERE pour
  // un check-then-set atomique côté DB (pas de race window).
  const update = await prisma.publicationSlot.updateMany({
    where: { id: slotId, OR: [{ description: null }, { description: "" }] },
    data: { description: result },
  });

  // Fix bug audit 2026-05-30 (H5) : on créait le job en COMPLETED systématiquement,
  // même quand update.count === 0 (description manuelle déjà saisie). Le statut
  // était trompeur. On garde COMPLETED (le job IA a abouti) mais on stocke un
  // errorMsg explicite signalant que le résultat n'a pas été appliqué au slot,
  // pour distinguer dans l'UI / les logs.
  const wasApplied = update.count > 0;
  await prisma.descriptionJob.update({
    where: { id: lifecycleJob.id },
    data: {
      status: "COMPLETED",
      result,
      errorMsg: wasApplied
        ? null
        : "Description IA générée mais non appliquée — le slot a été rempli manuellement pendant la génération.",
    },
  });

  // SSE — la fiche publication écoute jobType=description pour refresh auto.
  notifyUser(job.userId, {
    jobType: "description",
    jobId: lifecycleJob.id,
    status: "COMPLETED",
    slotId,
  });

  if (wasApplied) {
    await logActivity(prisma, {
      slotId,
      actorId: null, // auto-trigger système
      type: "DESCRIPTION_COMPLETED",
      payload: {
        descriptionJobId: lifecycleJob.id,
        model: "claude",
        promptId,
        autoTriggered: true,
      },
    });
    console.info(`[autoDescription] slot=${slotId} description filled via auto-trigger`);
  } else {
    console.info(
      `[autoDescription] slot=${slotId} description was filled manually mid-generation — kept user input, IA result logged in DescriptionJob ${lifecycleJob.id} (errorMsg set)`,
    );
  }
}
