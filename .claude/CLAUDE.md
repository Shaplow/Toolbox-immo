# Toolbox Immo — Claude Code Context

Toolbox Immo is a monorepo that mixes a fairly complex Next.js product surface with a separate Python render engine.

- `web/` owns product logic, the template builder, HTML previews, auth, Prisma data, and most user-facing behavior.
- `render-engine/` owns FFmpeg, captions rendering, template video compositing, RunPod worker behavior, and R2-facing media jobs.

## Default Approach

1. Classify the request before editing:
   - builder or preview parity
   - general web app or Prisma behavior
   - captions, transcription, or file-upload workflow orchestration
   - description generation workflow (Claude/GPT, prompts, transcript/image inputs)
   - content library (MediaLibrary, MediaAsset, setTag, setSequence, AccountLibraryCursor, DataLibrary, selection rules, set_sequence rotation, generation pre-fill, asset editing, offer-based automation, MediaAutocutJob batch autocut)
   - admin, permissions, or impersonation
   - render-engine, FFmpeg, RunPod, storage pipeline, or webhook callbacks
   - UI and UX cleanup
2. Read `.github/copilot-instructions.md` for repo overview, then the relevant file-scoped instructions in `.github/instructions/`.
3. Use the matching skill in `.claude/skills/` when the task falls into a repeated workflow (these auto-load when their description matches).
4. Prefer the smallest fix that restores parity or behavior at the correct layer.

## Important Invariants

- Builder preview, HTML preview, and final rendered media are separate layers. Do not assume a visual bug belongs to the render engine before comparing those three stages.
- Captions and transcription are orchestrated through several web API routes and shared helpers rather than one dedicated coordinator module. Follow the full path before refactoring.
- Template video logic should stay aligned between local FastAPI and RunPod through the shared code in `render-engine/engine/template_composite.py` and related engine modules.
- RunPod NVENC failures are not always app bugs. Some GPU offers expose CUDA and even FFmpeg NVENC encoders while still failing runtime encode sessions.
- UX is currently uneven across the app. Improvements should reduce friction and inconsistency, not add another independent visual language.

## Git Discipline (READ THIS — parallel sessions live here)

The user often runs **multiple Claude Code sessions in parallel** on the same repo. The biggest historical pain points were file truncation, redundant edits across sessions, and merge conflicts. Follow these rules strictly.

### Before any edit — mandatory checks

1. **Run `git status` first.** If you see uncommitted changes to files you did NOT modify in this session, STOP and ask the user: another session may be in flight on those files. Do not "clean up" or overwrite them.
2. **Run `git log --oneline -5`** if you're unsure where you are. The user may have committed via another session since you last looked.
3. **Always `Read` before `Edit`.** Never trust your memory of file contents — another session may have changed them.
4. **Never `Write` over an existing file** unless you are doing a deliberate full rewrite that the user asked for. Use `Edit` for surgical changes. Writing a full file over an existing one is how "fichiers cut" happen.

### Branching & worktrees for parallel sessions

When the user signals they're working on multiple things at once, the safe pattern is one branch per concern, ideally one git worktree per session:

```bash
# create a worktree for a parallel session
git worktree add ../Toolbox-immo-<feature> -b feature/<feature>
# remove when done
git worktree remove ../Toolbox-immo-<feature>
```

- If two sessions are on the **same branch in the same working tree**, you WILL stomp on each other. Flag this to the user and recommend a worktree split before continuing.
- If sessions are on different branches in the same working tree, switching branches mid-session can lose uncommitted work — refuse to `git checkout` another branch if there are uncommitted changes.

### Committing rules

- **Only commit when the user explicitly asks.** Never auto-commit at the end of a task.
- **Prefer many small atomic commits** over one large one. Each commit should be reviewable in isolation.
- **Never `git commit --amend`** unless the user explicitly asks. Other sessions or the user may already have built on the previous commit.
- **Never use `--no-verify`** to skip hooks. If a hook fails, fix the underlying issue.
- Use HEREDOC for commit messages to preserve formatting (see Claude Code's built-in commit workflow).

### Destructive operations — never without explicit confirmation

The following commands can destroy work the user (or another parallel session) has not pushed yet. **Always confirm in chat before running**:

- `git push --force` / `git push -f` (never to `main`/`master` even with confirmation — warn loudly)
- `git reset --hard`
- `git checkout -- <file>` / `git restore <file>` (discards uncommitted changes)
- `git clean -fd`
- `git branch -D`
- `git worktree remove --force`
- `git rebase -i` (also: not supported, interactive)

### Merge conflicts

- If you encounter a merge conflict, **stop and report it** to the user. Don't try to auto-resolve unless the resolution is mechanical and obvious (e.g. both sides added the same import line).
- Never resolve a conflict by discarding one side's changes without confirming with the user — the "other side" might be the user's work from another session.

### Pulling & syncing

- Before starting work on a long-lived branch, run `git fetch origin && git status` to see if you're behind.
- Don't `git pull` automatically — let the user decide whether to merge or rebase. Default to `git pull --rebase` only when the user has set that as their config.

### Communication discipline

- Whenever you start a non-trivial task, **announce in one line** which files you're about to touch. This lets the user notice if another session is already on those files.
- Whenever you finish a task, **list the files you actually modified** so the user (or another session) can pick up cleanly.

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

### Database backups — mandatory before production migrations

**Rule: always run `npm run db:backup` immediately before any `npx prisma migrate deploy` on production.**

| Goal | Command |
|------|---------|
| Backup DB to timestamped SQL file | `cd web && npm run db:backup` |

- Reads `DATABASE_URL` from `.env.local` automatically (same dotenv-cli mechanism as `db:migrate`).
- Writes to `web/backups/<YYYY-MM-DD_HH-mm-ss>_<dbName>.sql`.
- Backups are **gitignored and local only** — never committed, never pushed.
- Rotation: keeps the 20 most recent `.sql` files; older ones are deleted automatically.
- If `pg_dump` is not installed: `brew install postgresql` (macOS) or `apt-get install -y postgresql-client` (Linux).
- Exit code is non-zero on any failure (missing `pg_dump`, bad credentials, etc.) — safe to use in scripts.

## Claude Code Agents (in `.claude/agents/`)

Invoke via the Task tool with `subagent_type: "<name>"`. All agents below are project-scoped and live in `.claude/agents/`.

- `toolbox-generalist` — default implementation agent for any code change in web/ or render-engine/
- `feature-planner` — interview-based phased plan with commit boundaries; use before significant features
- `db-migration-helper` — handles Prisma schema changes (the right subcommand cycle: edit → format → push/migrate → generate)
- `pr-summarizer` — reads branch diff vs main, produces a clean PR title + description (run before `gh pr create`)
- `code-reviewer` — read-only code review; produces a ranked report
- `bug-hunter` — read-only bug hunt in a specific module
- `security-auditor` — read-only OWASP paper audit on a surface
- `ux-auditor` — read-only UX walkthrough of a module
- `skill-manager` — maintenance of skills, agents, and CLAUDE.md (factual drift only)

Built-in Claude Code agents (also via Task tool):
- `Explore` — fast read-only search across the codebase; use when you need >3 lookups to map an area
- `Plan` — software architecture planning for a specific change
- `general-purpose` — fallback for open-ended research

## Claude Code Slash Commands (in `.claude/commands/`)

Invoke with `/<name>` in the chat:

- `/triage <description>` — get routing recommendation (which agent, which order)
- `/implement-feature <plan>` — hand a planner output to toolbox-generalist for phase-by-phase implementation
- `/review-feature <files>` — trigger code-reviewer on a file list
- `/hunt-bugs <module>` — trigger bug-hunter on a module
- `/security-audit <surface>` — trigger security-auditor on a specific surface

## Reference docs (read on demand)

Skills (`.claude/skills/<area>/SKILL.md`) — these auto-load when their description matches the current task; you don't need to load them manually:

- `template-builder/` — builder UI, preview parity, group layout, template normalization
- `render-engine/` — render engine, FFmpeg, RunPod, webhooks, R2
- `captions-transcription/` — captions and transcription orchestration
- `ass-rendering/` — ASS file generation: line spacing, shadows, glow, animation presets, libass quirks
- `ui-design/` — design tokens, component primitives, layout conventions
- `app-hardening/` — defensive coding patterns
- `security-review/` — OWASP-style audit playbook
- `admin-permissions/` — admin gating, impersonation, permission enforcement
- `content-library/` — MediaLibrary, MediaAsset, setTag, category, tags, setSequence, MediaAssetAccess, MediaAssetUsage, DataLibrary, DataCampaign, DataEntry, AccountLibraryCursor, builder bindings, selection rules (theme_sequence/oldest_used/least_used), generation pre-fill, recordLibraryUsage, offer-based automation, MediaAutocutJob batch autocut
- `asset-rotation/` — rotation algorithm internals: auto mode (group discovery, category exclusion, per-account ordering), override mode (cursor), pickFromGroup, per-account isolation via MediaAssetUsage, rotation simulation, common bugs
- `description-generation/` — DescriptionJob, DescriptionPrompt, Claude/GPT generation, transcript/image inputs, admin prompt management

File-scoped instructions (`.github/instructions/`):

- `web.instructions.md` — Next.js, Prisma, NextAuth, API route conventions
- `render-engine.instructions.md` — FastAPI, FFmpeg, worker, R2 conventions

Repo overview: `.github/copilot-instructions.md` (still load-on-demand; not Claude-Code-specific despite the name).

## Validation Rule

Always prefer targeted validation for the exact subsystem changed. If only manual or lint-level validation was possible, state that clearly instead of implying full confidence.
