---
slug: account-pattern-config
name: Admin — configuration d'un AccountPattern (drawer 4 onglets + validation cross-field)
generatedAt: 2026-06-01T00:00:00Z
---

# Admin — configuration AccountPattern

## Pitch
Workflow admin pour créer/éditer un `AccountPattern` (config publication par compte IG). Définit `source`, `coverMode`, `needsCaptionsMode`, `needsDescription`, validation client, jours/heures de publication. Validation cross-field stricte (C1-C10) + UI drawer 4 onglets avec banner "Configuration incohérente".

## Schéma Mermaid

```mermaid
flowchart LR
  List[/admin/accounts] --> Fiche[/admin/accounts/[id]]
  Fiche --> PatternsList[AccountPatternsList]
  PatternsList --> Edit["Bouton Éditer<br/>data-testid='pattern-edit-button'"]
  Edit --> Drawer[AccountPatternForm Drawer xl]
  Drawer --> Tabs["Onglets : Identité / Production / Workflow / Équipe"]
  Tabs --> XField[xfieldErrors useMemo onChange]
  XField --> Banner["Banner peach Configuration incohérente"]
  Drawer --> Submit[handleSubmit]
  Submit --> Validate[validatePatternConfig client + server]
  Validate -->|422| Errors[validationErrors + setErrors form key]
  Validate -->|OK| API["POST/PATCH /api/admin/accounts/[id]/patterns"]
  API --> Saved[onSaved → refresh liste]
```

## Entry points UI

| Composant | Fichier:Ligne | Rôle |
|---|---|---|
| Liste comptes | `src/app/(app)/admin/accounts/page.tsx:14` | Grid 6 cols + KPI activePatternCount |
| Fiche compte | `src/app/(app)/admin/accounts/[id]/page.tsx:20` | Server : load patterns + templates + lastRenders |
| AccountPatternsList | `src/components/admin/AccountPatternsList.tsx:400` | Cards patterns du compte |
| Bouton Éditer | `AccountPatternsList.tsx:235-244` | `data-testid="pattern-edit-button"` |
| AccountPatternForm | `src/components/admin/AccountPatternForm.tsx:231` | Drawer xl, 4 onglets, sticky banner xfield |
| CloneDialog | `src/components/admin/CloneDialog.tsx:30` | Clone patterns d'un compte source |

## Onglets du Drawer

`web/src/components/admin/AccountPatternForm.tsx:472-477` :

| Onglet | id | Icon | Contenu |
|---|---|---|---|
| Identité | `identity` | IdCard | Label, isActive, source, templateId, dayOfWeek, publishTime, notes |
| Production | `production` | Sparkles | coverMode + coverConfig, needsCaptionsMode + captionPresetId, needsDescription + descriptionPromptId |
| Workflow | `workflow` | Workflow | needsBrief, needsAdminValidation, needsClientValidation, allowsClientRevision |
| Équipe | `team` | Users | defaultAssigneeVideaste/Monteur/Cm via AssigneePicker |

## Routes API

| Méthode | Path | Fichier | Effets |
|---|---|---|---|
| GET | `/api/admin/accounts` | `route.ts:6-14` | Liste + activePatternCount + lastPublishedAt |
| GET / POST | `/api/admin/accounts/[id]/patterns` | `route.ts:1-4` | Liste / crée avec validation cross-field |
| GET / PATCH / DELETE | `/api/admin/accounts/[id]/patterns/[patternId]` | `route.ts:1-5` | Détail / édition partielle / suppression si 0 slots |
| POST | `/api/admin/accounts/[id]/patterns/clone-from` | `route.ts:1-7` | Clone (sourceAccountId + patternIds[] optionnel) |
| GET | `/api/caption-presets` | — | Liste presets captions (admin = tous, user = via CaptionPresetAccess) |
| GET | `/api/description/prompts` | — | Liste DescriptionPrompt actifs |
| GET | `/api/templates` | — | Liste templates accessibles |
| GET | `/api/templates/[id]/cover-presets` | — | Liste TemplateCoverPreset du template |
| GET | `/api/admin/users?role=X` | — | Liste users pour pickers (MONTEUR/CM/VIDEASTE) |

## Validation cross-field (C1-C10)

`web/src/lib/publications/patternValidation.ts:79-155` — **`validatePatternConfig(input, template)`** retourne `PatternValidationError[]` :

| Code | Règle | Champ erreur |
|---|---|---|
| `MISSING_COVER_PRESET_NAME` (C1) | `coverMode=autoPack` → template doit avoir ≥1 coverPreset | coverConfig |
| `COVER_PRESET_NOT_FOUND` (C2) | coverPresetName doit exister sur template (Phase 1, obsolete en 2.6) | coverConfig |
| `MISSING_CAPTION_PRESET` (C3) | `needsCaptionsMode=auto` → captionPresetId requis | captionPresetId |
| `MISSING_DESCRIPTION_PROMPT` (C4) | `needsDescription=autoGenerate` → descriptionPromptId requis | descriptionPromptId |
| `MISSING_TEMPLATE` (C5) | `source=auto_template` → templateId requis | templateId |
| `MONTEUR_UPLOAD_REQUIRES_MANUAL_RUSHES` (C6) | `coverMode=monteurUpload` → source manual_rushes uniquement | coverMode |
| `ALLOWS_REVISION_WITHOUT_VALIDATION` (C10) | `allowsClientRevision=true` → needsClientValidation=true requis | allowsClientRevision |

- `web/src/lib/publications/patternValidation.ts:169-179` — **`detectOrphanedPatternConfig()`** variante read-only pour badge "Config invalide" sur card
- `web/src/components/admin/AccountPatternForm.tsx:296-327` — `xfieldErrors` useMemo : validation client onChange (warning inline) + submit bloquant
- `AccountPatternForm.tsx:540-554` — Banner "Configuration incohérente (N problèmes)" + liste détaillée + erreurs inline rouges
- `AccountPatternsList.tsx:70-88` — Badge "Config invalide" (peach variant) sur card pattern

## Modèles Prisma

- **`AccountPattern`** — id, accountId, label, source, templateId, coverMode, coverConfig, needsDescription, needsCaptionsMode, captionPresetId, descriptionPromptId, dayOfWeek[], publishTime, isActive, defaultAssigneeXxx, notes
- **`InstagramAccount`** — `handle @unique`, `accountPatterns` relation
- **`Template`** — `jsonData`, `coverPresets` relation
- **`TemplateCoverPreset`** — id, templateId, name, config Json, sortOrder
- **`CaptionPreset`** — id, userId (null=builtin), config Json, accountPatterns relation
- **`DescriptionPrompt`** — id, name, prompt, isActive, recipeKind, recipeConfig
- **`User`** — `role`, `assignedAsXxx` (relation counters)

## Modes et enums

- **Source** : `auto_template` | `manual_rushes` | `external_upload`
- **Cover Mode** : `none` | `manualSelect` | `autoPack` | `monteurUpload`
- **Description** : `none` | `preFilled` | `autoGenerate` | `manualWrite`
- **Captions Mode (V8)** : `none` | `auto` | `manual`
- **Validation** : `needsAdminValidation` (montage EDIT_REVIEW), `needsClientValidation` (magic link), `allowsClientRevision` (ping-pong)

Labels FR : `web/src/lib/ui/domainLabels.ts:18-93`.

## Flow sauvegarde

`web/src/components/admin/AccountPatternForm.tsx:380-469` `handleSubmit()` :
1. `validate(values)` (label requis, publishTime format)
2. Si `xfieldErrors.length > 0` → toast error + bloque
3. POST ou PATCH avec body
4. Server répond 422 + `validationErrors[]` → `setErrors(fieldErrors)` (mappés via `mapXfieldCodeToFormKey`)
5. Server répond 2xx → `onSaved()` (refresh liste parent)

## Composants UI

- `AccountPatternForm.tsx:231-892` — **AccountPatternForm** : Drawer xl, 4 onglets, Combobox dropdowns, TimePicker, AssigneePicker
- `AccountPatternForm.tsx:894-929` — **WorkflowToggle** : pattern toggle + description + error rouge
- `CoverConfigEditor.tsx:38-78` — Vérifie `template.coverPresets`, normalise `coverConfig`
- `CloneDialog.tsx:30-100` — Modal sélection compte source
- `AccountPatternsList.tsx:54-269` — PatternCard : grid [cover thumbnail | contenu], meta badges, activeFlags chips, avatars assignés

## Points de cohérence

- `needsRushes` dérivé auto de source (manual_rushes ⇒ true)
- `coverConfig` JSON normalisé à `{ enabled: true }` quand `coverMode=autoPack`
- `needsCaptionsMode` (V8) prime sur `needsCaptions` Boolean — écrits en miroir pour back-compat
- `allowsClientRevision` UI affiché uniquement si `needsClientValidation=true` (indent border-l-2 rose)
- Orphelin : template supprimé, preset cover supprimé (FK SetNull), caption preset supprimé, description prompt supprimé → badge "Config invalide"

## Sécurité & permissions

- Toutes les routes admin : `canAdminBypass` check + 403 si non-admin
- Anti-énumération `findFirst` avec `accountId` (404 si pattern hors compte)
- DELETE : refuse si `pattern.publicationSlots > 0`
- Page : redirect `/home` si non-admin

## Skills/agents pertinents

- `.claude/skills/admin-permissions/SKILL.md`
- `.claude/skills/ui-design/SKILL.md` (drawer + form patterns)
- Agent `toolbox-generalist` pour modifs

## Liens vers code

- Tests : `web/src/lib/publications/__tests__/patternValidation.test.ts` (6 OK + 6 erreur C1-C6-C10)
- E2E : `web/e2e/patterns-redesign.spec.ts` + scenario `account-pattern-edit-all` dans audit-ux
