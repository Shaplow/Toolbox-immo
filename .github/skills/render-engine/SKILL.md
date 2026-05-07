---
name: render-engine
description: Investigate and fix render-engine, FFmpeg, RunPod, NVENC, R2, and template-video or captions pipeline issues. Use when a task involves runpod_worker.py, render.py, template_composite.py, encoding profiles, media uploads, RunPod webhook callbacks, or local versus RunPod parity.
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

**Polling (template renders, captions, transcription, derush):**
- Browser polls `GET /api/<module>/[id]` which calls `fetchRunpodStatus()` from `web/src/lib/runpod.ts`
- Status is updated in the Prisma job record on each poll

**Webhook (media-edit, and optionally others):**
- RunPod sends a POST to `/api/webhooks/runpod/<module>` on job completion
- Route verifies `X-Webhook-Secret` header via `verifyRunpodWebhook()` from `web/src/lib/webhooks/runpod.ts`
- Body is parsed via `parseRunpodWebhookBody<TOutput>()`
- Job record is updated directly, no browser polling needed

```
RunPod → POST /api/webhooks/runpod/media-edit    (media-edit)
RunPod → POST /api/webhooks/runpod/captions       (captions)
RunPod → POST /api/webhooks/runpod/transcription  (transcription)
RunPod → POST /api/webhooks/runpod/derush         (derush)
```

Webhook helper: `web/src/lib/webhooks/runpod.ts`
Webhook routes: `web/src/app/api/webhooks/runpod/`

When adding a new job type that uses webhooks: always call `verifyRunpodWebhook()` first,
then `parseRunpodWebhookBody<YourOutputType>()`. Never skip the auth check.
The webhook secret is `RUNPOD_WEBHOOK_SECRET` env var (check is skipped in dev if unset).

## Known Pitfalls

- NVENC can appear available while still failing at runtime on specific RunPod pools.
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