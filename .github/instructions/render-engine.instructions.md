---
applyTo: "render-engine/**/*.py,render-engine/Dockerfile,render-engine/Dockerfile.runpod,render-engine/requirements*.txt"
---

# Render Engine Instructions

- The render engine has two operational modes: local FastAPI and RunPod serverless. Keep their behavior aligned whenever possible.
- Prefer shared logic in `render-engine/engine/` over duplicating behavior in `api.py` and `runpod_worker.py`.
- For template video work, inspect `render-engine/engine/template_composite.py`, `render-engine/engine/render.py`, `render-engine/engine/probe.py`, and the corresponding web trigger path before changing FFmpeg command construction.
- For captions work, inspect engine selection, font handling, and encoding profiles before changing the worker entry point.
- Do not swallow subprocess failures. When adding or changing FFmpeg behavior, keep enough stdout and stderr context to debug production failures.
- RunPod and NVENC issues are not always code issues. Some GPU pools fail runtime NVENC even if probes partially succeed. Preserve logs that help distinguish pool problems from regressions in command generation.
- Keep storage assumptions explicit. If a flow depends on R2 upload, public URL generation, or temp file lifecycle, document that in code or logs rather than relying on implicit behavior.
- Validate render-engine changes with the narrowest realistic command or local run path available. If full media validation was not run, state that clearly.