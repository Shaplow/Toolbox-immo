---
name: captions-transcription
description: Diagnose and fix captions rendering and transcription orchestration flows in Toolbox Immo. Use when a task touches CaptionJob, TranscriptionJob, captionsEngine.ts, RunPod submission from the web app, R2 storage, presigned upload URLs, diarization, or captions config normalization.
---

# Captions & Transcription

Use this skill when the task involves the captions rendering pipeline, the transcription pipeline, or the shared infrastructure (RunPod submission, R2 storage, Prisma job states) that both share.

## Primary Data Format: JSON word-level timestamps

> **The canonical captions input is JSON word-timestamp data, not SRT.**
>
> JSON gives per-word `start`/`end` times with highlight markers, enabling word-by-word animation (appear/reveal/word_pop) with accurate timing, `_compute_step_pairs` compression, and phrase-aware grouping via `buildSubtitlesFromWords()`.
>
> SRT is a **legacy / fallback** path for when only a plain subtitle file is available (user uploads a `.srt`, external source, no per-word timing). Prefer JSON in all new flows. Do not add SRT-only optimizations unless they explicitly target the fallback path.

### JSON path (primary)

- `CaptionsGenerateForm.tsx` receives `initialSegments: Segment[]` from the transcription result.
- `buildSubtitlesFromWords(segments)` (`web/src/lib/transcriptionProcess.ts`) groups words into display segments using pause/punctuation/duration/determiner heuristics. **Edit this function** when phrase grouping is wrong.
- Segments feed `buildTimedSegmentsFromSegments()` → `buildWordTimestampsForSubmission()` → serialized as JSON sent to `/api/render/captions`.
- Word highlights are stored as `Map<"segIdx-wordIdx", group>` and serialized alongside.

### SRT path (legacy / fallback)

- Used when no word-level data is available (`.srt` upload, external source).
- `parseHighlightedSRT(raw)` → `mergeSentenceCaptions()` merges adjacent blocks where the previous does not end a sentence and gap ≤ 0.6s, compensating for Whisper mid-sentence line breaks.
- Words get **uniformly distributed timestamps** — animation quality is lower than JSON path.
- Do not invest in SRT-path improvements unless JSON path is genuinely unavailable.

## Architecture Overview

There is **no single orchestration module**. Both flows are stitched together across multiple Next.js API routes, shared helpers, and the render-engine worker.

### Captions Flow

```
Browser
  → POST /api/render/captions          (multipart: video + subtitles + config)
      → auth + permissions (TOOLS.CAPTIONS)
      → normalizeCaptionConfig()         captionsEngine.ts
      → attachCaptionFontAssets()        (resolves font_assets from DB)
      → CaptionJob created in Prisma (status: PROCESSING)
      → Mode RunPod:
          uploadToR2(video)              → R2 input key
          uploadToR2(subtitles as SRT)
          submitRunpodJob()              runpod.ts → RunPod /v2/{endpoint}/run
      → Mode local (USE_RUNPOD=false):
          forward to render-engine /api/render  (direct HTTP, 20 min timeout)
          CaptionJob updated to DONE/FAILED
  → 202 { captionJobId, runpodJobId? }

Browser polls
  → GET /api/render/captions/[id]
      → auth + ownership check
      → if PROCESSING + runpodJobId: fetchRunpodStatus()
          → COMPLETED: update CaptionJob outputUrl from R2 output_key
          → FAILED/CANCELLED/TIMED_OUT: mark FAILED
      → if DONE (local mode): return directly
      → returns { status, videoUrl?, srtContent?, presetId? }
```

**RunPod worker** (`runpod_worker.py`): handles `job_type: "caption"` jobs. Expects `video_url`, `srt_content` (JSON word-timestamp array or SRT string — JSON is preferred), `config`, `preview_mode`, `output_key`.

### Transcription Flow

```
Browser (RunPod mode — standard path, outil /transcriptions organisé en LOTS)
  → POST /api/transcription (JSON: filename, ext, size, language|languages,
                             enable_diarization, slotId?, batchId?)
      → auth + permissions (TOOLS.TRANSCRIPTION)
      → batchId = UUID généré par le navigateur au dépôt (un dépôt = un lot)
      → clés R2 uniques transcription/{userId}/{ts}-{rand}/…
      → ≤ 100 Mo : presigned PUT (1h) + `contentType` signé, à renvoyer tel quel
        > 100 Mo : multipart (partUrls)
      → TranscriptionJob QUEUED (uploadedAt null) → 202 { jobId, uploadUrl, contentType } | { jobId, multipart }

Browser uploads (file d'upload de module, 3 fichiers en parallèle, prepare au
moment de l'upload — components/transcription/useTranscriptionUploads.ts)
  → POST /api/transcription/[id]/upload-complete   ({uploadId, parts} ou {} pour un PUT unique)
      → finalise le multipart OU vérifie par HEAD → pose `uploadedAt` (idempotent)
      (mode local : PUT /upload-local pose uploadedAt lui-même)

Lancement (toujours manuel)
  → POST /api/transcription/[id]/submit                 (une vidéo)
  → POST /api/transcription/batches/[batchId]/launch     (QUEUED + uploadedAt du lot)
      → claimTranscriptionForSubmit (lib/services/transcription/submitTranscription.ts) :
        vérifications AVANT toute écriture (source absente + uploadedAt null →
        409 UPLOAD_PENDING, job intact), claim atomique QUEUED→PROCESSING, relecture
      → dispatchTranscription en fond (lot : serverlessOnly, 4 envois simultanés)
        → runpodJobId écrit gardé ; échec → applyTranscriptionOutcome(failed)

Issue du job (webhook OU polling GET /api/transcription/[id])
  → applyTranscriptionOutcome (lib/services/transcription/applyOutcome.ts) :
    transition gardée sur le statut (le premier chemin gagne), releaseJobSource
    (gardes pipeline auto), SSE, traduction auto, captions/description auto

Jobs immobiles sans runpodJobId (GET [id] + sweep admin)
  → lib/transcription/staleRules.ts + lib/services/transcription/expireStale.ts
    upload non confirmé 15 min (sweep 10) → HEAD : présent = guéri, absent = FAILED
    vidéo PRÊTE (uploadedAt) → n'expire qu'après 7 j
    PROCESSING sans runpodJobId 30 min → standalone uploadé : remis QUEUED ; auto : FAILED

Téléchargements
  → GET /api/transcription/[id]/download?format=srt|json|chunks   (SRT en 1 clic par ligne)
  → GET /api/transcription/batches/[batchId]/download?format=srt|json   (ZIP du lot,
    noms dédoublonnés « nom (2).srt », ERREURS.txt + X-Transcription-Errors)
  Chargeur unique de segments : lib/transcription/segments.ts (local/, R2, segmentsJson)
```

Vue de la page : `GET /api/transcription/batches?cursor=` (service `listTranscriptionWorkspace` :
100 jobs + tous les actifs + lots complétés). `GET /api/transcription?status=COMPLETED` sert
les sélecteurs Captions / Description / Brief. DELETE d'un upload jamais confirmé SUPPRIME la ligne.

**Local/compat path**: `POST /api/transcription` with multipart form → forwards directly to render-engine `/api/transcribe` (1h timeout). No presigned URL step.

### Shared Infrastructure

- **`web/src/lib/runpod.ts`**: `submitRunpodJob()` — retry logic for transient 429/502/503/504 errors (4 retries with backoff: 2s, 5s, 10s, 20s). Always use this, never fetch RunPod directly.
- **`web/src/lib/captionsEngine.ts`**: `normalizeCaptionConfig()`. Always forces `engine: "ass"` — any other value is silently overwritten. The function is a 3-line thin normalizer; `inferCaptionsEngine` no longer exists. There is no Cairo or `line_height_mode` logic in this file. `line_height_mode` is still a live field in the render-engine `LayoutConfig` and `api.py`; it just does not appear in the web normalizer.

> **Cairo dead code (render-engine only)**: `render-engine/engine/cairo_renderer.py`, the Cairo branches in `render-engine/app.py` (lines importing `burn_subtitles_cairo` / `render_preview_frame_cairo`), and the `CairoRendererNotReadyError` import in `render-engine/api.py` are unreachable vestiges of an experiment. `_resolve_captions_engine()` in `app.py` always returns `"ass"` regardless of input, making those branches dead. `runpod_worker.py` has zero Cairo references. If you encounter Cairo code in the render-engine, treat it as dead code — it will never run from any current entry point.
- **R2**: used for video source (captions), audio source (transcription, deleted after completion), output video/JSON, and overlay PNGs.
- **Prisma models**: `CaptionJob`, `TranscriptionJob` — both have `userId`, `status`, `runpodJobId`, `inputKey`, `outputKey/outputUrl`.

### render-engine Side

- `runpod_worker.py`: handles `job_type: "caption"` and `job_type: "transcribe"`.
- `api.py`: handles local mode (`/api/render` for captions, `/api/transcribe` for transcription).
- NVENC is attempted first; NVENC failures are logged explicitly and surfaced (not silently swallowed).

## Common Failure Modes

| Symptom | Where to look |
|---|---|
| Job stuck in PROCESSING | RunPod job may have failed but status poll wasn't called / RunPod env vars missing |
| Missing output video | `output_key` vs `video_url` mismatch in RunPod response; check `getR2PublicUrl(outputKey)` |
| Audio source not cleaned up after COMPLETED | `releaseJobSource` (via applyTranscriptionOutcome) is best-effort on R2 and skips auto-pipeline jobs by design |
| Presigned upload URL error | R2 not configured or `createPresignedUploadUrl()` threw; check R2 env vars |
| Diarization not working | `HF_TOKEN` env var may be missing; check `enable_diarization` flag in payload |
| Font not applied in captions | `attachCaptionFontAssets()` returned empty (font not in DB or `isCaptionCompatibleFontAsset()` returned false) |
| `USE_RUNPOD=false` job not completing | Local render-engine must be running; check `CAPTIONS_API_URL` and `http://localhost:8000` connectivity |
| Job created but never submitted (QUEUED forever) | Normal pour une vidéo prête d'un lot (lancement manuel) ; `uploadedAt` null = upload jamais confirmé (cf. staleRules) |
| « Lancer » renvoie 409 UPLOAD_PENDING | Upload encore en cours ou jamais arrivé : le job reste QUEUED (plus de FAILED destructeur) |

## Key Files

| Layer | File | Role |
|---|---|---|
| Web API | `web/src/app/api/render/captions/route.ts` | Start captions job |
| Web API | `web/src/app/api/render/captions/[id]/route.ts` | Poll captions status |
| Web API | `web/src/app/api/transcription/route.ts` | Start transcription (QUEUED + presigned URL) |
| Web API | `web/src/app/api/transcription/[id]/submit/route.ts` | Submit QUEUED job to RunPod |
| Web API | `web/src/app/api/transcription/[id]/route.ts` | Poll transcription status |
| Web API | `web/src/app/api/transcription/[id]/download/route.ts` | Download SRT / JSON / chunks |
| Web API | `web/src/app/api/transcription/batches/**` | Lots : vue, intervenants du lot, lancement, ZIP |
| Service | `web/src/lib/services/transcription/` | submit (claim + dispatch), applyOutcome, expireStale, workspace |
| Lib | `web/src/lib/captionsEngine.ts` | Config normalization |
| Lib | `web/src/lib/transcriptionProcess.ts` | **Primary**: `buildSubtitlesFromWords()` — phrase grouping from JSON word data |
| Lib | `web/src/lib/captionWordTiming.ts` | `buildTimedSegmentsFromSegments()`, `buildWordTimestampsForSubmission()` |
| Lib | `web/src/lib/srt.ts` | **Fallback**: `parseSRT()`, `mergeSentenceCaptions()`, `parseHighlightedSRT()` |
| Lib | `web/src/lib/runpod.ts` | Shared RunPod submission with retries |
| Lib | `web/src/lib/r2.ts` | R2 upload/download/presigned URL |
| Lib | `web/src/lib/permissions.ts` | `TOOLS.CAPTIONS`, `TOOLS.TRANSCRIPTION` permission checks |
| Worker | `render-engine/runpod_worker.py` | RunPod worker entry point |
| Worker | `render-engine/api.py` | Local mode FastAPI endpoints |
| Worker | `render-engine/engine/transcribe.py` | Whisper transcription logic |
| Worker | `render-engine/engine/ass_writer.py` | ASS subtitle generation + `_compute_step_pairs` timing |

## Job Status Lifecycle

**CaptionJob**: `PROCESSING` → `COMPLETED` / `FAILED` / `DONE` (local mode only)

**TranscriptionJob**: `QUEUED` → `PROCESSING` → `COMPLETED` / `FAILED`

Important: `QUEUED` exists only for transcription (browser direct upload pattern). Captions jobs go straight to `PROCESSING`.

## Recommended Workflow

1. Identify whether the bug is in captions or transcription.
2. Determine the mode: RunPod or local (`USE_RUNPOD` env var).
3. Trace the full path: job creation → upload → RunPod submission → status poll → output delivery.
4. Check the Prisma job record first — `status`, `runpodJobId`, `outputKey`, `errorMsg` tell you exactly where the flow stopped.
5. If the RunPod job exists, check its status via `GET /v2/{endpoint}/status/{runpodJobId}` or the RunPod dashboard.
6. For local mode failures, check render-engine logs and confirm the service is reachable at `CAPTIONS_API_URL`.

## Output Expectations

When using this skill, identify which stage of the pipeline failed, whether it's a web-side or worker-side issue, and name the specific file and status field that needs to change.
