---
name: runpod-render-ops
description: Investigate and fix render-engine, FFmpeg, RunPod, NVENC, R2, and template-video or captions pipeline issues. Use when a task involves runpod_worker.py, render.py, template_composite.py, encoding profiles, media uploads, or local versus RunPod parity.
---

# RunPod Render Ops

Use this skill when a task touches the Python render engine, serverless workers, FFmpeg command generation, encoding failures, or media job orchestration.

## Main Goal

Determine whether the problem is caused by:

- web-side job orchestration
- local FastAPI behavior
- RunPod worker behavior
- shared engine logic
- FFmpeg command generation or media probing
- R2 or output publication
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

## Known Pitfalls

- NVENC can appear available while still failing at runtime on specific RunPod pools.
- A worker-level fallback can mask the real failure if stdout and stderr are not retained.
- Template-video issues often belong in shared composite logic, not in duplicated local and RunPod wrappers.
- Storage bugs can look like render bugs if temp files, upload keys, or R2 public URLs are wrong.

## Validation Checklist

- Run the narrowest local validation path available.
- If a full media render is too expensive or unavailable, validate FFmpeg command construction and explain the remaining risk.
- Say explicitly whether the change was validated locally only, RunPod only, or both.

## Output Expectations

When using this skill, report the failing stage and the exact command or transition that breaks. Distinguish app logic, FFmpeg logic, and infra behavior.