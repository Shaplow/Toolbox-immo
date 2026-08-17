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

Doctrine DA v3 (15/06) : **flat shadcn-style, light only, accent indigo Linear (`#5e6ad2`)**. La doctrine Liquid Glass v2 + palette Coastal Studio (peach/sage/sky/rose) est jetée.

- Tokens sémantiques : `bg-card`, `text-card-foreground`, `bg-popover`, `bg-muted`, `text-muted-foreground`, `text-foreground`, `border-border`, `border-input`, `bg-primary`, `text-primary-foreground`, `bg-accent`, `text-accent-foreground`.
- Palette zinc 50→950 pour neutres ; success/danger/info/warning 50/100/200/600/700 pour semantic.
- Conteneurs : `Card` (variant `default | outline`)
- Actions : `Button` (variants `default | secondary | outline | ghost | danger | link`)
- Inputs : `Input`, `Textarea`, `Combobox`, `Select`, `FormField`
- Layouts : `PageShell` (max-w + padding), `Drawer`, `Tabs`, `EmptyState`, `ConfirmDialog`
- Feedback : `Toast` (`toast.success/error/info`) — **jamais** `alert()` ou `confirm()` natifs
- Surfaces : `bg-card border border-border rounded-lg` ; pas de `backdrop-blur`, pas de `gradient-page-shell`, pas de pastels Coastal Studio.
- Shell pages : **toujours `<PageShell variant="default|wide|narrow">`**, jamais de wrapper inline `ml-[Npx] mr-[Npx] rounded-3xl` (banni — pattern Liquid Glass island jeté en DA v3 / Phase F).

Si une primitive manque pour un usage récurrent, **ajoute-la** dans `web/src/components/ui/` plutôt que de dupliquer des classes. ESLint guard `no-restricted-syntax` flag toute réintroduction de `bg-(peach|sage)-*`.

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
- **Filtrage fiches par rôle** : `web/src/lib/permissions/entityScope.ts` (switch `EntityType.visibility` : `admin` = CRUD admin strict, `team` = scoping assignés type ex-ShootEvent).
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

- `PublicationSlot` (assigneeMonteurId, assigneeCmId, patternBindingId, patternTemplateId, currentVersionId, publishedUrl, description)
- `PatternTemplate` — recette éditoriale réutilisable (label, source `auto_template | manual_rushes | external_upload`, coverConfig, needs* flags, captionPreset, descriptionPrompt, templateId).
- `PatternBinding` — application d'une recette à un `InstagramAccount` (planning `dayOfWeek` + `publishTime`, assignées défaut, isActive, overrides ponctuels).
- `AccountPattern` — **décommissionné côté code (D2, 16/08)** : plus aucune lecture/écriture ; la table + `PublicationSlot.patternId` restent en DB jusqu'au drop N+1. La clé API `patternId` du PATCH slot désigne désormais un id de PatternBinding.
- `Client` → N `InstagramAccount` → N `PatternBinding` → 1 `PatternTemplate`.
- **Phase 5 métaobjet (17/08)** : `EntityType` (types de fiches configurables — schéma customFields + capacités hasPlanning/hasAccount/hasRushes/hasAssignees + visibility) + `Entity` (« Fiche », fusion de Property « Bien » et ShootEvent « Tournage », ids repris au backfill) + `EntityActivity`. Slots : `entityId` (fiche data, clé API `propertyId`) + `shootEntityId` (tournage, clé API `eventId`). `PatternTemplate.requiresEntityTypeId` remplace `requiresProperty`. Types système seedés : `etype_bien`, `etype_tournage`. **Les modèles `Property`/`ShootEvent`/`ShootEventActivity` sont morts côté code** (tables en DB jusqu'au drop N+1 — cf. `web/prisma/pending-drops/`). Service : `web/src/lib/services/entity/entityService.ts`.
- `PublicationVersion` (versions monteur, soft-delete)
- `PublicationComment`, `PublicationActivity` (fil + audit log)
- `TemplateCoverPreset` (presets cover définis dans le builder, référencés par nom par `Pattern.coverConfig.coverPresetName`)

`logActivity` (`web/src/lib/services/slot/activity.ts`) à appeler après chaque action métier significative (mark-published, comment, status change, assignee change, job promote).

## Glossaire UI (Pattern → Recette)

**DB = Pattern, UI = Recette.** Le code (Prisma, types, services) garde les noms originaux `PatternTemplate` / `PatternBinding` / `PublicationSlot`. L'UI parle uniquement de "Recette" / "Publication".

**G.3 (16/06)** : la "Recette" en UI fusionne PatternTemplate + PatternBinding. Sur la fiche compte (`/admin/accounts/[id]`), chaque carte expose les champs des deux modèles (contenu + planning + équipe) éditables inline via le drawer `RecipeForm` (tabs Contenu / Planning & équipe / Spécifique). Save atomique transaction Prisma : `POST/PATCH /api/admin/accounts/[id]/recipes[/<bindingId>]`. Le catalogue `/admin/patterns` reste accessible (Configuration → Recettes) pour réutiliser une recette sur un autre compte via "Appliquer à des comptes".

**Simplification Phase 3 (16/08)** — médiathèque « dossiers simples » : le champ Prisma `setTag` s'appelle **« Dossier »** côté UI (ex-« Groupe » H.1, ex-« Pack »). Le moteur de rotation (curseurs `AccountLibraryCursor`, `category`/exclusion famille, mode `override`/`setSequence`, anti-répétition, simulation admin) est **décommissionné** : tirage least-recently-used par dossier, zéro état (`selectMediaAssetFromFolder` — voir skill `asset-rotation`). `rotationMode` ∈ `auto | none`. Claim d'usage au submit (`advanceMediaUsageOnSubmit`), revert CAS sur échec. Les colonnes/tables mortes (`AccountLibraryCursor`, `MediaLibrary.setSequence`, `MediaAsset.category`) restent en DB jusqu'au drop N+1. Le préfixe `pack_` (H.2) reste réservé/masqué — test unique `isReservedSetTag()` (`lib/rotation/sentinels.ts`).

**I.1 + I.2 + I.3 (16/06) — Densification layout** :
- **Calendrier** (`/calendar`) : header sticky 48px (drop le big 105px), `SlotCard` compact 56px (drop padding mort + nom compte, garde dot phase + heure + titre + 3 avatars), grille `gap-x-2.5 gap-y-3`, `DayCard` header single-line. Cible ≥10 slots visibles par viewport (vs 4-6).
- **Médiathèque** (`/admin/libraries/{media,audio}/[id]`) : page SSR minimal, le shell complet (strip 60px + body) est dans `MediaAssetsPanel`. KpiRow + NextGenPreview retirés du flow (counts dans le strip header), bouton "Réglages" en haut ouvre `MediaLibrarySettingsDrawer`. Cards visibles dès le scroll initial.
- **Data** (`/admin/libraries/data/[id]`) : même strip pattern, spreadsheet plein écran.
- Purge D1 (16/08) : les composants non-rendus (`MediaAssetsKpiRow`, `MediaAssetsNextGenPreview`, `MediaAssetsOrphanRibbon`, `MediaAssetsCategoriesSidebar`, `DataCampaignsPanel`, `BulkStockModal`, `AccountPatternForm/List`, etc.) ont été **supprimés** du repo (plan simplification, tag `pre-simplification`). Le type `CategoryFilter` vit dans `mediaAssets/types.ts`.

Source unique : `web/src/lib/i18n/entityLabels.ts` (`ENTITY_LABELS` + `entityLabel()` + `SOURCE_LABELS_FR` + `SOURCE_VARIANT` + helps contextuels). **Pas de SOURCE_LABEL redéclaré localement** dans un composant, sinon dérive garantie (5 versions différentes ont coexisté avant unification du 15 juin).

## Surfaces UI — contrat

| Surface | Rôle | Vocation |
|---|---|---|
| `/home` (HomeAdmin) | ADMIN | KPI + versions à valider. Pas de worklist perso. |
| `/home` (HomeMonteur/Cm/Videaste) | MONTEUR/CM/VIDEASTE | Worklist triage perso. Aucune action surface (click → fiche). |
| `/home` (HomeExternalClient) | EXTERNAL_GENERATOR | Gateway client externe. Hors pipeline. |
| `/calendar` | ADMIN | Orchestration : création slots, réassignation, génération semaine. |
| `/fiches` + `/fiches/[id]` | ADMIN (tout) / équipe (types `team`) | Fiches (métaobjets) : tabs par type, toggle Liste/Planning pour les types à planning, fiche unifiée à sections conditionnelles (champs custom, planning, rushs, reels, activité). `/biens/*` et `/events/*` = redirects. |
| `/publications/[id]` | tous (filtré par rôle) | Surface d'exécution unifiée. `shouldRenderForRole` masque les sections hors-rôle. ADMIN voit tout. |

**ADMIN-proxy** : pour agir à la place de quelqu'un, l'admin passe par `/calendar` → fiche (les helpers `canX*` font le bypass). Pas de toggle "Agir comme X" sur la fiche.

## Navigation admin

```
PLANIFICATION — Calendrier / Fiches / Comptes Instagram / Médiathèque / Vidéo / Données
PRODUCTION    — Studio (templates) / Atelier (outils) / Mes générations
CONFIGURATION — Recettes (catalogue) / Types de fiches / Clients / Utilisateurs / Jobs actifs
```

- Studio (`/templates`) est le builder template central (pas dans Outils).
- Recettes vivent par défaut sur la fiche compte (`/admin/accounts/[id]`). Le catalogue `/admin/patterns` est secondaire (réutilisation cross-comptes).
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
