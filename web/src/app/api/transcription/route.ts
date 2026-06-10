/**
 * POST /api/transcription
 *
 * Démarre un job de transcription audio/vidéo.
 * - En mode RunPod : upload audio vers R2, soumet le job RunPod, retourne jobId.
 * - En mode local  : envoie directement au render-engine, sauvegarde le résultat en R2.
 *
 * Corps : multipart/form-data
 *   audio              : File (mp3/wav/m4a/mp4/mov/flac/ogg/aac)
 *   model              : "turbo" (défaut) | "large-v3" | "medium" | ...
 *   language           : "fr" (défaut) | "en" | "auto" | ...
 *   languages          : list[str] optionnel — mode multi-langue (≥2 codes ISO,
 *                        ex: ["fr","zh"]). Si présent, prend le pas sur `language`
 *                        et active job_type="transcribe-multilingual" (N passes
 *                        Whisper forcées + fusion). Pas d'"auto" autorisé ici.
 *   enable_diarization : "true" | "false" (défaut: "false")
 *
 * Réponse 202 :
 *   { jobId: string }
 *
 * GET /api/transcription
 * Liste les jobs de l'utilisateur connecté (50 derniers).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { uploadToR2, deleteFromR2, r2Configured, createPresignedUploadUrl } from "@/lib/r2";
import { submitRunpodJob, runpodConfigured } from "@/lib/runpod";
import { getRunpodWebhookUrl } from "@/lib/webhooks/runpod";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { sanitizeLanguage, sanitizeLanguages } from "@/lib/transcriptionLanguages";

const RUNPOD_API_KEY    = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;
const USE_RUNPOD        = process.env.USE_RUNPOD !== "false";
const CAPTIONS_API_URL  = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";
// HF_TOKEN transmis au worker uniquement si l'utilisateur active la diarisation
const HF_TOKEN          = process.env.HF_TOKEN;


const AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "m4a", "flac", "ogg", "aac", "mp4", "mov", "mkv", "webm",
]);

const ALLOWED_MODELS = new Set([
  "turbo", "large-v3", "large-v3-turbo", "medium", "small", "base", "tiny",
]);

function sanitizeModel(value: unknown): string {
  const s = String(value ?? "turbo").trim().toLowerCase();
  return ALLOWED_MODELS.has(s) ? s : "turbo";
}

function toBoolean(value: FormDataEntryValue | null, def = false): boolean {
  if (!value) return def;
  const s = String(value).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ─── Auth ────────────────────────────────────────────────────────────────
  const userContext = await getUserContext();
  if (!userContext) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.TRANSCRIPTION))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // ─── Mode RunPod via JSON (presigned URL — pas de fichier dans Next.js) ──
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    let body: { filename?: unknown; ext?: unknown; model?: unknown; language?: unknown; languages?: unknown; enable_diarization?: unknown; slotId?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
    }

    const filename = String(body.filename ?? "").trim();
    const ext = String(body.ext ?? "").toLowerCase().trim();
    if (!filename || !AUDIO_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: `Extension non supportée : .${ext}. Formats acceptés : ${[...AUDIO_EXTENSIONS].join(", ")}` },
        { status: 400 }
      );
    }

    const model            = sanitizeModel(body.model);
    const languages        = sanitizeLanguages(body.languages);
    const language         = languages.length > 0 ? languages[0] : sanitizeLanguage(body.language);
    const enableDiarization = String(body.enable_diarization ?? "false").toLowerCase() === "true";

    // V2 friction MED-2 du audit 2026-05-31 : si un slotId est fourni, on
    // valide l'accès et on rattache le job au slot pour qu'il apparaisse
    // dans la ProductionChain. Sans cette FK, la transcription standalone
    // restait "orpheline" côté UI fiche pour les slots manual_rushes /
    // external_upload sans render auto.
    let resolvedSlotId: string | null = null;
    if (body.slotId != null && body.slotId !== "") {
      const slotId = String(body.slotId);
      const slot = await prisma.publicationSlot.findUnique({
        where: { id: slotId },
        select: { id: true, assigneeMonteurId: true, assigneeCmId: true, assigneeVideasteId: true },
      });
      const role = toUserRole(userContext.effectiveUser.role);
      if (!slot || !canUserAccessSlot(slot, role, userContext.effectiveUser.id)) {
        return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
      }
      resolvedSlotId = slot.id;
    }
    if (enableDiarization && !HF_TOKEN) {
      return NextResponse.json(
        { error: "La diarisation n'est pas disponible sur ce serveur (HF_TOKEN non configuré)." },
        { status: 503 }
      );
    }
    const userId = userContext.effectiveUser.id;
    const jobTimestamp = Date.now();

    // ── Mode local dev : R2 non configuré → stockage local ─────────────────
    if (!r2Configured()) {
      const inputKey      = `local/transcription/${userId}/${jobTimestamp}/source.${ext}`;
      const outputJsonKey = `local/transcription/${userId}/${jobTimestamp}/segments.json`;
      const job = await prisma.transcriptionJob.create({
        data: {
          userId,
          status: "QUEUED",
          inputKey,
          inputFilename: filename,
          model,
          language,
          languages,
          enableDiarization,
          outputJsonKey,
          slotId: resolvedSlotId,
        },
      });
      return NextResponse.json(
        { jobId: job.id, uploadUrl: `/api/transcription/${job.id}/upload-local` },
        { status: 202 }
      );
    }

    if (!USE_RUNPOD || !runpodConfigured()) {
      return NextResponse.json(
        { error: "Mode presigned URL non disponible (RunPod non configuré)." },
        { status: 503 }
      );
    }

    const inputKey     = `transcription/${userId}/${jobTimestamp}/source.${ext}`;
    const outputJsonKey = `transcription/${userId}/${jobTimestamp}/segments.json`;

    // Générer une URL PUT pré-signée — le browser uploadera directement vers R2
    let uploadUrl: string;
    try {
      const mimeByExt: Record<string, string> = {
        mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska",
        webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav",
        m4a: "audio/mp4", flac: "audio/flac", ogg: "audio/ogg", aac: "audio/aac",
      };
      const contentTypeForUpload = mimeByExt[ext] ?? "application/octet-stream";
      uploadUrl = await createPresignedUploadUrl(inputKey, contentTypeForUpload, 3600);
    } catch (err) {
      console.error("[transcription/prepare] Presigned URL failed:", err);
      return NextResponse.json({ error: "Impossible de générer l'URL d'upload" }, { status: 500 });
    }

    const job = await prisma.transcriptionJob.create({
      data: {
        userId,
        status: "QUEUED",
        inputKey,
        inputFilename: filename,
        model,
        language,
        languages,
        enableDiarization,
        outputJsonKey,
        slotId: resolvedSlotId,
      },
    });

    return NextResponse.json({ jobId: job.id, uploadUrl }, { status: 202 });
  }

  // ─── Parse form (mode local / compatibilité) ──────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Impossible de lire le formulaire" }, { status: 400 });
  }

  const audioFile = formData.get("audio") as File | null;
  if (!audioFile || audioFile.size === 0) {
    return NextResponse.json({ error: "Fichier audio manquant" }, { status: 400 });
  }

  const ext = (audioFile.name.split(".").pop() ?? "").toLowerCase();
  if (!AUDIO_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      { error: `Extension non supportée : .${ext}. Formats acceptés : ${[...AUDIO_EXTENSIONS].join(", ")}` },
      { status: 400 }
    );
  }

  const model            = sanitizeModel(formData.get("model"));
  const languages        = sanitizeLanguages(formData.getAll("languages").length > 0 ? formData.getAll("languages") : formData.get("languages"));
  const language         = languages.length > 0 ? languages[0] : sanitizeLanguage(formData.get("language"));
  const enableDiarization = toBoolean(formData.get("enable_diarization"));
  if (enableDiarization && !HF_TOKEN) {
    return NextResponse.json(
      { error: "La diarisation n’est pas disponible sur ce serveur (HF_TOKEN non configuré)." },
      { status: 503 }
    );
  }

  // V6.7 — Le path form-data ignorait slotId (seul le JSON path le résolvait).
  // Désormais : si le form contient slotId, on valide l'accès et on rattache
  // le job au slot (cohérent avec le JSON path V2.4).
  const rawFormSlotId = formData.get("slotId");
  let formResolvedSlotId: string | null = null;
  if (rawFormSlotId && typeof rawFormSlotId === "string" && rawFormSlotId.length > 0) {
    const candidate = rawFormSlotId;
    const slot = await prisma.publicationSlot.findUnique({
      where: { id: candidate },
      select: {
        id: true,
        assigneeMonteurId: true,
        assigneeCmId: true,
        assigneeVideasteId: true,
      },
    });
    const role = toUserRole(userContext.effectiveUser.role);
    if (!slot || !canUserAccessSlot(slot, role, userContext.effectiveUser.id)) {
      return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
    }
    formResolvedSlotId = slot.id;
  }

  const jobTimestamp = Date.now();
  const userId = userContext.effectiveUser.id;

  // ─── Mode local (USE_RUNPOD=false) ────────────────────────────────────────
  if (!USE_RUNPOD) {
    const isMultilingual = languages.length >= 2;
    const job = await prisma.transcriptionJob.create({
      data: {
        userId,
        status: "PROCESSING",
        inputFilename: audioFile.name,
        model,
        language,
        languages,
        enableDiarization,
        slotId: formResolvedSlotId,
      },
    });

    try {
      const localForm = new FormData();
      localForm.append("audio", audioFile, audioFile.name);
      localForm.append("model_size", model === "turbo" ? "large-v3-turbo" : model);
      if (isMultilingual) {
        // L'endpoint local multilingue prend les langues en CSV
        // (FastAPI Form ne reçoit pas proprement les List[str] cross-clients).
        localForm.append("languages", languages.join(","));
      } else {
        localForm.append("language", language);
      }
      localForm.append("enable_diarization", String(enableDiarization));
      if (enableDiarization && HF_TOKEN) {
        localForm.append("hf_token", HF_TOKEN);
      }

      const localEndpoint = isMultilingual ? "/api/transcribe-multilingual" : "/api/transcribe";
      // ⚠ Node 20 fetch a un headersTimeout undici interne câblé à 5 min.
      // Sur des audios qui demandent >5 min de transcription Whisper, ce
      // fetch lèvera UND_ERR_HEADERS_TIMEOUT alors que FastAPI continue à
      // travailler. Pour des vidéos longues il faudra refacto l'API en
      // async polling (comme RunPod) — cf. plan dewdrop "Hors scope".
      const localRes = await fetch(`${CAPTIONS_API_URL}${localEndpoint}`, {
        method: "POST",
        body: localForm,
        signal: AbortSignal.timeout(60 * 60 * 1000), // garde-fou abort global
      });

      if (!localRes.ok) {
        const errText = await localRes.text();
        throw new Error(`render-engine ${localRes.status}: ${errText}`);
      }

      const data = await localRes.json() as {
        segments: Array<{ start: number; end: number; text: string; speaker?: string; language?: string }>;
        segment_count: number;
        duration: number;
        // L'endpoint mono renvoie `language`, le multi renvoie `languages`.
        language?: string;
        languages?: string[];
        has_diarization: boolean;
      };

      // Uploader le JSON en R2 pour stockage persistant
      let outputJsonKey: string | undefined;
      if (r2Configured()) {
        const jsonBuffer = Buffer.from(JSON.stringify(data.segments, null, 2), "utf-8");
        const key = `transcription/${userId}/${jobTimestamp}/segments.json`;
        await uploadToR2(key, jsonBuffer, "application/json");
        outputJsonKey = key;
      }

      await prisma.transcriptionJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          outputJsonKey,
          // Si pas de R2, on persiste les segments inline en DB pour que la
          // chaîne auto trouve quoi charger. Sinon (R2 configuré), les
          // triggers chargeront depuis outputJsonKey.
          ...(outputJsonKey ? {} : { segmentsJson: JSON.stringify(data.segments) }),
          segmentCount: data.segment_count,
          duration: data.duration,
          hasDiarization: data.has_diarization,
        },
      });

      // Mode multi : déclenche la traduction inverse auto sur les segments
      // (gating interne au trigger — skip pour les jobs mono).
      void (async () => {
        try {
          const { triggerAutoTranslationForTranscription } = await import("@/lib/triggerAutoTranslationFromTranscription");
          await triggerAutoTranslationForTranscription(job.id);
        } catch (err) {
          console.error(`[transcription/local] triggerAutoTranslation threw: ${String(err)}`);
        }
      })();

      return NextResponse.json({ jobId: job.id }, { status: 202 });
    } catch (err) {
      await prisma.transcriptionJob.update({
        where: { id: job.id },
        data: { status: "FAILED", errorMsg: String(err) },
      });
      return NextResponse.json({ error: `Erreur transcription locale : ${String(err)}` }, { status: 502 });
    }
  }

  // ─── Vérifications RunPod + R2 ────────────────────────────────────────────
  if (!runpodConfigured()) {
    return NextResponse.json(
      { error: "RunPod non configuré. Renseigner RUNPOD_API_KEY et RUNPOD_ENDPOINT_ID." },
      { status: 503 }
    );
  }
  if (!r2Configured()) {
    return NextResponse.json(
      { error: "Stockage R2 non configuré." },
      { status: 503 }
    );
  }

  // ─── Upload audio source vers R2 ─────────────────────────────────────────
  const inputKey = `transcription/${userId}/${jobTimestamp}/source.${ext}`;
  let audioUrl: string;
  try {
    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    const uploadResult = await uploadToR2(inputKey, audioBuffer, audioFile.type || "audio/mpeg");
    audioUrl = uploadResult.url;
  } catch (err) {
    console.error("[transcription] Upload audio R2 failed:", err);
    return NextResponse.json({ error: "Échec upload audio vers R2" }, { status: 500 });
  }

  const outputJsonKey = `transcription/${userId}/${jobTimestamp}/segments.json`;

  // ─── Créer TranscriptionJob en DB ────────────────────────────────────────
  // V6.7 — slotId résolu plus haut depuis form-data pour rattacher au slot.
  const job = await prisma.transcriptionJob.create({
    data: {
      userId,
      status: "QUEUED",
      inputKey,
      inputFilename: audioFile.name,
      model,
      language,
      languages,
      enableDiarization,
      outputJsonKey,
      slotId: formResolvedSlotId,
    },
  });

  // ─── Soumettre à RunPod ───────────────────────────────────────────────────
  const webhookUrl = getRunpodWebhookUrl("/api/webhooks/runpod/transcription");
  const isMultilingual = languages.length >= 2;
  const runpodPayload = {
    input: {
      job_type: isMultilingual ? "transcribe-multilingual" : "transcribe",
      audio_url: audioUrl,
      output_key: outputJsonKey,
      job_id: job.id,
      model_size: model === "turbo" ? "large-v3-turbo" : model,
      ...(isMultilingual ? { languages } : { language }),
      enable_diarization: enableDiarization,
      hf_token: enableDiarization ? (HF_TOKEN ?? null) : null,
    },
    ...(webhookUrl ? { webhook: webhookUrl } : {}),
  };

  let runpodJobId: string;
  try {
    const runpodData = await submitRunpodJob<{ id: string }>(
      RUNPOD_ENDPOINT_ID!,
      RUNPOD_API_KEY!,
      runpodPayload,
    );
    runpodJobId = runpodData.id;
  } catch (err) {
    await prisma.transcriptionJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMsg: String(err) },
    });
    // Nettoyer l'audio uploadé — plus d'intérêt si le job n'a pas démarré
    try { await deleteFromR2(inputKey); } catch { /* ignore */ }
    console.error("[transcription] RunPod submit failed:", err);
    return NextResponse.json({ error: `Échec soumission RunPod : ${String(err)}` }, { status: 502 });
  }

  await prisma.transcriptionJob.update({
    where: { id: job.id },
    data: { status: "PROCESSING", runpodJobId, outputJsonKey },
  });

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}

// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const url = new URL(req.url);
  const cursorParam = url.searchParams.get("cursor");

  const jobs = await prisma.transcriptionJob.findMany({
    where: { userId: userContext.effectiveUser.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    ...(cursorParam ? { cursor: { id: cursorParam }, skip: 1 } : {}),
    select: {
      id: true,
      status: true,
      inputFilename: true,
      model: true,
      language: true,
      languages: true,
      enableDiarization: true,
      hasDiarization: true,
      segmentCount: true,
      duration: true,
      createdAt: true,
      errorMsg: true,
    },
  });

  return NextResponse.json({ jobs });
}
