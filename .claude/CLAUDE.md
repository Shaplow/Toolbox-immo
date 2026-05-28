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
   - content library (MediaLibrary, MediaAsset, setTag, setSequence, AccountLibraryCursor, DataLibrary, selection rules, set_sequence rotation, generation pre-fill, asset editing, MediaAutocutJob batch autocut)
   - admin, permissions, or impersonation (ADMIN/MONTEUR/CM/USER roles — see Phase 1.x conventions)
   - **publication pipeline** (PublicationSlot, AccountPattern, fiche `/publications/[id]`, worklists per role)
   - render-engine, FFmpeg, RunPod, storage pipeline, or webhook callbacks
   - UI and UX cleanup (use `web/src/components/ui/` primitives — see Phase 1.4 conventions)
2. Read `.github/copilot-instructions.md` for repo overview, then the relevant file-scoped instructions in `.github/instructions/`.
3. Use the matching skill in `.claude/skills/` when the task falls into a repeated workflow (these auto-load when their description matches).
4. Prefer the smallest fix that restores parity or behavior at the correct layer.

## Important Invariants

- Builder preview, HTML preview, and final rendered media are separate layers. Do not assume a visual bug belongs to the render engine before comparing those three stages.
- Captions and transcription are orchestrated through several web API routes and shared helpers rather than one dedicated coordinator module. Follow the full path before refactoring.
- Template video logic should stay aligned between local FastAPI and RunPod through the shared code in `render-engine/engine/template_composite.py` and related engine modules.
- RunPod NVENC failures are not always app bugs. Some GPU offers expose CUDA and even FFmpeg NVENC encoders while still failing runtime encode sessions.
- UX is currently uneven across the app. Improvements should reduce friction and inconsistency, not add another independent visual language.

## Phase 1.x — Conventions actées (publication pipeline overhaul)

L'app a pivoté d'une grille d'outils standalone vers un pipeline éditorial avec rôles. Les conventions ci-dessous sont **stables** et doivent être respectées par les futures features.

### Rôles utilisateurs
- 5 rôles : `ADMIN`, `VIDEASTE`, `MONTEUR`, `CM`, `EXTERNAL_GENERATOR`. Définis dans `web/src/types/roles.ts`. (`USER` est l'ancien rôle legacy — ne pas le recréer.)
- Filtrage par rôle des slots : `web/src/lib/permissions/slotScope.ts` (`whereClauseForUser`, `canUserAccessSlot`, `ALLOWED_PATCH_FIELDS_BY_ROLE`).
- Permissions outils par rôle : `web/src/lib/permissions/tools.ts` (`ROLE_TOOL_SCOPE`).
- Helpers publications : `web/src/lib/permissions/publications.ts` (`canSeePublication`, `canMarkPublished`, `canEditComment`).
- **Impersonation** : utiliser `effectiveUser` (via `getUserContext`) pour les scopes de données, pas `auth()` direct.
- **Architecture access control** : 3 niveaux coexistents — ADMIN bypass, role tool scope, granular per-resource tables. Documentés dans `web/docs/adr/001-access-control-patterns.md`.

### API routes — règle d'auth (Phase 1.8)
**Toujours utiliser `getUserContext()` dans les routes API. Ne jamais appeler `auth()` directement.**

```typescript
const userContext = await getUserContext();
if (!userContext?.effectiveUser.id) { /* 401 */ }
```

Décision par usage :
- **Auth basique** (route accessible à tout user connecté) → `effectiveUser.id`
- **Scope data** (filtrer les entités par user) → `effectiveUser.id`
- **Décision admin-only** (gate une action au rôle ADMIN) → `canAdminBypass` (true si ADMIN réel ET pas en impersonation)
- **Audit log / traceability** (qui a vraiment déclenché l'action) → `actualUser.id`

Exceptions intentionnelles :
- `/api/admin/impersonation` — garde `auth()` direct : établit/détruit le cookie d'impersonation, donc `getUserContext()` créerait une dépendance circulaire.
- `/api/webhooks/runpod/*` — routes publiques signées par `RUNPOD_WEBHOOK_SECRET`, pas de session.

### Modèles Prisma centraux
- `PublicationSlot` (avec `assigneeMonteurId`, `assigneeCmId`, `patternId`, `currentVersionId`, `publishedUrl`, `publishedAt`, `description`)
- `AccountPattern` (Phase 1.6 — remplace ContentRecipe + AccountPlan + OfferScheduleRule) : pattern de publication par compte IG avec planning intégré (`dayOfWeek`, `publishTime`), source (`auto_template | manual_rushes | external_upload`), cover config, needs* flags, assignations par défaut
  - **`coverConfig`** : source de vérité unique pour la cover auto. Forme cible : `{ enabled, coverPresetName }`. Le nom du preset est résolu à runtime via `TemplateCoverPreset` (Phase 2.0).
  - **`captionPresetId`** / **`descriptionPromptId`** : FK optionnelles vers les presets/prompts par défaut pour ce pattern (Phase 2.0 E1, onDelete SetNull).
  - **`libraryId`** : supprimé en Phase 1.8 (champ mort — jamais consommé par `generateRender.ts`)
- `TemplateCoverPreset` (Phase 2.0) : presets cover définis au niveau du template (nom, sortOrder, config snapshot). Le pattern référence par **nom** (pas ID) pour la robustesse.
  - Cover config = `TemplateCoverPreset` (matériel, défini dans le builder) + `Pattern.coverConfig.coverPresetName` (décision, sélectionnée dans la fiche pattern)
- `Client` → 1..N `InstagramAccount` → 1..N `AccountPattern`
- `PublicationVersion` (versions livrées monteur, soft-delete)
- `PublicationComment`, `PublicationActivity` (fil + log)

**Modèles supprimés en Phase 1.6** (ne pas les recréer) : `ContentRecipe`, `AccountPlan`, `OfferScheduleRule`

**Champs supprimés en Phase 1.8** (ne pas les recréer) :
- `Template.coverAutoConfig` — migré vers `AccountPattern.coverConfig`
- `AccountPattern.libraryId` — champ mort droppé

### Page fiche publication
- Hub central : `/publications/[id]` (`web/src/app/(app)/publications/[id]/`)
- 6 sections driven by pattern : Render, Cover, Captions, Description, Caption IG, Publish
- `ProductionChain` visualise les steps depuis `computePublicationSteps`
- `logActivity` (`web/src/lib/publications/activity.ts`) à appeler après chaque action métier significative (mark-published, comment, status change, assignee change)

### Primitives UI (`web/src/components/ui/`)
**Utiliser ces composants pour tout nouveau code, ne pas dupliquer les classes Tailwind** :
- `Button` — variants `primary | secondary | ghost | danger`, sizes `sm | md`, props `loading | disabled | icon`
- `Input` — input contrôlé avec `value/onChange(string)`, `error` ring rouge si présent
- `Textarea` — même API qu'Input + `resize-y`
- `FormField` — wrapper `label + required + help + error + children`
- `EmptyState` — icône + titre + description + CTA optionnel
- `ConfirmDialog` — modal Tailwind, focus trap, ESC pour fermer, variant `danger`
- `DeleteButton` — encapsule "icône Trash → ConfirmDialog" (props `itemLabel`, `description?`, `onConfirm`)
- `Toast` (`@/components/ui/Toast`) — `toast.success/error/info`. **Jamais d'`alert()` ni `confirm()` natif dans le code admin/UI.**

### Patterns admin
- **Pattern d'onglets** : `state activeTab` + boutons toggle inline + support `?tab=X` via `useSearchParams`. Référence : `/admin/clients/[id]/page.tsx`.
- **Pattern hub avec cards** : grid responsive `grid-cols-1 sm:grid-cols-2 lg:grid-cols-N` + cards stack vertical (icône 40×40 dans wrapper colored + titre + description). Référence : `/admin/libraries/page.tsx` (hub "Ressources").
- **Page admin avec panel client** : server component qui fetch via Prisma + passe initialData à un client component. Garde admin via `getUserContext` + `actualUser.role === "ADMIN"` (redirect si non).
- **ToolPageHeader** partout en haut des pages admin (titre + subtitle + icône + actions optionnelles).

### Surfaces UI — contrat home / calendar / fiche

L'app a 3 surfaces principales, chacune avec une vocation distincte. **Ne jamais
dupliquer une responsabilité d'une surface à une autre** (pas d'action surface
dans les homes, pas de triage dans la fiche).

| Surface | Rôle | Vocation |
|---|---|---|
| `/home` (HomeAdmin) | ADMIN | **Vue de pilotage** : KPI cards + versions à valider. Pas de worklist perso. |
| `/home` (HomeMonteur / HomeCm / HomeVideaste) | MONTEUR / CM / VIDEASTE | **Worklist triage perso** — slots assignés, découpés par phase/urgence. Click → fiche. Aucune action surface (pas d'upload, pas de validation inline). |
| `/home` (HomeExternalClient) | EXTERNAL_GENERATOR | **Gateway client externe** : templates accessibles + lien "Mes générations" → /listings. Hors pipeline éditoriale. |
| `/calendar` | ADMIN principalement | **Orchestration** : création de slots, réassignation, génération de semaine. L'admin agit pour les autres rôles via le calendrier. |
| `/publications/[id]` (fiche complète) | tous (filtré par rôle) | **Surface d'exécution unifiée**. `shouldRenderForRole` masque les sections hors-rôle. `ProductionChain` filtre les steps via `viewerRole`. ADMIN voit tout pour supervision/proxy. |

**Convention ADMIN-proxy** : quand l'admin doit uploader un rush à la place du
vidéaste ou faire un montage à la place du monteur, il passe par
`/calendar` → slot → fiche complète. Toutes les sections lui sont visibles
(les helpers `canX*` dans `lib/permissions/publications.ts` font le bypass ADMIN).
**Pas de toggle "Agir comme X"** sur la fiche : le view-as existant au top
de la nav (`/api/admin/view-as`) suffit pour prévisualiser le UI d'un rôle.

### Navigation admin (3 sous-sections)
```
PRODUCTION  — Templates / Calendrier
CLIENTS     — Clients / Comptes Instagram
CONFIGURATION — Ressources (hub 4 cards) / Utilisateurs
```
- **Templates** : module central, dans Production (pas dans Outils — voir mémoire `templates-module-importance`)
- **Calendrier** (`/calendar`) : vue hebdo des slots + bouton "Générer la semaine" (lit les `AccountPattern` actifs). Les `SlotCard` affichent un badge violet `pattern.label` cliquable → fiche compte.
- **Hub Ressources** : Médias / Données / Typographies / Prompts IA (extensible — ajouter une card pour tout nouveau type de ressource réutilisable)
- **Comptes Instagram** (`/admin/accounts`) : vue plate de tous les comptes IG groupés par client — ajouté Phase 1.7. Lien bidirectionnel depuis fiche Client onglet Comptes.
- **Fiche compte** (`/admin/accounts/[id]`) : patterns par compte (form structuré, jamais de JSON exposé). `AddSlotModal` utilise un picker de ces patterns (plus de saisie libre contentType).
- **Patterns** : gérés via `/admin/accounts/[id]`. `CloneDialog` utilise un select visuel des comptes (plus d'ID CUID brut). — PAS de page `/admin/patterns` top-level
- **Presets sous-titres** : gérés uniquement via `/tools/captions` (PAS de page admin dédiée)
- **`Offer` n'existe plus** côté Prisma (droppé Phase 1.7 A1). `InstagramAccount.offre` est un champ `String` libre (valeurs ESSENTIEL/CONFIRME/CEO préservées comme tag).

**Routes supprimées en Phase 1.6** (retournent 404) : `/admin/recipes`
**Routes supprimées en Phase 1.7** (retournent 404) : `/admin/offer-schedule`, `/api/admin/offers`

### Dette technique
- Phase 1.2 : voir entrée mémoire `project_phase_1_2_technical_debt_active.md` dans MEMORY.md
- Phase 1.6 : voir entrée mémoire `project_phase_1_6_technical_debt.md` dans MEMORY.md — items résolus :
  - ~~Picker patterns dans `AddSlotModal`~~ → résolu Phase 1.7 C1
  - ~~Badge pattern absent dans `SlotCard`~~ → résolu Phase 1.7 C2
  - ~~`CloneDialog` ID CUID brut~~ → résolu Phase 1.7 C3
  - ~~`computePublicationSteps` compat arg `recipe`~~ → résolu Phase 1.7 C4
  - ~~Drop `Template.coverAutoConfig`~~ → résolu Phase 1.8 C7 (migré vers `AccountPattern.coverConfig`)
  - ~~Drop `AccountPattern.libraryId`~~ → résolu Phase 1.8 B1 (champ mort)
  - Reste : `CoverConfigEditor` zones avancées JSON, `User.permissions[]` accepté pour USER role, `PublicationSlot.contentType` redondant avec pattern.label
- Refacto UX **interne** du module Templates (builder Canvas, ergonomie éditeur) — chantier dédié Phase 1.5+
- Migration `MediaAssetsPanel` (2440 LOC) aux primitives UI — split en sous-composants requis avant
- Libraries sous-pages restantes (MediaLibrariesPanel, DataLibrariesPanel, etc.) à migrer aux primitives

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
- `content-library/` — MediaLibrary, MediaAsset, setTag, category, tags, setSequence, MediaAssetAccess, MediaAssetUsage, DataLibrary, DataCampaign, DataEntry, AccountLibraryCursor, builder bindings, selection rules (theme_sequence/oldest_used/least_used), generation pre-fill, recordLibraryUsage, MediaAutocutJob batch autocut
- `asset-rotation/` — rotation algorithm internals: auto mode (group discovery, category exclusion, per-account ordering), override mode (cursor), pickFromGroup, per-account isolation via MediaAssetUsage, rotation simulation, common bugs
- `description-generation/` — DescriptionJob, DescriptionPrompt, Claude/GPT generation, transcript/image inputs, admin prompt management

File-scoped instructions (`.github/instructions/`):

- `web.instructions.md` — Next.js, Prisma, NextAuth, API route conventions
- `render-engine.instructions.md` — FastAPI, FFmpeg, worker, R2 conventions

Repo overview: `.github/copilot-instructions.md` (still load-on-demand; not Claude-Code-specific despite the name).

## Tests automatisés

Le repo a deux niveaux de tests, exécutables localement et indépendamment du dev server :

### Unit tests (Vitest)
- Lance les tests purs des helpers permissions (`slotScope`, `publications`, `tools`).
- Pas de DB, pas de browser, runtime Node uniquement.
- Pour ajouter un test : `web/src/lib/**/*.test.ts` ou `web/src/lib/**/__tests__/*.test.ts`.

```bash
cd web
npm run test:unit          # CI mode (exit propre)
npm run test:unit:watch    # mode dev (re-run sur save)
npm run test:unit:ui       # debugger Vitest UI
```

### E2E tests (Playwright)
- Lance Chromium headless contre un serveur Next.js dédié sur le port 3100.
- Utilise une **DB de test séparée** (`toolbox_test`) pour ne pas polluer dev.
- Cookies/session NextAuth réels via la page `/login`.

```bash
cd web
# Premier setup (une seule fois) :
npm run test:db:setup      # crée toolbox_test + applique migrations
npm run test:db:seed       # seed admin/monteur/cm/user + 1 client + 1 slot

# À chaque run :
npm run test:e2e           # CI mode (headless)
npm run test:e2e:ui        # debugger Playwright UI (timeline + selectors)
npm run test:e2e:headed    # voir le browser pendant les tests

# Reset complet de la DB de test :
npm run test:db:reset && npm run test:db:setup && npm run test:db:seed
```

Credentials de test (tous : password `testpass`) :
- `admin@test.local` / `test_admin` (rôle ADMIN)
- `monteur@test.local` / `test_monteur` (rôle MONTEUR, assigné slot `test-slot-1`)
- `cm@test.local` / `test_cm` (rôle CM, assigné slot `test-slot-1`)
- `user@test.local` / `test_user` (rôle USER, permission `["captions"]`)

**Discipline** : tout changement qui touche permissions, helpers de scoping, ou navigation admin **doit** lancer `npm run test:unit && npm run test:e2e` avant commit. Si un test échoue à cause d'un changement intentionnel, mettre à jour le test dans le même commit.

## Validation Rule

Always prefer targeted validation for the exact subsystem changed. If only manual or lint-level validation was possible, state that clearly instead of implying full confidence.
