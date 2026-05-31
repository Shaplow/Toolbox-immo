# Toolbox Immo — Claude Code Context

Monorepo Next.js (web/) + Python render engine (render-engine/).

- `web/` — produit, template builder, HTML previews, auth, Prisma, UI utilisateur.
- `render-engine/` — FFmpeg, captions, template compositing, RunPod worker, R2.

## Workflow

- On travaille **sur `main`**. Pas de branches dédiées, pas de worktrees.
- À la demande explicite du user : `git commit` puis `git push`. **Ne commit jamais sans qu'il te le demande**.
- Pas de `--no-verify`, pas de `--force` push, pas de `git reset --hard`.
- Toujours `Read` avant `Edit` (le user édite parfois en parallèle dans son IDE).

## UI-first — règle dure

**Tout nouveau code UI passe par les primitives `web/src/components/ui/` et les design tokens.** Pas de duplication de classes Tailwind ad hoc.

- Conteneurs : `Card` (variant `solid | glass | frosted | tinted`)
- Actions : `Button` (variants `primary | secondary | ghost | danger`)
- Inputs : `Input`, `Textarea`, `Combobox`, `FormField` (wrapper label/error/help)
- Layouts : `Drawer`, `Tabs`, `EmptyState`, `ConfirmDialog`, `DeleteButton`
- Feedback : `Toast` (`toast.success/error/info`) — **jamais** `alert()` ou `confirm()` natifs
- Pages full-screen : shell standard `<div className="min-h-screen"> <div className="my-11 ml-[100px] mr-[100px] rounded-3xl" style={{ background: "var(--gradient-page-shell)" }}>` (cf. cover/captions/transcription)
- Surfaces internes : cards glass `bg-white/60 backdrop-blur-[6px] border border-white/50 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]`

Si une primitive manque pour un usage récurrent, **ajoute-la** dans `web/src/components/ui/` plutôt que de dupliquer des classes.

## UX checkpoint

Après tout changement UI non trivial (nouvelle page, refonte de section, banner, état empty/loading/error) : lance `/audit-ux` ou au moins capture la surface via `npm run ux:capture` et regarde si la sémantique de chaîne tient (steps cohérents, breadcrumbs cohérents, copy clair). Les régressions visuelles ratent plus souvent par sémantique trompeuse que par CSS.

Sources concrètes : `web/e2e/production-chain-v8-visual.spec.ts` pour la regression pixel, `npm run ux:capture` pour audits qualitatifs.

## Important Invariants

- Builder preview, HTML preview, vidéo finale = 3 couches distinctes. Compare les 3 avant d'imputer un bug visuel au render engine.
- Captions / transcription orchestrés via plusieurs routes API + helpers partagés. Suis tout le chemin avant de refactor.
- Template video logic doit rester alignée local FastAPI ↔ RunPod via `render-engine/engine/template_composite.py`.
- RunPod NVENC failures ne sont pas toujours des bugs app — certains GPU offers échouent runtime même avec CUDA/FFmpeg NVENC OK.

## Rôles et accès (publication pipeline)

- **5 rôles** : `ADMIN`, `VIDEASTE`, `MONTEUR`, `CM`, `EXTERNAL_GENERATOR` (`web/src/types/roles.ts`).
- **Filtrage slots par rôle** : `web/src/lib/permissions/slotScope.ts` (`whereClauseForUser`, `canUserAccessSlot`, `ALLOWED_PATCH_FIELDS_BY_ROLE`).
- **Permissions outils par rôle** : `web/src/lib/permissions/tools.ts` (`ROLE_TOOL_SCOPE`).
- **Impersonation** : utilise `effectiveUser` (via `getUserContext`) pour scoper la data, pas `auth()` direct.

### Auth dans les routes API — règle dure

**Toujours `getUserContext()`, jamais `auth()`.**

```ts
const userContext = await getUserContext();
if (!userContext?.effectiveUser.id) { /* 401 */ }
```

- Auth basique / scope data → `effectiveUser.id`
- Décision admin-only → `canAdminBypass`
- Audit log / traceability → `actualUser.id`

Exceptions : `/api/admin/impersonation` (cookie set/destroy) + `/api/webhooks/runpod/*` (signés par `RUNPOD_WEBHOOK_SECRET`).

## Modèles Prisma centraux

- `PublicationSlot` (assigneeMonteurId, assigneeCmId, patternId, currentVersionId, publishedUrl, description)
- `AccountPattern` — pattern de publication par compte IG + planning (`dayOfWeek`, `publishTime`) + source (`auto_template | manual_rushes | external_upload`) + coverConfig + needs* flags + assignations défaut
- `Client` → N `InstagramAccount` → N `AccountPattern`
- `PublicationVersion` (versions monteur, soft-delete)
- `PublicationComment`, `PublicationActivity` (fil + audit log)
- `TemplateCoverPreset` (presets cover définis dans le builder, référencés par nom par `Pattern.coverConfig.coverPresetName`)

`logActivity` (`web/src/lib/services/slot/activity.ts`) à appeler après chaque action métier significative (mark-published, comment, status change, assignee change, job promote).

## Surfaces UI — contrat

| Surface | Rôle | Vocation |
|---|---|---|
| `/home` (HomeAdmin) | ADMIN | KPI + versions à valider. Pas de worklist perso. |
| `/home` (HomeMonteur/Cm/Videaste) | MONTEUR/CM/VIDEASTE | Worklist triage perso. Aucune action surface (click → fiche). |
| `/home` (HomeExternalClient) | EXTERNAL_GENERATOR | Gateway client externe. Hors pipeline. |
| `/calendar` | ADMIN | Orchestration : création slots, réassignation, génération semaine. |
| `/publications/[id]` | tous (filtré par rôle) | Surface d'exécution unifiée. `shouldRenderForRole` masque les sections hors-rôle. ADMIN voit tout. |

**ADMIN-proxy** : pour agir à la place de quelqu'un, l'admin passe par `/calendar` → fiche (les helpers `canX*` font le bypass). Pas de toggle "Agir comme X" sur la fiche.

## Navigation admin

```
PRODUCTION    — Templates / Calendrier
CLIENTS       — Clients / Comptes Instagram
CONFIGURATION — Ressources (hub 4 cards) / Utilisateurs
```

- Templates est un module central (pas dans Outils).
- Patterns gérés via `/admin/accounts/[id]` (pas de page `/admin/patterns` top-level).
- Presets sous-titres gérés via `/tools/captions` (pas de page admin dédiée).

## Tests

### Unit (Vitest)

```bash
cd web && npm run test:unit
```

Tests purs des helpers permissions / steps / actions. Pas de DB, pas de browser.

### E2E (Playwright)

```bash
cd web
npm run test:db:setup && npm run test:db:seed   # une fois
npm run test:e2e                                # chaque run
npm run test:e2e:ui                             # debugger
```

DB séparée `toolbox_test`, port 3100, NextAuth réel. Credentials : `<role>@test.local` / `testpass` (admin / monteur / cm / videaste / user).

**Discipline** : tout change permissions / scoping / nav admin → `test:unit && test:e2e` avant commit.

### Audit UX visuel

```bash
cd web && npm run ux:capture
```

Capture les surfaces clés (édite `SURFACES` dans `scripts/capture-ux-screenshots.ts`) dans `.claude/ux-audit/<timestamp>/`. Puis demande à Claude d'analyser via la slash command `/audit-ux`.

## Prisma — sous-commandes (les agents se trompent souvent)

| Goal | Command |
|------|---------|
| Régénérer le client | `cd web && npm run db:generate` |
| Migration locale interactive | `cd web && npm run db:migrate` |
| Apply migrations (CI/agents) | `cd web && npx prisma migrate deploy` |
| Statut migrations | `cd web && npx prisma migrate status` |
| Push schema sans migration (proto) | `cd web && npm run db:push` |
| Backup DB prod | `cd web && npm run db:backup` |

`prisma migrate` sans sous-commande est invalide. Avant `migrate deploy` sur prod : `db:backup`.

## Commandes utiles

- Root : `npm run dev`, `npm run build`
- Web lint : `cd web && npm run lint -- path/to/file.tsx`

## Skills (auto-load par description)

`.claude/skills/<area>/SKILL.md` — chargés automatiquement quand leur description matche la tâche :

- `template-builder/` — builder UI, preview parity
- `render-engine/` — FFmpeg, RunPod, R2, webhooks
- `captions-transcription/` — orchestration captions/transcription
- `ass-rendering/` — ASS file generation, libass quirks
- `ui-design/` — design tokens, primitives, layout
- `app-hardening/` — defensive coding
- `security-review/` — OWASP audit
- `admin-permissions/` — gating, impersonation
- `content-library/` — MediaLibrary, MediaAsset, DataLibrary, rotation, generation pre-fill, MediaAutocutJob
- `asset-rotation/` — algo rotation interne (theme_sequence, per-account)
- `description-generation/` — DescriptionJob, Claude/GPT prompts

## Agents (via Task tool)

- `toolbox-generalist` — implémentation par défaut
- `feature-planner` — plan d'implémentation phasé avec interview
- `db-migration-helper` — change schema Prisma (edit → format → push/migrate → generate)
- `pr-summarizer` — résume une branche pour PR
- `code-reviewer` / `bug-hunter` / `security-auditor` / `ux-auditor` — audits read-only
- `Explore` (built-in) — recherche read-only multi-fichiers
- `Plan` (built-in) — architecture planning
- `general-purpose` (built-in) — fallback open-ended

## Slash commands

- `/triage <desc>` — quel agent, quel ordre
- `/implement-feature <plan>` — délégue à toolbox-generalist
- `/review-feature <files>` / `/hunt-bugs <module>` / `/security-audit <surface>` — audits read-only
- `/audit-ux [scénario]` — capture screenshots + analyse visuelle multimodale (rapport ranked critique/moyen/ok)
- `/map-workflow <description>` — scanne le code pour mapper un workflow user (entry points UI, routes API, modèles Prisma, jobs, side effects + schéma Mermaid). Sort un Markdown dans `.claude/workflows/<slug>.md` + régénère le dashboard HTML
- `/onboard <slug>` — résumé pragmatique (≤200 mots) d'un workflow déjà mappé pour reprendre le contexte vite
- `/e2e-from-desc <description>` — convertit une description FR en scenario Playwright dans `scripts/capture-ux-screenshots.ts`, teste en isolation, itère jusqu'à OK

## Validation Rule

Toujours préférer une validation ciblée sur le sous-système exact changé. Si seule la validation manuelle ou le lint était possible, dis-le explicitement plutôt que d'impliquer une confiance complète.
