---
name: derush
description: Diagnose and implement changes in the derush (video rushes analysis and export) module. Use when a task touches DerushJob, DerushExport, DerushFormat, segment scoring, segment overrides, analysis modes (vision/transcription), export pipeline, or the render-engine derush orchestrator.
---

# Derush

Use this skill when the task involves the derush video analysis module: job creation, analysis submission to RunPod, segment display and overrides, export generation, or format management.

## Architecture Overview

The derush module combines two analysis modes and a multi-step export pipeline. Like captions/transcription, **there is no single orchestration module** — the flow is stitched across several API routes, shared helpers, and the render-engine worker.

### Analysis Flow

```
Browser
  → POST /api/derush
      → auth + permissions (TOOLS.DERUSH)
      → R2 configured check
      → createPresignedUploadUrl() per video file  (+ optional SRT/JSON for transcription mode)
      → DerushJob created (status: QUEUED, analysisMode, presetId, inputFiles JSON)
      → 202 { jobId, uploadUrls, transcriptionUploadUrl? }

Browser uploads video files directly to R2 via presigned PUT URLs

Browser
  → POST /api/derush/[id]/submit
      → ownership + QUEUED status check
      → builds RunPod payload (job_type: "derush_vision")
          input: video_urls[], video_r2_keys[], video_filenames[],
                 analysis_mode, preset_config?, transcription_output_url?,
                 scoring_weights?, reject_thresholds?, vision_provider?,
                 output_json_key
      → DerushJob updated to PROCESSING + runpodJobId

Browser polls
  → GET /api/derush/[id]
      → returns job status + metadata

On COMPLETED
  → GET /api/derush/[id]/result
      → fetches outputJsonKey from R2 (segments JSON)
      → applies segmentOverrides + segmentTextOverrides from DB
      → returns processed DerushSegment[]
```

**RunPod worker** (`runpod_worker.py`): handles `job_type: "derush_vision"` → `_handle_derush_vision()` → `DerushOrchestrator.run()`.

Analysis modes:
- `"vision"` — `pipeline_vision.py` runs frame analysis via a provider (heuristic, gemini, openai, claude)
- `"transcription"` — `pipeline_transcription.py` uses uploaded SRT/JSON or a reused `TranscriptionJob` output

### Export Flow

```
Browser
  → POST /api/derush/[id]/export
      → DerushExport created (status: PENDING or DONE for server-side formats)
      → Server-side formats (manifest JSON, FCPXML): generated immediately via generateXmlTimeline() / buildManifest()
      → Worker-side formats (video concat): sets status QUEUED

Browser (for worker-side exports)
  → POST /api/derush/[id]/export/[eid]/submit
      → submits RunPod job_type: "derush_export"
      → DerushExport updated to PROCESSING

Browser polls
  → GET /api/derush/[id]/export/[eid]
  → GET /api/derush/[id]/export/[eid]/download  (download result)
```

### Segment Overrides

The UI lets users accept/reject individual segments without re-running analysis:

```
Browser
  → PATCH /api/derush/[id]/segments
      → updates segmentOverrides (Record<segmentId, "accept"|"reject">)
      → updates segmentTextOverrides (Record<segmentId, text>)
      → stored on DerushJob as JSON strings
```

Overrides are applied at `/api/derush/[id]/result` read time, not stored in the R2 output.

## Key Files

| Layer | File | Role |
|---|---|---|
| Web API | `web/src/app/api/derush/route.ts` | Create job + presigned URLs / list jobs |
| Web API | `web/src/app/api/derush/[id]/route.ts` | Get job status |
| Web API | `web/src/app/api/derush/[id]/submit/route.ts` | Submit job to RunPod |
| Web API | `web/src/app/api/derush/[id]/result/route.ts` | Fetch + overlay segments with overrides |
| Web API | `web/src/app/api/derush/[id]/segments/route.ts` | Apply segment accept/reject overrides |
| Web API | `web/src/app/api/derush/[id]/export/route.ts` | Create export |
| Web API | `web/src/app/api/derush/[id]/export/[eid]/submit/route.ts` | Submit export to RunPod |
| Web API | `web/src/app/api/derush/[id]/export/[eid]/download/route.ts` | Download export result |
| Web API | `web/src/app/api/derush/formats/route.ts` | Manage export formats |
| Lib | `web/src/lib/derushProcess.ts` | `buildManifest()`, `generateXmlTimeline()`, `scoreSummary()`, `applyPresetDefaults()`, `formatTimecode()` |
| Types | `web/src/types/derush.ts` | `DerushSegment`, `DerushManifest`, `DerushJobCreatePayload`, etc. |
| Components | `web/src/components/derush/DerushDetail.tsx` | Analysis result UI, segment review |
| Components | `web/src/components/derush/DerushList.tsx` | Job list UI |
| Components | `web/src/components/derush/DerushFormatManager.tsx` | Export format management |
| Worker | `render-engine/runpod_worker.py` | `_handle_derush_vision()`, `_handle_derush_export()` |
| Worker | `render-engine/engine/derush/orchestrator.py` | `DerushOrchestrator.run()` |
| Worker | `render-engine/engine/derush/pipeline_transcription.py` | Transcription-mode pipeline |
| Worker | `render-engine/engine/derush/pipeline_vision.py` | Vision-mode pipeline |
| Worker | `render-engine/engine/derush/scoring_engine.py` | Segment scoring logic |
| Worker | `render-engine/engine/derush/models.py` | `DerushJobInput` and related models |

## Job Status Lifecycle

**DerushJob**: `QUEUED` → `PROCESSING` → `COMPLETED` / `FAILED`

**DerushExport**: `PENDING` (being generated) → `DONE` (server-side) / `QUEUED` → `PROCESSING` → `COMPLETED` / `FAILED` (worker-side)

## Common Failure Modes

| Symptom | Where to look |
|---|---|
| Job stuck in PROCESSING | RunPod job may have timed out; check `runpodJobId` against RunPod dashboard |
| Segments not loading | `outputJsonKey` missing or R2 fetch failed; check `/result` route logs |
| Overrides not applied | `segmentOverrides` JSON may be malformed; check PATCH `/segments` route |
| Export type QUEUED but never submitted | Browser may have failed to call `/export/[eid]/submit` after creation |
| Vision pipeline failing | `visionProvider` env var or API key may be missing; check worker logs |
| Transcription reuse failing | `transcriptionJobId` may point to an incomplete job; verify `outputJsonKey` on the `TranscriptionJob` |

## Recommended Workflow

1. Identify whether the bug is in the web orchestration layer or the worker analysis layer.
2. Check the `DerushJob` Prisma record: `status`, `runpodJobId`, `outputJsonKey`, `errorMsg`.
3. For analysis bugs: inspect the relevant pipeline (`pipeline_vision.py` or `pipeline_transcription.py`) and `scoring_engine.py`.
4. For export bugs: determine if the format is server-side (immediate) or worker-side (async), and trace accordingly.
5. For segment display bugs: verify overrides are applied at result read time and not persisted to R2.

## Output Expectations

When using this skill, state which stage failed (job creation, upload, RunPod submission, result fetch, override application, or export), whether it is web-side or worker-side, and which specific file and status field needs to change.
