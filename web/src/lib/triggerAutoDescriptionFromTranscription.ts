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
import { getFromR2, r2Configured } from "@/lib/r2";
import { logActivity } from "@/lib/services/slot/activity";
import { POST_VALIDATION_STATUSES } from "@/lib/publications/constants";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
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
  | "client_review_in_flight";

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
      pattern: {
        select: {
          needsDescription: true,
          descriptionPromptId: true,
          needsClientValidation: true,
        },
      },
    },
  });

  if (!slot) {
    logSkip(transcriptionJobId, "no_slot", { slotId });
    return;
  }

  // ── 2. Skips légitimes (silencieux, AUCUN job créé) ──────────────────────
  // Ces cas ne sont pas des erreurs — le slot n'attend pas de description IA.
  const effectiveNeedsDescription =
    slot.needsDescriptionOverride ?? slot.pattern?.needsDescription ?? "none";
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
    slot.pattern?.needsClientValidation ??
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
    slot.descriptionPromptIdOverride ?? slot.pattern?.descriptionPromptId ?? null;
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
    try {
      const parsed = JSON.parse(job.segmentsJson) as Array<{ text?: string }>;
      const text = parsed
        .map((s) => (s.text ?? "").trim())
        .filter(Boolean)
        .join("\n")
        .slice(0, MAX_TRANSCRIPT_CHARS);
      if (text.length > 0) {
        transcriptText = text;
        transcriptSource = "db";
      }
    } catch (err) {
      console.warn(`[autoDescription] segmentsJson invalide pour ${transcriptionJobId}:`, err);
    }
  }
  if (!transcriptText && job.outputJsonKey) {
    transcriptText = await readTranscriptionTextFromR2(job.outputJsonKey);
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

  // Construit le user message — 2 modes :
  //  - transcript présent : recipe = transcript_only
  //  - transcript vide + fallbackFrame : recipe = frame_only (image décrit la
  //    publication, ex. vidéo immobilier silencieuse)
  const userMessage = transcriptText
    ? `${prompt.prompt}\n\nTranscription :\n${transcriptText}`
    : `${prompt.prompt}\n\nLa vidéo ne contient pas de parole. Base-toi UNIQUEMENT sur l'image jointe (une frame extraite de la vidéo). Décris ce que tu vois — n'invente rien qui n'est pas visible.`;

  const messageContent: Array<
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  > = [];
  if (fallbackFrame) {
    messageContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: fallbackFrame.mediaType,
        data: fallbackFrame.base64,
      },
    });
  }
  messageContent.push({ type: "text", text: userMessage });

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
        messages: [{ role: "user", content: messageContent }],
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
