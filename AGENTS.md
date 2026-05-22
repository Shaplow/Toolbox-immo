# Toolbox Immo Codex Context

Toolbox Immo is a monorepo that mixes a fairly complex Next.js product surface with a separate Python render engine.

- `web/` owns product logic, the template builder, HTML previews, auth, Prisma data, and most user-facing behavior.
- `render-engine/` owns FFmpeg, captions rendering, template video compositing, RunPod worker behavior, and R2-facing media jobs.

## Default Approach

1. Classify the request before editing:
   - builder or preview parity
   - general web app or Prisma behavior
   - captions, transcription, or file-upload workflow orchestration
   - description generation workflow (Codex/GPT, prompts, transcript/image inputs)
   - content library (MediaLibrary, MediaAsset, setTag, setSequence, AccountLibraryCursor, DataLibrary, selection rules, set_sequence rotation, generation pre-fill, asset editing, offer-based automation, MediaAutocutJob batch autocut)
   - admin, permissions, or impersonation
   - render-engine, FFmpeg, RunPod, storage pipeline, or webhook callbacks
   - UI and UX cleanup
2. Read `.github/copilot-instructions.md` first, then the relevant file-scoped instructions in `.github/instructions/`.
3. Use the matching skill in `.claude/skills/` when the task falls into a repeated workflow.
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

### Prisma — required subcommands (agents often get this wrong)

| Goal | Command |
|------|---------|
| Regenerate Prisma client | `cd web && npm run db:generate` |
| Create + apply migration (local, interactive) | `cd web && npm run db:migrate` |
| Apply existing migrations without prompts (CI/agents) | `cd web && npx prisma migrate deploy` |
| Check pending migrations | `cd web && npx prisma migrate status` |
| Push schema without migration file (prototyping) | `cd web && npm run db:push` |

- `prisma migrate` alone is **not a valid command** — always add a subcommand.
- For agent automation, prefer `migrate deploy` (non-interactive) over `migrate dev`.
- `npm run db:migrate` reads `.env.local` automatically via `dotenv`.

## Skills Available In Repo

- `.claude/skills/template-builder/`
- `.claude/skills/render-engine/` — render engine, FFmpeg, RunPod, webhooks, R2
- `.claude/skills/captions-transcription/`
- `.claude/skills/ass-rendering/` — ASS file generation: line spacing, shadows, glow, animation presets, libass quirks
- `.claude/skills/ui-design/`
- `.claude/skills/app-hardening/`
- `.claude/skills/security-review/`
- `.claude/skills/admin-permissions/`
- `.claude/skills/content-library/` — MediaLibrary, MediaAsset (setTag, category, tags, setSequence), MediaAssetAccess, MediaAssetUsage, DataLibrary, DataCampaign, DataEntry, AccountLibraryCursor, builder bindings, selection rules (theme_sequence/oldest_used/least_used), generation pre-fill, recordLibraryUsage, offer-based automation, MediaAutocutJob batch autocut
- `.claude/skills/asset-rotation/` — rotation algorithm internals: auto mode (group discovery, category exclusion, per-account ordering), override mode (cursor), pickFromGroup, per-account isolation via MediaAssetUsage, rotation simulation, common bugs, extending to DataEntry
- `.claude/skills/description-generation/` — DescriptionJob, DescriptionPrompt, Codex/GPT generation, transcript/image inputs, admin prompt management

## Agents Available In Repo

Active agents live in `.claude/agents/` (Claude Code format). Legacy Copilot copies exist in `.github/agents/`.

- `toolbox-generalist` — default implementation agent for any code change
- `feature-planner` — interviews for product vision, produces a phased plan with commit boundaries and agent handoff
- `db-migration-helper` — handles Prisma schema changes (correct subcommand cycle)
- `pr-summarizer` — reads branch diff vs main, produces clean PR title + description
- `skill-manager` — maintains skills, agents, and repo docs
- `code-reviewer` — reviews code for quality, conventions, regression risk; report only
- `security-auditor` — OWASP paper audit; threat report only
- `bug-hunter` — hunts bugs, edge cases, integration failures in a module; report only
- `ux-auditor` — walks through a module as a user; friction report only

## Slash Commands

Active commands live in `.claude/commands/` (Claude Code). Legacy Copilot copies in `.github/prompts/`.

- `/implement-feature` — feed a planner output into toolbox-generalist
- `/review-feature` — trigger code-reviewer on a list of modified files
- `/hunt-bugs` — trigger bug-hunter on a specific module
- `/security-audit` — trigger security-auditor on a specific surface
- `/triage` — describe your task and get a routing recommendation

## Validation Rule

Always prefer targeted validation for the exact subsystem changed. If only manual or lint-level validation was possible, state that clearly instead of implying full confidence.