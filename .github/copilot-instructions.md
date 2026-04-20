# Toolbox Immo Copilot Instructions

Toolbox Immo is a monorepo with two active application layers.

- `web/`: Next.js 16, React 19, Prisma, NextAuth, Puppeteer. This contains the product UI, the template builder, HTML preview/generation, admin, captions and transcription flows, and most business logic.
- `render-engine/`: FastAPI, FFmpeg, RunPod worker, Cloudflare R2 integration. This handles captions rendering and template video compositing.

## Work Strategy

- Prefer root-cause fixes in the correct layer instead of mirroring patches across web and render-engine.
- For template rendering bugs, explicitly determine which layer is wrong before editing code:
  - builder React preview
  - HTML preview generated in web
  - final video or image composite in render-engine
- For template-video work, keep local FastAPI and RunPod behavior aligned through the shared render-engine pipeline, especially `render-engine/engine/template_composite.py` and related FFmpeg builders.
- For RunPod failures, keep logging actionable. Do not hide FFmpeg or NVENC problems behind silent fallbacks.
- For UI and UX work, favor incremental cleanup, clearer hierarchy, and shared primitives over broad rewrites.

## Important Areas

- Builder UI: `web/src/components/builder/`
- Template render pipeline: `web/src/lib/renderer/`, `web/src/app/preview/`, `web/src/app/api/renders/`
- Captions and transcription orchestration: `web/src/app/api/render/captions/`, `web/src/app/api/transcription/`, `web/src/lib/captionsEngine.ts`, `web/src/lib/runpod.ts`
- Derush module: `web/src/app/api/derush/`, `web/src/lib/derushProcess.ts`, `web/src/types/derush.ts`, `web/src/components/derush/`, `render-engine/engine/derush/`
- Description generation: `web/src/app/api/description/`, `web/src/components/description/DescriptionTool.tsx`
- Admin and permissions: `web/src/app/api/admin/`, `web/src/lib/userContext.ts`, `web/src/lib/permissions.ts`
- Template normalization and layout: `web/src/lib/templateNormalization.ts`, `web/src/lib/groupLayout.ts`, `web/src/lib/templateConditions.ts`
- Auth and data model: `web/src/lib/auth.ts`, `web/prisma/schema.prisma`
- RunPod worker and FFmpeg entry points: `render-engine/runpod_worker.py`, `render-engine/api.py`, `render-engine/engine/render.py`, `render-engine/engine/template_composite.py`, `render-engine/engine/probe.py`

## Validation Expectations

- Root helpers:
  - `npm run install:web`
  - `npm run dev`
- Web targeted validation:
  - `cd web && npm run lint -- path/to/file.tsx`
  - run `cd web && npm run build` when changes affect routing, config, production runtime behavior, or API integration boundaries.
- Prisma changes:
  - `cd web && npm run db:generate`
  - `cd web && npm run db:push` or `cd web && npm run db:migrate` as appropriate.
- Render engine validation should follow `render-engine/README.md` and stay targeted to the modified workflow.
- No obvious automated test suite is currently present. If validation is limited to lint, local commands, or manual checks, say so explicitly.

## Known Pitfalls

- Builder preview, hidden measurement layer, HTML preview, and final FFmpeg composite are not the same system. Confirm parity before expanding scope.
- Builder text and auto-layout bugs are often tied to font loading, measurement invalidation, or HTML preview parity rather than render-engine code.
- Captions and transcription flows do not currently have one single orchestration module. Template renders are relatively centralized in `web/src/lib/renderer/`, but captions/transcription logic is split across Next.js API routes, Prisma jobs, `web/src/lib/runpod.ts`, and render-engine endpoints.
- RunPod NVENC behavior can fail on some GPU pools even when CUDA and FFmpeg encoders appear present. Treat infra and offer selection as part of the diagnosis.

## Instruction Files

- Apply the repo-wide guidance here first.
- Then read the matching path-specific instructions in `.github/instructions/` before editing files in `web/` or `render-engine/`.
- Load the skills in `.github/skills/` when the task is clearly about builder debugging, RunPod/render triage, captions/transcription pipelines, ASS subtitle rendering, UI and UX remediation, app hardening, security review, admin/permissions changes, derush workflow, or the Content Library system (MediaLibrary, MediaAsset, DataLibrary, DataCampaign, DataEntry, library bindings, selection rules, generation pre-fill).