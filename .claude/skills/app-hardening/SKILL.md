---
name: app-hardening
description: Improve reliability, guardrails, and operational resilience across the Toolbox Immo monorepo. Use when a task involves validation, retries, error handling, job state transitions, configuration checks, stale state recovery, or making fragile flows safer without changing product scope.
---

# App Hardening

Use this skill when a feature already exists but behaves too optimistically, fails unclearly, or is too easy to break in production.

## Main Goal

Strengthen existing flows without turning the task into a rewrite.

## Good Targets

- weak input validation
- missing config checks
- silent fallbacks or swallowed exceptions
- inconsistent status transitions in Prisma-backed jobs
- retries, timeouts, abort handling, and stale-job recovery
- upload or background-job flows that can get stuck between steps
- optimistic UI that hides real failure states
- local versus RunPod behavior drift

## Recommended Workflow

1. Identify the exact failure mode and the stage where it appears.
2. Trace the full flow end-to-end:
   - request entry
   - validation
   - persistence
   - external service call
   - status update
   - final output publication
3. Harden the narrowest weak point first instead of layering generic retries everywhere.
4. Keep failure messages actionable for both the user and future debugging.
5. Preserve product behavior when possible; add guardrails before redesigning the flow.

## Repo-Specific Focus Areas

- Builder save, preview, and generate transitions in `web/src/components/builder/`
- Template render tracking in `web/src/lib/renderer/generateRender.ts` and `web/src/lib/renderer/renderWorkflow.ts`
- Captions and transcription jobs in `web/src/app/api/render/captions/` and `web/src/app/api/transcription/`
- RunPod submission and retry behavior in `web/src/lib/runpod.ts`
- Worker fallback and FFmpeg failure reporting in `render-engine/runpod_worker.py`

## Hardening Checklist

- Are required env vars checked before expensive work begins?
- Are transient failures retried only where retrying is safe?
- Are job states updated consistently on success, timeout, cancellation, and failure?
- Does the UI show a recoverable next step instead of a dead end?
- Are logs specific enough to identify the failing stage?

## Output Expectations

When using this skill, name the fragile stage, the concrete hardening change, and any remaining operational risks.