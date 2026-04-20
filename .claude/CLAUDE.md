# Toolbox Immo Claude Context

Toolbox Immo is a monorepo that mixes a fairly complex Next.js product surface with a separate Python render engine.

- `web/` owns product logic, the template builder, HTML previews, auth, Prisma data, and most user-facing behavior.
- `render-engine/` owns FFmpeg, captions rendering, template video compositing, RunPod worker behavior, and R2-facing media jobs.

## Default Approach

1. Classify the request before editing:
   - builder or preview parity
   - general web app or Prisma behavior
   - captions, transcription, or file-upload workflow orchestration
   - derush workflow (analysis, scoring, segment overrides, export)
   - description generation workflow
   - admin, permissions, or impersonation
   - render-engine, FFmpeg, RunPod, or storage pipeline
   - UI and UX cleanup
2. Read `.github/copilot-instructions.md` first, then the relevant file-scoped instructions in `.github/instructions/`.
3. Use the matching skill in `.github/skills/` when the task falls into a repeated workflow.
4. Prefer the smallest fix that restores parity or behavior at the correct layer.

## Important Invariants

- Builder preview, HTML preview, and final rendered media are separate layers. Do not assume a visual bug belongs to the render engine before comparing those three stages.
- Captions and transcription are orchestrated through several web API routes and shared helpers rather than one dedicated coordinator module. Follow the full path before refactoring.
- Template video logic should stay aligned between local FastAPI and RunPod through the shared code in `render-engine/engine/template_composite.py` and related engine modules.
- RunPod NVENC failures are not always app bugs. Some GPU offers expose CUDA and even FFmpeg NVENC encoders while still failing runtime encode sessions.
- UX is currently uneven across the app. Improvements should reduce friction and inconsistency, not add another independent visual language.

## Commands Worth Remembering

- Root: `npm run dev`, `npm run build`, `npm run install:web`
- Web: `cd web && npm run lint -- path/to/file.tsx`
- Render engine local entry points are documented in `render-engine/README.md`

## Skills Available In Repo

- `.github/skills/template-builder-debug/`
- `.github/skills/runpod-render-ops/`
- `.github/skills/captions-transcription/`
- `.github/skills/ass-rendering/` — ASS file generation: line spacing, shadows, glow, animation presets, libass quirks
- `.github/skills/ui-ux-remediation/`
- `.github/skills/app-hardening/`
- `.github/skills/security-review/`
- `.github/skills/admin-permissions/`
- `.github/skills/derush/`
- `.github/skills/content-library/` — MediaLibrary, MediaAsset, DataLibrary, DataCampaign, DataEntry, builder bindings, selection rules, generation pre-fill, usage tracking

## Agents Available In Repo

- `.github/agents/toolbox-generalist.agent.md` — default implementation agent
- `.github/agents/skill-manager.agent.md` — maintains skills, agents, and repo docs

## Validation Rule

Always prefer targeted validation for the exact subsystem changed. If only manual or lint-level validation was possible, state that clearly instead of implying full confidence.