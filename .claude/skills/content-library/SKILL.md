---
name: content-library
description: >
  Work with the Content Library system in Toolbox Immo. Use when a task involves
  MediaLibrary, MediaAsset (setTag, category, tags, setSequence), MediaAssetAccess,
  MediaAssetUsage, DataLibrary, DataCampaign, DataEntry, library-to-VideoBlock bindings
  in the builder, generation form pre-fill, asset rotation (auto mode or override mode),
  selection rules (theme_sequence, oldest_used, least_used, not_used_in_cycle, manual),
  AccountLibraryCursor, per-account usage isolation, bulk asset operations, asset editing
  via RunPod, or MediaAutocutJob batch autocut (Whisper-based
  cut-point detection, review queue, and apply flow).
  For deep rotation algorithm details (auto mode, category exclusion, per-account ordering,
  how to simulate or debug rotation): load the asset-rotation skill instead.
---

# Content Library

The Content Library system is a shared asset and data management layer that sits
**before** the generation form. Libraries are admin-managed and shared across multiple
Instagram accounts (négociateurs).

Three distinct library types exist:

| Type | Model | What it holds |
|------|-------|---------------|
| Video | `MediaLibrary` (type="video") | Rush videos uploaded to R2 |
| Audio | `MediaLibrary` (type="audio") | Music tracks uploaded to R2 |
| Data | `DataLibrary` + `DataCampaign` + `DataEntry` | Text data per template type (RPI, RTIPS…) |

---

## Architecture

```
Admin UI
  └── creates/uploads MediaLibrary + MediaAsset (video, audio)
  └── tags assets: free-form tags[] + setTag (UI label « Groupe ») + category (UI label « Catégorie », family for rotation exclusion)
  └── restricts assets per account: MediaAssetAccess (0 rows = global)
  └── views rotation per account: account filter on MediaAssetsPanel
  └── orders MediaLibrary.setSequence: explicit setTag override list (optional)
  └── creates DataLibrary → DataCampaign → DataEntry (CSV import)
  └── edits/trims MediaAsset via RunPod media-edit job (async, webhook)

Builder
  └── VideoBlock → libraryId + selectionRule (theme_sequence | oldest_used | least_used | manual)
  └── Template-level → first MusicBlock with libraryId + audioSelectionRule
  └── Template-level → contentLibrary: { dataLibraryId, dataCampaignId, dataSelectionRule }

Generation form (server component)
  └── contentLibraryResolver.ts → resolveLibraryPrefill(template, formData, accountId)
  └── theme_sequence rule: selectMediaAssetBySetSequence() — auto mode or override mode
  └── other rules: selectMediaAsset() — per-account usage ordering via MediaAssetUsage
  └── user reviews and confirms before launching render

Post-render (webhook DONE)
  └── recordLibraryUsage() increments global MediaAsset.usageCount + lastUsedAt
  └── recordLibraryUsage() upserts per-account MediaAssetUsage row
  └── advances AccountLibraryCursor (lastUsedCategory, lastUsedSetTag, cursor) per account
```

---

## Prisma Models

All models in `web/prisma/schema.prisma`.

After any schema change: `cd web && npm run db:generate && npm run db:push`

### MediaLibrary (video or audio)

Key fields:
- `setSequence String @default("[]")` — JSON `string[]`, **optional** explicit ordered list of setTags.
  When empty: auto mode (rotation by least-recently used group + category exclusion).
  When non-empty: override mode (integer cursor cycles through the list).
- `tags String @default("[]")` — JSON `string[]`, type labels used for filtering in admin.

### MediaAsset

Key fields:
- `setTag String?` — set identifier. Groups assets from the same shoot (e.g. `"tenue1-set1"`).
  The rotation unit is the `(category, setTag)` pair.
- `category String?` — family. Groups sets from the same model/location (e.g. `"Tenue 1"`).
  The category exclusion rule prevents two consecutive sets from the same category.
- `tags String[] @default([])` — free-form keyword array (e.g. `["lola", "intro"]`). Filtered via ILIKE.
- `usageCount Int @default(0)` / `lastUsedAt DateTime?` — **global** aggregates updated by `recordLibraryUsage()`.
- `accesses MediaAssetAccess[]` — access restriction entries (0 rows = accessible to everyone).
- `usages MediaAssetUsage[]` — per-account usage records for isolated rotation ordering.

### MediaAssetAccess

```
assetId   String
accountId String
@@unique([assetId, accountId])
```

Access semantics: **0 rows for an asset = global (all accounts can use it)**.
1+ rows = restricted to only the listed accounts.
When the admin adds a restriction, other accounts lose access immediately.

### MediaAssetUsage

```
assetId    String
accountId  String
lastUsedAt DateTime?
usageCount Int @default(0)
@@unique([assetId, accountId])
```

Tracks each account's individual usage of an asset. Used by the resolver for per-account
ordering (least-recently used by **this account**, not globally). Created/updated by
`recordLibraryUsage()` on each DONE render.

### AccountLibraryCursor

```
accountId        String
libraryId        String
cursor           Int       @default(0)   // index in setSequence (override mode only)
lastUsedSetTag   String?                 // last picked setTag (auto + override)
lastUsedCategory String?                 // last picked category (auto mode: category exclusion)
lastAdvancedAt   DateTime?
@@unique([accountId, libraryId])
```

One row per (account, library) pair. Created on first use. Advanced by `recordLibraryUsage()`
only on `DONE` renders.

### Data models

- `DataEntry.usedInCycle Boolean` — set `true` after use; reset by campaign reset endpoint.
- `DataCampaign.isActive Boolean` — only one per `DataLibrary` may be active at a time.

### Render.usedAssets JSON

```json
{
  "videoAssets": { "blockId": "assetId" },
  "audioAssetId": "...",
  "dataEntryId": "...",
  "setSequencedLibraryIds": ["libraryId1"],
  "usedSetTagByLibrary": { "libraryId1": "tenue1-set1" },
  "usedCategoryByLibrary": { "libraryId1": "Tenue 1" }
}
```

`setSequencedLibraryIds` → libraries whose cursor must be advanced post-render.
`usedSetTagByLibrary` / `usedCategoryByLibrary` → written to `AccountLibraryCursor` so the
next generation can apply the category exclusion rule correctly.

---

## Asset Organisation: Set + Category

| Concept | Field | Description |
|---------|-------|-------------|
| **Set** | `MediaAsset.setTag` | Assets from the same shoot (intro + outro filmed together). Rotation unit. |
| **Category** | `MediaAsset.category` | Family of sets (same model, location, or theme). Used for category exclusion in auto mode. |
| **Access** | `MediaAssetAccess` | Which accounts can use an asset. 0 rows = everyone. |
| **Usage** | `MediaAssetUsage` | Per-account `lastUsedAt` + `usageCount`. Drives rotation ordering per account. |

The rotation unit is always the `(category, setTag)` pair, not just `setTag`.
Two sets with the same `setTag` but different `category` are treated as separate groups.

---

## Selection Rules

| Rule | Applies to | Behaviour |
|------|-----------|-----------|
| `theme_sequence` | Video | Auto mode or override mode — see asset-rotation skill |
| `oldest_used` | Video, Audio | Per-account: JOIN MediaAssetUsage, ORDER BY mau.lastUsedAt ASC NULLS FIRST. Without accountId: global MediaAsset.lastUsedAt. |
| `least_used` | Video, Audio | Per-account: JOIN MediaAssetUsage, ORDER BY COALESCE(mau.usageCount,0) ASC. Without accountId: global MediaAsset.usageCount. |
| `not_used_in_cycle` | DataEntry | Pick entry where `usedInCycle = false`; fall back to `least_used`. |
| `manual` | All | No auto-selection — user picks manually. |

Access filter always applied:
- With `accountId`: `(NOT EXISTS access) OR (EXISTS access WHERE accountId = ?)`.
- Without `accountId`: `NOT EXISTS access` (global-only pool).

Resolver: `web/src/lib/contentLibraryResolver.ts` → `resolveLibraryPrefill(template, formData?, accountId?)`.

---

## Admin API Routes

**Base:** `web/src/app/api/admin/libraries/`

```
GET    /media                              — list MediaLibrary
POST   /media                              — create MediaLibrary
PATCH  /media/[id]                         — update name, description, tags, setSequence
DELETE /media/[id]                         — delete (cascade assets)

GET    /media/[id]/assets                  — list MediaAsset; ?accountId= for per-account stats
POST   /media/[id]/upload                  — upload + probe → R2 → MediaAsset
PATCH  /media/assets/[assetId]             — update fields (see body below)
PATCH  /media/[id]/assets/bulk             — bulk update setTag or tags
DELETE /media/assets/[assetId]             — delete asset (+ R2 cleanup)
POST   /media/assets/[assetId]/edit        — submit RunPod media-edit job

GET    /data                               — list DataLibrary
POST   /data                               — create DataLibrary
DELETE /data/[id]                          — delete
GET    /data/[id]/campaigns                — list DataCampaign
POST   /data/[id]/campaigns                — create DataCampaign
POST   /data/campaigns/[id]/import         — CSV import → DataEntry[]
POST   /data/campaigns/[id]/reset          — set usedInCycle=false on all entries
DELETE /data/campaigns/[id]                — delete campaign
```

### Asset PATCH body

```typescript
{
  setTag?: string | null;           // auto-appends to library.setSequence if new
  category?: string | null;         // family label
  tags?: string[];                  // replaces all tags
  usageCount?: number;              // direct set (global counter, not per-account)
  lastUsedAt?: string | null;       // ISO date string or null (global)
  resetUsage?: boolean;             // usageCount=0, lastUsedAt=null + deleteMany MediaAssetUsage
  resetUsageForAccount?: string;    // deleteMany MediaAssetUsage WHERE accountId = ? only
  accessAccountIds?: string[];      // replace all MediaAssetAccess entries atomically
}
```

`resetUsage: true` → clears global counters AND all per-account MediaAssetUsage rows.
`resetUsageForAccount: "accountId"` → clears only that account's MediaAssetUsage row.
`accessAccountIds: []` → makes asset global again (removes all restrictions).

### GET /media/[id]/assets with ?accountId=

Returns each asset with:
- `accessAccountIds: string[]` — which accounts have explicit access.
- `lastUsedAt`, `usageCount` — the **per-account** values from `MediaAssetUsage` when `?accountId=` is provided.

---

## Media-Edit Async Flow (RunPod)

```
POST /admin/libraries/media/assets/[assetId]/edit
  → submitRunpodJob() with job_type: "media_edit"
  → asset updated to pending state

RunPod → POST /api/webhooks/runpod/media-edit
  → verifyRunpodWebhook() checks X-Webhook-Secret
  → updates MediaAsset.url / r2Key / duration on success
```

Webhook helper: `web/src/lib/webhooks/runpod.ts`
Webhook route: `web/src/app/api/webhooks/runpod/media-edit/route.ts`

---

## Media Autocut (Batch Whisper Cut Detection)

Autocut is an admin-only feature that uses Whisper (via RunPod) to detect the real
start/end of speech in rush videos, then proposes trim points that an admin reviews
before applying.

### Prisma Model

```prisma
model MediaAutocutJob {
  id              String   @id @default(cuid())
  libraryId       String
  assetId         String?  @unique   // null during batch pending state
  batchId         String?            // groups jobs from the same batch submission
  runpodJobId     String?
  status          String   @default("pending")  // pending | processing | done | failed | cut
  proposedStart   Float?
  proposedEnd     Float?
  confirmedStart  Float?
  confirmedEnd    Float?
  transcriptJson  String?  // JSON word-timestamps array
  language        String?
  fallback        Boolean  @default(false)
  error           String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

Status flow: `pending → processing → done | failed → cut` (after admin applies).

### Batch Submission Flow

```
Admin UI (MediaBatchAutocutPanel) — step 1: select assets
  → POST /api/admin/libraries/media/[id]/autocut-packs
      body: { assetIds: string[] }
      → groups assets into batches (e.g. 20 per RunPod job)
      → creates MediaAutocutJob rows (status: pending, assetId null, batchId set)
      → submits RunPod job_type: "media_autocut_batch"
          input: { batch_id, assets: [{ job_id, url, language? }] }
      → returns { batches, skipped }

RunPod worker (_handle_media_autocut_batch)
  → calls analyze_autocut() (engine/autocut.py) per asset
  → analyze_autocut() uses transcribe_with_word_timestamps() (Whisper)
  → returns proposed start/end from first/last detected word + padding
  → responds with { batch_id, results: [{ job_id, proposed_start, proposed_end,
      transcript_json, language, fallback?, error? }] }

RunPod → POST /api/webhooks/runpod/media-autocut
  → verifyRunpodWebhook()
  → resolves each result by job_id
  → on success: updates MediaAutocutJob (status: done, proposedStart/End, transcriptJson)
  → on error per job: status failed, error message
  → on global webhook failure: marks all pending jobs in batch as failed
```

Webhook route: `web/src/app/api/webhooks/runpod/media-autocut/route.ts`
Engine: `render-engine/engine/autocut.py` → `analyze_autocut()`
Worker handler: `render-engine/runpod_worker.py` → `_handle_media_autocut_batch()`

### Review & Apply Flow

```
Admin UI (MediaBatchAutocutPanel) — step 2: review
  → GET /api/admin/libraries/media/[id]/autocut-queue
      → returns paginated MediaAutocutJob[] with status=done (not yet cut)
      → includes proposedStart/End, transcriptJson, assetId

Admin reviews each job (AutocutReviewCard):
  → previews video segment with proposed cut points
  → adjusts confirmedStart / confirmedEnd if needed
  → PATCH /api/admin/libraries/media/autocut/[jobId]
      body: { action: "skip" } | { action: "apply", confirmedStart, confirmedEnd }
      → "skip": deletes the MediaAutocutJob
      → "apply": validates, calls MediaAsset update (trimStart/trimEnd or re-upload),
                  sets job status to "cut"

Batch apply (optional):
  → POST /api/admin/libraries/media/[id]/batch-apply
      → applies all done jobs with proposedStart/End as confirmed values
      → marks each as "cut"
```

### Reset

```
DELETE /api/admin/libraries/media/[id]/autocut-jobs
  → deletes all MediaAutocutJob for the library where status != "cut"
  → used to clean up a stale batch before resubmitting
```

### Admin UI Components

- `web/src/components/admin/libraries/MediaBatchAutocutPanel.tsx`
  Two-step panel: "select" view (asset multi-select + submit) → "review" view.
  Polls `autocut-queue` every 5 seconds while jobs are processing.
- `web/src/components/admin/libraries/AutocutReviewCard.tsx`
  Individual review card: video player, timeline scrubber, confirm/skip actions.

### Key Pitfalls

- Autocut only applies to **video** MediaLibraries. Audio libraries have no autocut trigger.
- `assetId` on `MediaAutocutJob` is null until the RunPod batch resolves individual job IDs.
- `fallback: true` means Whisper produced segments but no word-level timestamps → start/end
  are less precise (segment-level bounds used instead of word-level bounds).
- If a batch RunPod webhook arrives with a global error (no `results`), all pending jobs in
  the batch are marked `failed`. Check `batchId` to correlate them.
- `analyze_autocut` raises `RuntimeError` if Whisper returns no segments at all (silent video).
  The worker catches this and returns an error result for that job_id.

---

## Admin UI

**Files:** `web/src/components/admin/libraries/`, `web/src/app/(app)/admin/libraries/`

Components: `MediaLibrariesPanel`, `MediaAssetsPanel`, `MediaAssetEditModal`,
`DataLibrariesPanel`, `DataCampaignsPanel`, `DataEntriesPanel`.

### MediaAssetsPanel — view modes

- **Grid** (`viewMode = "grid"`): all filtered assets, each card shows access chips + per-account stats when filter active.
- **Rotation** (`viewMode = "rotation"`): groups listed as rows ordered by simulated rotation rank.
  - Each group shows rank badge, category badge, setTag badge, rush count (accessible only), last used date.
  - Inaccessible groups (to the filtered account) are dimmed with a lock badge and pushed to end.
- **Grouped** (`viewMode = "grouped"`): groups as columns, organised by category sections.
  - Within each section, columns are sorted by setTag.
  - Inaccessible columns are dimmed and separated.

### Account filter

- Selector in the filter bar: `?accountId=` passed to GET assets.
- When active, stats (usageCount, lastUsedAt) show per-account values from `MediaAssetUsage`.
- Inline editing of usageCount and lastUsedAt is **disabled** when account filter active — those edits would update global counters, which is wrong when viewing per-account data.
- Reset button sends `{ resetUsageForAccount }` instead of `{ resetUsage: true }` when filter active.
- `isAccessible` flag per group: computed from `accessAccountIds` on each asset. Used to dim inaccessible groups and exclude them from the simulated rotation rank.
- Individual asset cards are also dimmed (opacity-50) when the asset is inaccessible to the filtered account.

### Group rush count

Always shows the count of assets accessible to the filtered account (not total).
Without accountFilter, shows total.

### General UX rules

- In DataCampaign view, show how many entries are `usedInCycle=true` vs not.
- "Reset cycle" button must require a confirmation dialog.
- Only one `DataCampaign` can be `isActive=true` per `DataLibrary`.

---

## Generation Form Pre-fill

`web/src/lib/contentLibraryResolver.ts` → `resolveLibraryPrefill(template, formData?, accountId?)`:

```typescript
interface LibraryPrefill {
  videoSuggestions: Record<string, { id: string; url: string; filename: string }>;
  audioSuggestion: { id: string; url: string; filename: string } | null;
  dataSuggestion: { entryId: string; fields: Record<string, string> } | null;
  setSequencedLibraryIds?: string[];
  usedSetTagByLibrary?: Record<string, string>;
  usedCategoryByLibrary?: Record<string, string>;
}
```

- Regular video blocks (non theme_sequence): `selectMediaAsset()` — per-account ordering when `accountId` present.
- theme_sequence blocks: `selectMediaAssetBySetSequence()` — auto or override mode.
  Without `accountId`: still returns a suggestion (global pool, no cursor advance at post-render).
- Multiple `VideoBlock`s bound to the same library → first block discovers the set, subsequent blocks receive the same `pinnedSetTag`.
- `usedSetTagByLibrary` / `usedCategoryByLibrary` flow through `Render.usedAssets` to `recordLibraryUsage()`.

`setSequencedLibraryIds` flows:
1. `resolveLibraryPrefill()` → `LibraryPrefill`
2. `generate/[templateId]/page.tsx` → form context
3. `ListingForm.tsx` → `buildUsedAssets()`
4. `POST /api/renders` → `Render.usedAssets`
5. `recordLibraryUsage(renderId)` → advances `AccountLibraryCursor`

---

## recordLibraryUsage (post-render)

`web/src/lib/recordLibraryUsage.ts` — called when `Render.status = DONE`:

1. For each video asset: `MediaAsset.update` (global usageCount++) + `MediaAssetUsage.upsert` (per-account).
2. For audio asset: same pattern.
3. For each setSequenced library: upsert `AccountLibraryCursor` with `lastUsedSetTag`, `lastUsedCategory`, advance `cursor` if override mode.
4. For data entry: `DataEntry.update` (usageCount++, usedInCycle=true).

Never throws — all errors are caught and logged; render already succeeded.

---

## Field Mapping Convention (Data Library → Form)

Field names in `DataEntry.fields` are stable identifiers.

| templateType | DataEntry fields |
|-------------|-----------------|
| `RPI` | `nom`, `prix_m2`, `evo_5ans_pct`, `annotation` |
| `RTIPS` | `hook`, `theme`, `tip1`, `tip2`, `tip3` |

---

## Planned: DataEntry Rotation Parity

The following are NOT yet implemented but planned (mirrors the MediaAsset pattern):

- `DataEntry.category` — family grouping (e.g. "IDF", "Paris intra-muros").
- `DataEntry.setTag` — links a local entry to its reference row (e.g. Paris global).
- `DataEntry.isReference Boolean` — reference rows (Paris global) never consumed in rotation.
- `DataEntryAccess` — per-account access restriction (same semantics as MediaAssetAccess).
- `DataEntryUsage` — per-account usage counters (same semantics as MediaAssetUsage).
- `selectDataEntry()` updated to apply access filter + per-account usage ordering.
- CSV import updated to read `setTag`, `category`, `is_reference` columns.

---

## Future: Offer-based Automation

Not yet implemented.

**Goal:** Given a property listing, automatically pick the right library and tags filter.

**Proposed approach:**
- Add `offerRules` JSON to `MediaLibrary`.
- Resolver scores libraries against form values → highest score wins.
- `tagFilter` on `VideoBlock` driven by offer (e.g. `"intro"` for first block).

**Constraints to keep:**
- `setSequence` cursor and `AccountLibraryCursor` remain the single source of truth for rotation position. Offer-based selection only affects *which* library is chosen, not how rotation advances.
- Offer-based pre-selection should degrade gracefully to `manual` if no library matches.
- Do not implement until the current `set_sequence` rule is stable in production.

**Batch generation (V2):** Select template + campaign → preview N pre-fills as table → confirm →
enqueue N `Render` jobs. Must respect `setSequence` and not double-pick assets across rows.
Implement after offer-based automation is decided.

---

## Key Files

| File | Role |
|------|------|
| `web/prisma/schema.prisma` | All content library models incl. `AccountLibraryCursor` |
| `web/src/types/template.ts` | `VideoBlock` and `TemplateJSON` library fields |
| `web/src/types/libraryPrefill.ts` | `LibraryPrefill` interface with `setSequencedLibraryIds` |
| `web/src/lib/contentLibraryResolver.ts` | Selection rule engine + `selectMediaAssetBySetSequence` |
| `web/src/lib/recordLibraryUsage.ts` | Post-render usage + cursor advancement |
| `web/src/app/api/admin/libraries/` | Admin CRUD + upload + bulk routes |
| `web/src/app/api/admin/libraries/media/assets/[assetId]/edit/` | Asset-edit RunPod submission |
| `web/src/app/api/webhooks/runpod/media-edit/` | Asset-edit completion webhook |
| `web/src/lib/webhooks/runpod.ts` | Shared webhook auth + body parse helpers |
| `web/src/components/admin/libraries/` | Admin UI panels |
| `web/src/app/(app)/admin/libraries/media/[id]/page.tsx` | Passes `setSequence` to `MediaAssetsPanel` |
| `web/src/app/api/renders/` | Post-render hook that calls `recordLibraryUsage` |

---

## Invariants

- **Resolver nulls on missing IDs.** Deleted library → `resolveLibraryPrefill` returns `null`, no throw.
- **Usage tracking on DONE only.** Failed renders must not consume assets or advance cursors.
- **Cursor advance uses sequence.length at the time of render.** If sequence shrinks between generation and usage tracking, `% length` still gives a valid index.
- **setSequence is append-only from the asset PATCH.** Auto-append never removes or reorders. Reordering is always explicit (admin UI or direct PATCH).
- **Multiple blocks, same library → pinnedSetTag.** All blocks in one generation that share a library must resolve the same set. The resolver pins the setTag after the first resolution.
- **Cycle reset is destructive.** Always confirm first.
- **R2 cleanup on asset delete.** Delete R2 object first, then DB row. Abort if R2 delete fails.
- **One active campaign per DataLibrary.** Enforce in API and UI.
- **Builder fields are metadata only.** `libraryId` / `selectionRule` on `VideoBlock` have no effect on `buildHTML.ts` or canvas rendering.

