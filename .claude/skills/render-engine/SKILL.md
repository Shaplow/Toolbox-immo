---
name: render-engine
description: Investigate and fix render-engine, FFmpeg, RunPod, NVENC, R2, and template-video or captions pipeline issues. Use when a task involves runpod_worker.py, render.py, template_composite.py, encoding profiles, HDR to SDR tonemapping or washed-out colors, media uploads, RunPod webhook callbacks, or local versus RunPod parity.
---

# RunPod Render Ops

Use this skill when a task touches the Python render engine, serverless workers, FFmpeg command generation, encoding failures, webhook callbacks, or media job orchestration.

## Main Goal

Determine whether the problem is caused by:

- web-side job orchestration
- local FastAPI behavior
- RunPod worker behavior
- shared engine logic
- FFmpeg command generation or media probing
- R2 or output publication
- webhook callback handling
- infra-specific NVENC or GPU offer problems

## Recommended Workflow

1. Identify the entry path from the web app if the issue starts from a render request.
2. Inspect the worker and shared engine code early:
   - `render-engine/runpod_worker.py`
   - `render-engine/api.py`
   - `render-engine/engine/render.py`
   - `render-engine/engine/template_composite.py`
   - `render-engine/engine/probe.py`
   - `render-engine/engine/encoding_profiles.py`
3. Confirm whether the bug reproduces locally, only on RunPod, or only on a subset of GPU offers.
4. Preserve useful logs for FFmpeg stdout, stderr, chosen codec, bitrate, and fallback path.
5. Keep local and RunPod behavior aligned unless the divergence is clearly intentional.

## Job Completion: Polling vs Webhook

Two patterns coexist in this repo:

**Polling (template renders, captions, transcription):**
- Browser polls `GET /api/<module>/[id]` which calls `fetchRunpodStatus()` from `web/src/lib/runpod.ts`
- Status is updated in the Prisma job record on each poll

**Webhook (media-edit, and optionally others):**
- RunPod sends a POST to `/api/webhooks/runpod/<module>` on job completion
- Route verifies `X-Webhook-Secret` header via `verifyRunpodWebhook()` from `web/src/lib/webhooks/runpod.ts`
- Body is parsed via `parseRunpodWebhookBody<TOutput>()`
- Job record is updated directly, no browser polling needed

```
RunPod → POST /api/webhooks/runpod/media-edit      (media-edit)
RunPod → POST /api/webhooks/runpod/media-autocut   (batch autocut)
RunPod → POST /api/webhooks/runpod/captions        (captions)
RunPod → POST /api/webhooks/runpod/transcription   (transcription)
RunPod → POST /api/webhooks/runpod/derush-export   (derush export — legacy, kept for data continuity)
RunPod → POST /api/webhooks/runpod/renders         (template renders)
```

Webhook helper: `web/src/lib/webhooks/runpod.ts`
Webhook routes: `web/src/app/api/webhooks/runpod/`

When adding a new job type that uses webhooks: always call `verifyRunpodWebhook()` first,
then `parseRunpodWebhookBody<YourOutputType>()`. Never skip the auth check.
The webhook secret is `RUNPOD_WEBHOOK_SECRET` env var (check is skipped in dev if unset).

## HDR / Colorimetry — Hard Rule

Every FFmpeg command that produces **visual output** (video or image) from a user source must run
that source through `probe_video()` -> `is_hdr()` -> `hdr_to_sdr_prefilter()`. Every SDR-targeted
encode carries `bt709_output_flags()`, plain SDR sources included. **Never** on a `-c copy` path —
that would tag pixels which were never converted.

The three helpers live in `render-engine/engine/color.py` (`is_hdr` L45, `hdr_to_sdr_prefilter`
L98, `bt709_output_flags` L125). Never reimplement the detection elsewhere, and never in
TypeScript: a second definition of "what counts as HDR" is guaranteed drift.

### The silent fallback — the main trap

Without `zscale`/libzimg, `hdr_to_sdr_prefilter()` (`color.py:110`) returns a bare `format=yuv420p`:
a naive 10->8 bit conversion, **no tonemap**, behind a `logger.warning` nobody reads. The symptom is
washed-out colors with **no error at all**. Verified 2026-08-28:

| Runtime | `zscale` |
|---|---|
| `kodexfr/toolbox-render:v78` (VPS) | present |
| `Dockerfile.runpod` — BtbN GPL static build (L46) | present |
| Homebrew ffmpeg on macOS | **absent** |

So on a local Mac any HDR source renders washed out — that is the environment, not an app bug.
`runpod_worker.py:1924` logs this capability at boot; `api.py` does not.

### Check the deployed version first

The guard ships inside the render-engine image. Diagnose a color symptom in prod by confirming the
**deployed version** first (`render-engine/VERSION`, image tag), not by re-reading the code. That is
exactly what happened on cover packs in August: correct code, stale image. Note that `d2f0d44` — the
commit that introduced the guard — did not bump `VERSION`.

### Filter order: downscale before tonemapping

`cover_frames.py:236` puts `scale=...:force_original_aspect_ratio=decrease` at the head of the
chain. Tonemapping native 4K costs seconds per frame versus a fraction of a second once downscaled
(`c2c94cd`: 36 HLG 4K frames blew every timeout budget). `api.py:318` still does the reverse on the
poster path.

### Coverage

Covered, on both executors (`api.py` and `runpod_worker.py`):

- template composite and sequences — `template_composite.py:208`
- captions burn-in and preview — `render.py:100`, `render.py:328`
- media-edit, re-encode branch — `media_edit.py:146`
- cover frame extraction — `cover_frames.py:203`
- poster — `api.py:281`

Known gaps, audited 2026-08-28 and deliberately left as-is. They are accepted debt, not oversights —
do not "fix" them without asking:

| Gap | Why it stays |
|---|---|
| `web/.../backfill-posters/route.ts:61` — local ffmpeg, no HDR detection, tried *before* the protected render-engine fallback | one-shot admin route |
| `web/.../mediaAssets/captureVideoPoster.ts:73` — browser canvas capture, not color-managed | Chrome tonemaps for display |
| `api.py` has no boot `zscale` check (unlike the worker) | low value |
| `api.py:318` tonemaps before downscaling | single frame |
| `app.py:506` / `:538` hardcode `hdr_prefilter=None` | Gradio dev UI only |
| `render.py:279` `burn_overlay_video` takes no `hdr_prefilter` | dead code |

### Two non-issues — do not re-litigate

- **JPEG output range is fine.** The HDR chain ends in `format=yuv420p`, but FFmpeg negotiates
  `yuvj420p`/full-range at mjpeg encode time — verified identical for the HDR and SDR chains.
- **Trim-only keeps the HDR tags.** `media_edit.py:121` uses `-c copy`; the pixels are untouched, so
  the asset staying tagged HDR is truthful and correct.

## Known Pitfalls

- NVENC can appear available while still failing at runtime on specific RunPod pools.
- An HDR source (iPhone HLG/PQ) that skips the tonemap yields washed-out output with no error at all — see HDR / Colorimetry above, and check the deployed image version before the code.
- A worker-level fallback can mask the real failure if stdout and stderr are not retained.
- Template-video issues often belong in shared composite logic, not in duplicated local and RunPod wrappers.
- Storage bugs can look like render bugs if temp files, upload keys, or R2 public URLs are wrong.
- When a job uses webhooks, polling the RunPod status endpoint from the browser is redundant and can create race conditions with the webhook handler.

## Validation Checklist

- Run the narrowest local validation path available.
- If a full media render is too expensive or unavailable, validate FFmpeg command construction and explain the remaining risk.
- Say explicitly whether the change was validated locally only, RunPod only, or both.

## Output Expectations

When using this skill, report the failing stage and the exact command or transition that breaks. Distinguish app logic, FFmpeg logic, infra behavior, and webhook/polling completion path.