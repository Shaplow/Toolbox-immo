---
name: content-library
description: >
  Implement and evolve the Content Library system in Toolbox Immo. Use when a
  task involves MediaLibrary, MediaAsset, DataLibrary, DataCampaign, DataEntry,
  library-to-VideoBlock bindings in the builder, generation form pre-fill,
  selection rules (oldest_used, least_used, round_robin), or batch generation.
---

# Content Library Skill

## Purpose

The Content Library system is a shared asset and data management layer that sits
**before** the generation form. It replaces ad-hoc video/audio picking and
manual text entry with organised, rule-driven libraries managed by admins.

Three distinct library types exist:

| Type | Model | What it holds |
|------|-------|---------------|
| Video | `MediaLibrary` (type="video") | Rush videos uploaded to R2 |
| Audio | `MediaLibrary` (type="audio") | Music tracks uploaded to R2 |
| Data | `DataLibrary` + `DataCampaign` + `DataEntry` | Text data per template type (RPI, RTIPS…) |

All libraries are **admin-managed and shared** across users. No per-user private
libraries in V1.

---

## Architecture Overview

```
Admin UI
  └── creates/uploads MediaLibrary + MediaAsset (video, audio)
  └── creates DataLibrary → DataCampaign → DataEntry (CSV import or form)

Builder
  └── VideoBlock → libraryId + selectionRule
  └── Template-level → audioLibraryId + audioSelectionRule
  └── Template-level → dataLibraryId + dataCampaignId + dataSelectionRule

Generation form
  └── reads linked libraries → applies rules → pre-fills fields
  └── user reviews and confirms before launching render
```

---

## Data Model

### Prisma models to add to `web/prisma/schema.prisma`

```prisma
// ─── Content Library ─────────────────────────────────────────────────────────

/// Bibliothèque de médias (vidéos rush ou musiques). Gérée par les admins.
model MediaLibrary {
  id          String       @id @default(cuid())
  name        String
  /// "video" | "audio"
  type        String
  /// JSON string[] — tags de type template : ["RPI","RTIPS","RPOD"] 
  tags        String       @default("[]")
  description String?
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
  assets      MediaAsset[]
}

/// Un fichier média dans une bibliothèque (stocké sur R2).
model MediaAsset {
  id         String       @id @default(cuid())
  libraryId  String
  library    MediaLibrary @relation(fields: [libraryId], references: [id], onDelete: Cascade)
  filename   String
  r2Key      String       @unique
  url        String
  /// "video/mp4" | "audio/mpeg" etc.
  mimeType   String
  /// Durée en secondes (remplie au probe après upload)
  duration   Float?
  /// Nombre de fois utilisé dans une génération
  usageCount Int          @default(0)
  lastUsedAt DateTime?
  createdAt  DateTime     @default(now())
  updatedAt  DateTime     @updatedAt
}

/// Bibliothèque de données texte, rattachée à un type de template (RPI, RTIPS…).
model DataLibrary {
  id           String         @id @default(cuid())
  name         String
  /// Identifiant métier du type : "RPI" | "RTIPS" | "RPOD" | etc.
  templateType String
  description  String?
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
  campaigns    DataCampaign[]
}

/// Cycle de données (ex: "RPI Q1 2026"). Une fiche active à la fois par library.
model DataCampaign {
  id          String      @id @default(cuid())
  libraryId   String
  library     DataLibrary @relation(fields: [libraryId], references: [id], onDelete: Cascade)
  name        String      // "RPI Q1 2026"
  isActive    Boolean     @default(true)
  /// Quand resetUsedInCycle() est appelé, tous les DataEntry.usedInCycle → false
  cycleResetAt DateTime?
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
  entries     DataEntry[]
}

/// Une fiche de données texte (une ligne de l'Excel d'origine).
model DataEntry {
  id           String       @id @default(cuid())
  campaignId   String
  campaign     DataCampaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  /// JSON — champs libres selon le templateType (ex: {quartier, prix_m2, evo_5ans})
  fields       String       @default("{}")
  usageCount   Int          @default(0)
  lastUsedAt   DateTime?
  /// Remis à false au reset de cycle. Permet la règle "pas encore utilisé ce cycle".
  usedInCycle  Boolean      @default(false)
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
}
```

---

## Template JSON Extensions

These fields extend the existing `TemplateJSON` type in
`web/src/types/template.ts`. **Do not remove existing fields.**

```typescript
// Inside TemplateJSON (top-level template config)
export interface TemplateContentLibraryConfig {
  /** ID of the MediaLibrary (type="audio") to use for this template */
  audioLibraryId?: string;
  /** Rule for auto-selecting a music track */
  audioSelectionRule?: "oldest_used" | "manual";
  /** ID of the DataLibrary for this template's type */
  dataLibraryId?: string;
  /** Active DataCampaign ID (can be overridden at generation time) */
  dataCampaignId?: string;
  /** Rule for auto-selecting a DataEntry */
  dataSelectionRule?: "not_used_in_cycle" | "least_used" | "manual";
}
```

For `VideoBlock`, add inside its existing interface:

```typescript
// Inside VideoBlock
libraryId?: string;          // ID of the MediaLibrary (type="video")
selectionRule?: "oldest_used" | "least_used" | "manual";
```

---

## Selection Rules Reference

| Rule | Applies to | Behaviour |
|------|-----------|-----------|
| `oldest_used` | Video, Audio | Pick the asset with the oldest `lastUsedAt` (or never used, i.e. `null`, first) |
| `least_used` | Video, DataEntry | Pick the one with the lowest `usageCount` |
| `not_used_in_cycle` | DataEntry | Pick any entry where `usedInCycle = false`; fall back to `least_used` if all used |
| `manual` | All | No auto-selection — show the library picker for user to choose |

After a render completes (`RenderStatus.DONE`):
- Increment `usageCount` and set `lastUsedAt = now()` on each used asset/entry.
- Set `usedInCycle = true` on each used `DataEntry`.

---

## Implementation Phases

Work through phases sequentially. Each phase has a clear deliverable and
validation step. Do not skip ahead — later phases depend on earlier ones being
stable.

---

### Phase 1 — Prisma Schema

**Files:** `web/prisma/schema.prisma`

1. Add the four models above (`MediaLibrary`, `MediaAsset`, `DataLibrary`,
   `DataCampaign`, `DataEntry`).
2. Run `cd web && npm run db:generate && npm run db:push`.
3. Verify no migration errors.

**Deliverable:** DB tables created, Prisma client regenerated.

---

### Phase 2 — Admin API Routes

**Files:** `web/src/app/api/admin/libraries/`

Create REST endpoints under `/api/admin/libraries/`:

```
GET    /api/admin/libraries/media           — list MediaLibrary (+ asset count)
POST   /api/admin/libraries/media           — create MediaLibrary
DELETE /api/admin/libraries/media/[id]      — delete (cascade deletes assets)

GET    /api/admin/libraries/media/[id]/assets     — list MediaAsset
POST   /api/admin/libraries/media/[id]/upload     — upload + probe → R2 → MediaAsset
DELETE /api/admin/libraries/media/assets/[id]     — delete asset (+ R2 cleanup)

GET    /api/admin/libraries/data            — list DataLibrary (+ campaign count)
POST   /api/admin/libraries/data            — create DataLibrary
DELETE /api/admin/libraries/data/[id]       — delete

GET    /api/admin/libraries/data/[id]/campaigns     — list DataCampaign
POST   /api/admin/libraries/data/[id]/campaigns     — create DataCampaign
POST   /api/admin/libraries/data/campaigns/[id]/import  — CSV/XLSX import → DataEntry[]
POST   /api/admin/libraries/data/campaigns/[id]/reset   — set usedInCycle=false on all entries
DELETE /api/admin/libraries/data/campaigns/[id]    — delete campaign
```

**Security rules:**
- All routes require admin role check (use existing `requireAdmin` pattern from
  `web/src/lib/userContext.ts` or `web/src/lib/permissions.ts`).
- Upload route: validate MIME type server-side (only `video/*` and `audio/*`).
- CSV import: parse server-side, reject files > 5 MB, sanitise all fields before
  inserting.

**R2 upload pattern:**
Follow the same pattern used in captions/derush uploads:
`web/src/app/api/transcription/` and `web/src/lib/runpod.ts` for R2 key
conventions. Use `content-library/videos/` and `content-library/audio/` as R2
key prefixes.

**Deliverable:** All admin routes functional, tested via manual curl or UI.

---

### Phase 3 — Admin UI

**Files:** `web/src/components/admin/libraries/`, `web/src/app/(app)/admin/libraries/`

Create a dedicated "Bibliothèques" section in the admin panel.

UI structure:
```
/admin/libraries
  /admin/libraries/media        — MediaLibrary list + create
  /admin/libraries/media/[id]   — asset list + upload, delete
  /admin/libraries/data         — DataLibrary list + create
  /admin/libraries/data/[id]    — campaign list + create
  /admin/libraries/data/[id]/[campaignId] — entry list + CSV import + cycle reset
```

Key UX notes (follow the ui-ux-remediation skill conventions):
- Show `usageCount` and `lastUsedAt` per asset — helps verify rotation is
  working.
- In DataCampaign view, show how many entries are `usedInCycle=true` vs not.
- "Reset cycle" button must require a confirmation dialog.
- Only one `DataCampaign` can be `isActive=true` per `DataLibrary` — enforce
  this in the UI (toggle-style activation that deactivates the previous one).

**Deliverable:** Admin can manage all three library types without touching the DB
directly.

---

### Phase 4 — Builder Integration

**Files:**
- `web/src/types/template.ts` — extend `VideoBlock`
- `web/src/components/builder/` — VideoBlock panel sidebar

Add to the `VideoBlock` properties panel in the builder:
- **Library** dropdown: fetches available `MediaLibrary` of type "video" via
  `/api/admin/libraries/media`, sets `block.libraryId`.
- **Selection rule** dropdown: `oldest_used | least_used | manual`. Only visible
  when `libraryId` is set.

Add to the template settings panel (top-level config):
- **Audio library** dropdown (type="audio"), sets `template.audioLibraryId`.
- **Audio selection rule**, sets `template.audioSelectionRule`.
- **Data library** dropdown, sets `template.dataLibraryId`.
- **Data campaign** dropdown (filtered by selected library, only active ones),
  sets `template.dataCampaignId`.
- **Data selection rule**, sets `template.dataSelectionRule`.

**Important:** These fields are purely metadata stored in `Template.jsonData`.
Do not trigger a re-render of the preview when they change — they have no visual
effect in the builder.

**Deliverable:** A template can be fully configured with library bindings and
saved.

---

### Phase 5 — Generation Form Pre-fill

**Files:**
- `web/src/app/(app)/` generation form component
- `web/src/lib/contentLibraryResolver.ts` (new helper)

Create `web/src/lib/contentLibraryResolver.ts`:

```typescript
// Resolves a template's library config into concrete pre-filled values
// for the generation form.
export async function resolveLibraryPrefill(templateId: string): Promise<{
  videoSuggestions: Record<string, MediaAsset>; // blockId → suggested asset
  audioSuggestion: MediaAsset | null;
  dataSuggestion: DataEntry | null;
}>;
```

Logic per rule:
- `oldest_used`: `ORDER BY lastUsedAt ASC NULLS FIRST LIMIT 1`
- `least_used`: `ORDER BY usageCount ASC LIMIT 1`
- `not_used_in_cycle`: `WHERE usedInCycle = false ORDER BY usageCount ASC LIMIT 1`,
  fall back to `least_used` if empty
- `manual`: return `null` — form shows the library picker, user selects manually

In the generation form:
- Call `resolveLibraryPrefill` when the template has at least one library binding.
- Pre-fill the video picker for each `VideoBlock` that has a `libraryId`.
- Pre-fill the audio picker.
- Pre-fill text fields from `DataEntry.fields` (map field names to form field names
  by convention — document the convention in the `DataLibrary.templateType`).
- Show a **"Selected from library"** badge on pre-filled fields so the user knows
  they were auto-selected.
- The user can override any pre-filled field before launching.

**After the render completes** (in the render status update handler in
`web/src/app/api/renders/`):
- Call a helper `recordLibraryUsage(renderId)` that increments `usageCount`,
  sets `lastUsedAt`, and sets `usedInCycle = true` for all assets/entries that
  were used in this render.
- Store which assets were used as JSON in `Render` or as a separate join table
  (start with a JSON field `usedAssets` on `Render` — a join table is only
  needed if querying by asset becomes necessary).

**Deliverable:** Generating a template with library bindings pre-fills the form
and updates usage counters after completion.

---

### Phase 6 — Batch Generation (V2)

> Do not implement until Phase 5 is stable in production.

Batch allows generating N videos at once from a DataCampaign without manual
review of each form.

High-level design:
- User selects template + campaign → previews the N resolved pre-fills as a
  table (one row = one DataEntry).
- User can adjust individual rows before confirming.
- Confirm → enqueue N `Render` jobs (use existing render queue).
- Show batch progress in a dedicated view.

Key invariant: the batch must consume entries in the same order the resolver
would (respects selection rules), and must not double-pick the same asset across
rows of the same batch run.

---

## Field Mapping Convention (Data Library → Form)

Each `DataLibrary.templateType` has a known set of field names. Document them
here as they are created. These names must be stable — changing them breaks
existing `DataEntry` records.

| templateType | DataEntry fields |
|-------------|-----------------|
| `RPI` | `quartier`, `arrondissement`, `prix_m2`, `evo_5ans_pct` |
| `RTIPS` | `hook`, `theme`, `tip1`, `tip2`, `tip3` |

Add new rows to this table when adding a new template type. The form pre-fill
logic maps these field names to form input names — keep naming consistent.

---

## Files to Know

| File | Role |
|------|------|
| `web/prisma/schema.prisma` | Add the 4 new models here |
| `web/src/types/template.ts` | Extend `VideoBlock` and `TemplateJSON` |
| `web/src/lib/contentLibraryResolver.ts` | Selection rule engine (create) |
| `web/src/app/api/admin/libraries/` | Admin CRUD + upload routes (create) |
| `web/src/components/builder/` | VideoBlock panel + template settings panel |
| `web/src/app/api/renders/` | Post-render usage tracking hook |
| `web/src/lib/permissions.ts` | Check admin gate before using this in new routes |

---

## Warnings and Invariants

- **Never skip Phase order.** The builder (Phase 4) writes library IDs into
  `Template.jsonData`. If those IDs don't exist in the DB (Phase 1–2 not done),
  the resolver silently returns nulls.
- **usage tracking must be atomic.** Increment counters only on `RenderStatus.DONE`,
  not on `PROCESSING`. A failed render must not consume the asset.
- **Cycle reset is destructive.** Always confirm before calling
  `campaigns/[id]/reset`. It cannot be undone.
- **R2 key cleanup on asset delete.** When deleting a `MediaAsset`, always delete
  the R2 object first, then the DB row. If R2 delete fails, abort and surface the
  error — do not leave orphaned DB rows pointing to missing R2 keys.
- **One active campaign per DataLibrary.** Enforce both in the API and the UI.
  If activating a new campaign, deactivate the previous one in the same
  transaction.
- **Builder fields are purely metadata.** `libraryId` and `selectionRule` on a
  `VideoBlock` have zero effect on the builder preview or the HTML render — they
  are only read by the generation form resolver. Do not add logic for them in
  `buildHTML.ts` or the canvas layer.
- **Security:** All admin library routes must check admin role. The `resolveLibraryPrefill`
  call in the generation form should only read public asset URLs — never expose
  raw R2 keys to the client.
