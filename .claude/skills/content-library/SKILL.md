---
name: content-library
description: >
  Work with the Content Library system in Toolbox Immo. Use when a task involves
  MediaLibrary, MediaAsset (setTag « Dossier », tags), MediaAssetAccess,
  MediaAssetUsage, DataLibrary, DataCampaign, DataEntry, library-to-VideoBlock bindings
  in the builder, generation form pre-fill, folder-draw selection,
  selection rules (theme_sequence, oldest_used, least_used, manual),
  per-account usage isolation, bulk asset operations, asset editing
  via RunPod, or MediaAutocutJob batch autocut (Whisper-based
  cut-point detection, review queue, and apply flow).
  For deep folder-draw algorithm details (ordering, usage claims, revert):
  load the asset-rotation skill instead.
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
| Data | `DataLibrary` + `DataEntry` (lien direct `DataEntry.libraryId` — `DataCampaign` décommissionnée Phase 4, drop N+1) | Text data per template type (RPI, RTIPS…) |

---

## Architecture

```
Admin UI
  └── creates/uploads MediaLibrary + MediaAsset (video, audio)
  └── tags assets: free-form tags[] + setTag (UI label « Dossier »)
  └── restricts assets per account: MediaAssetAccess (0 rows = global)
  └── creates DataLibrary → DataEntry (CSV import, routes `data/[id]/entries*`)
  └── edits/trims MediaAsset via RunPod media-edit job (async, webhook)

Builder
  └── VideoBlock → libraryId + selectionRule (theme_sequence | oldest_used | least_used | manual)
  └── Template-level → first MusicBlock with libraryId + audioSelectionRule
  └── Template-level → contentLibrary: { dataLibraryId, dataCampaignId, dataSelectionRule }

Generation form (server component)
  └── contentLibraryResolver.ts → resolveLibraryPrefill(template, formData, accountId) — READ-ONLY
  └── theme_sequence rule: selectMediaAssetFromFolder() — folder draw (least-recently-served)
  └── other rules: selectMediaAsset() — per-account usage ordering via MediaAssetUsage
  └── user reviews and confirms before launching render

Submit (POST /api/renders)
  └── advanceMediaUsageOnSubmit() stamps MediaAssetUsage.lastUsedAt (claim, revertable)

Post-render (webhook DONE)
  └── recordLibraryUsage() increments global MediaAsset.usageCount + lastUsedAt
  └── recordLibraryUsage() upserts per-account MediaAssetUsage row
```

---

## Prisma Models

All models in `web/prisma/schema.prisma`.

After any schema change: `cd web && npm run db:generate && npm run db:push`

### MediaLibrary (video or audio)

Key fields:
- `rotationMode String` — `"auto"` (folder draw) | `"none"` (metadata/manual selection).
- `rotationScope String` — `per_account` | `shared` (usage key = `__shared__` sentinel).
- `maxUsageCount Int?` — burn-once (null = infinite).
- `tags String @default("[]")` — JSON `string[]`, type labels used for filtering in admin.
- ⚠️ `setSequence` : colonne morte (mode override décommissionné, Phase 3) — drop au deploy N+1.

### MediaAsset

Key fields:
- `setTag String?` — « Dossier » (UI). Groups assets from the same shoot (e.g. `"tenue1-set1"`).
  The draw unit. `null` = « (sans dossier) » virtual folder.
- ⚠️ `category` : colonne morte (exclusion famille décommissionnée, Phase 3) — drop au deploy N+1.
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

### AccountLibraryCursor (DÉCOMMISSIONNÉ)

Table morte depuis la Phase 3 (folder draw, zéro état) — plus aucune
lecture/écriture dans le code ; drop au deploy N+1. L'ancienneté des dossiers
vit entièrement dans `MediaAssetUsage.lastUsedAt`.

### Data models

- `DataEntry.libraryId` — lien direct vers la lib (Phase 4). `selectDataEntry(libraryId, rule, accountId)`
  = tirage dossier, `advanceDataUsageOnSubmit` = claim au submit (sentinel `__shared__data__` en shared).
- ⚠️ morts (drop N+1) : `DataEntry.campaignId`/`category`/`usedInCycle`, table `DataCampaign`,
  table `AccountDataLibraryCursor`.

### Render.usedAssets JSON

```json
{
  "videoAssets": { "blockId": "assetId" },
  "audioAssetId": "...",
  "dataEntryId": "...",
  "setSequencedLibraryIds": ["libraryId1"],
  "usedSetTagByLibrary": { "libraryId1": "tenue1-set1" },
  "prevMediaUsageStates": [{ "assetId": "…", "accountId": "…", "prevLastUsedAt": null, "claimedLastUsedAt": "…" }]
}
```

`setSequencedLibraryIds` → libraries using folder draw (trace + shared usage stamping au DONE).
`usedSetTagByLibrary` → dossier servi (trace). `prevMediaUsageStates` → claims du submit,
revertés (CAS) si le render échoue.

---

## Asset Organisation: Dossier

| Concept | Field | Description |
|---------|-------|-------------|
| **Dossier** | `MediaAsset.setTag` | Assets from the same shoot (intro + outro filmed together). The draw unit. |
| **Access** | `MediaAssetAccess` | Which accounts can use an asset. 0 rows = everyone. |
| **Usage** | `MediaAssetUsage` | Per-account `lastUsedAt` + `usageCount`. Drives draw ordering per account. |

---

## Selection Rules

| Rule | Applies to | Behaviour |
|------|-----------|-----------|
| `theme_sequence` | Video | Folder draw (least-recently-served folder) — see asset-rotation skill |
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
PATCH  /media/[id]                         — update name, description, tags, rotationMode/scope, maxUsageCount
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
before applying. **Nothing triggers it automatically** — no upload hook, no cron, no
library setting. Every analysis starts from an admin action.

### Prisma Models

```prisma
/// One RunPod job = one pack of N assets (Whisper loaded once per pack).
model MediaAutocutBatch {
  id         String  @id @default(cuid())
  libraryId  String
  status     String  @default("pending")   // pending | processing | done | partial | failed
  totalCount Int     @default(0)
  doneCount  Int     @default(0)
  failCount  Int     @default(0)
  runpodId   String? @unique
  errorMsg   String?
  jobs       MediaAutocutJob[]
}

/// Whisper analysis of ONE asset. Two orthogonal axes: worker status + admin review.
model MediaAutocutJob {
  id             String  @id @default(cuid())
  assetId        String                              // required, NOT unique — latest job per asset wins in the UI
  libraryId      String
  batchId        String?
  status         String  @default("pending")         // pending | processing | done | failed
  reviewStatus   String  @default("pending_review")  // pending_review | accepted | skipped | applied
  proposedStart  Float?
  proposedEnd    Float?
  confirmedStart Float?                              // admin-adjusted; pre-filled with proposed on success
  confirmedEnd   Float?
  transcriptJson String?                             // JSON [{ text, start, end }] — sentence-level only
  language       String?
  editJobId      String? @unique                     // MediaEditJob created by the apply
  errorMsg       String?
}
```

`status` flows `pending → processing → done | failed`. `reviewStatus` flows
`pending_review → accepted → applied` (or `skipped`). There is **no `cut` status**: a
"cut" asset is one whose latest job has `reviewStatus === "applied"` (derived in the UI).
Shared vocabulary and `REVIEWABLE_FILTER` (`done` + `pending_review`, the only thing worth a
badge) live in `web/src/lib/mediaAutocut.ts` (pure, client-safe); DB helpers
(`applyAutocutBatchResults`, `failAutocutBatch`, `reconcileAutocutJobs`) in
`web/src/lib/mediaAutocutServer.ts`.

### Batch Submission Flow

```
Entry points:
  1. Atelier « Analyse auto » (MediaBatchAutocutPanel, select view) — only assets with
     no job or a failed job are selectable. Once analysed or cut, an asset is greyed out.
  2. « Relancer l'analyse » in the media panel bulk bar (MediaAssetsBulkActionBar →
     useBulkEdit.handleBulkRelaunchAutocut) — sends force: true and accepts ANY selected
     asset (analysed, accepted, applied). Disabled assets are filtered client-side (the
     API answers 403 for the whole lot otherwise). ConfirmDialog before sending.

  → POST /api/admin/libraries/media/[id]/autocut-packs
      body: { assetIds: string[], language?, modelSize?, force?: boolean }
      → skips (→ `skipped`) assets with a recent pending/processing autocut job
        AND assets with an active MediaEditJob (a trim in progress rewrites the file)
      → deletes the previous terminal job of each asset — one living analysis per asset:
          default: done/failed jobs that are NOT accepted/applied (editJobId null)
          force:   done/failed jobs whatever their reviewStatus (the MediaEditJob stays)
      → packs of PACK_SIZE = 10 → 1 MediaAutocutBatch + N MediaAutocutJob per pack
      → responds 202 { batches, skipped }, then dispatches RunPod in the background
        (2 packs in parallel), job_type: "media_autocut_batch"
          input: { batch_id, language, model_size, pack_budget_s,
                   assets: [{ job_id, asset_url, filename }] }

RunPod worker (_handle_media_autocut_batch)
  → calls analyze_autocut() (engine/autocut.py) per asset, within a per-item and a
    per-pack time budget (partial results are returned rather than nothing)
  → analyze_autocut() uses transcribe_with_word_timestamps() (Whisper)
  → returns proposed start/end from first/last detected word + padding
  → responds with { batch_id, results: [{ job_id, proposed_start, proposed_end,
      transcript_json, language, fallback?, error? }] }

RunPod → POST /api/webhooks/runpod/media-autocut
  → verifyAndParseRunpodWebhook() (HMAC, RUNPOD_WEBHOOK_SECRET)
  → applyAutocutBatchResults(): resolves each result by job_id
  → on success: status done, proposedStart/End, transcriptJson, confirmed* pre-filled
    (guarded by reviewStatus === "pending_review" so a replay never overwrites admin work)
  → on error per job: status failed + errorMsg; jobs without a result → failed
  → batch becomes done | partial | failed
```

Webhook route: `web/src/app/api/webhooks/runpod/media-autocut/route.ts`
Engine: `render-engine/engine/autocut.py` → `analyze_autocut()`
Worker handler: `render-engine/runpod_worker.py` → `_handle_media_autocut_batch()`

### Review & Apply Flow

```
Admin UI (MediaBatchAutocutPanel) — review view
  → GET /api/admin/libraries/media/[id]/autocut-queue?reviewStatus=pending_review&status=done
      (?summary=1 → { counts } from a groupBy — feeds the toolbar badge;
       ?lean=1 → no asset/editJob includes, statuses only)

Admin reviews each job (AutocutReviewCard):
  → previews the video with the proposed cut points, adjusts confirmedStart/End
  → PATCH /api/admin/libraries/media/autocut/[jobId]
      body: { reviewStatus: "accepted", confirmedStart, confirmedEnd } | { reviewStatus: "skipped" }
      (skip keeps the row — it is not deleted)
  → accept immediately calls POST /api/admin/libraries/media/[id]/batch-apply
      body: { jobIds?, mixToMono?, normalize?, gainDb? }   (jobIds omitted = all accepted)
      → creates one MediaEditJob per job (job_type "media_edit", trim — DESTRUCTIVE,
        overwrites the file on R2), sets reviewStatus "applied" + editJobId
```

### Reset

```
DELETE /api/admin/libraries/media/[id]/autocut-jobs
  → deletes every MediaAutocutJob of the library except reviewStatus "applied"
  → « Réinitialiser » in the atelier: cut files are never affected
```

### Admin UI Components

- `web/src/components/admin/libraries/MediaBatchAutocutPanel.tsx`
  Two views: "select" (asset list with derived per-asset status, failures grouped by
  cause in `AutocutFailuresSection`, submit) → "review". Polls every 5 s while jobs
  are pending/processing.
- `web/src/components/admin/libraries/AutocutReviewCard.tsx`
  Individual review card: video player, timeline scrubber, accept/skip actions.
- `web/src/components/admin/libraries/mediaAssets/MediaAssetsBulkActionBar.tsx`
  « Relancer l'analyse » (video libs, admin) — the forced re-analysis entry point.
- Toolbar badge on « Analyse auto » = `counts.reviewable`, fetched by
  `useMediaAssetsPolling.refreshAutocutCounts` on mount, on atelier close, and after a
  bulk relaunch.

### Key Pitfalls

- Autocut only applies to **video** MediaLibraries (the API answers 400 otherwise).
- `assetId` is required and not unique: an asset can carry several jobs over time and every
  display keeps the most recent one (`createdAt`). `autocut-packs` deletes the previous
  terminal job on resubmission so that per-row counters and per-asset display stay aligned.
- The trim is destructive: re-analysing an applied asset (`force`) analyses the current,
  already-cut file — there is no way back to the original.
- `fallback: true` in a worker result means Whisper produced segments but no word-level
  timestamps → segment-level bounds were used (less precise). It is not stored.
- If a batch webhook arrives with a global error (no `results`), all jobs of the batch are
  marked `failed`. Check `batchId` to correlate them. `reconcileAutocutJobs` (cron
  `pod-reconcile` + jobs sweep) asks RunPod before failing a stuck batch.
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

