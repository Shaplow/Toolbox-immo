---
name: content-library
description: >
  Work with the Content Library system in Toolbox Immo. Use when a task involves
  MediaLibrary, MediaAsset, DataLibrary, DataCampaign, DataEntry, library-to-VideoBlock
  bindings in the builder, generation form pre-fill, selection rules (oldest_used,
  least_used, not_used_in_cycle, manual), asset editing via RunPod, or usage tracking.
---

# Content Library

The Content Library system is a shared asset and data management layer that sits
**before** the generation form. Libraries are admin-managed and shared across all users.

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
  └── creates DataLibrary → DataCampaign → DataEntry (CSV import or form)
  └── edits/trims MediaAsset via RunPod media-edit job (async, webhook)

Builder
  └── VideoBlock → libraryId + selectionRule
  └── Template-level → audioLibraryId + audioSelectionRule
  └── Template-level → dataLibraryId + dataCampaignId + dataSelectionRule

Generation form
  └── contentLibraryResolver.ts resolves libraries → pre-fills fields
  └── user reviews and confirms before launching render

Post-render
  └── recordLibraryUsage() increments usageCount + sets lastUsedAt + usedInCycle
```

---

## Prisma Models

All five models exist in `web/prisma/schema.prisma`: `MediaLibrary`, `MediaAsset`,
`DataLibrary`, `DataCampaign`, `DataEntry`.

After any schema change: `cd web && npm run db:generate && npm run db:push`

Key fields to know:

- `MediaAsset.usageCount` / `lastUsedAt` — updated by `recordLibraryUsage()` after each render
- `DataEntry.usedInCycle` — set to `true` after use; reset to `false` by campaign reset endpoint
- `DataCampaign.isActive` — only one per `DataLibrary` may be active at a time
- `Render.usedAssets` — JSON `{ videoAssets: { blockId: assetId }, audioAssetId?, dataEntryId? }`

## Template JSON Extensions

These fields are in the existing types in `web/src/types/template.ts`:

```typescript
// VideoBlock
libraryId?: string;
selectionRule?: "oldest_used" | "least_used" | "manual";

// TemplateJSON (top-level)
audioLibraryId?: string;
audioSelectionRule?: "oldest_used" | "manual";
dataLibraryId?: string;
dataCampaignId?: string;
dataSelectionRule?: "not_used_in_cycle" | "least_used" | "manual";
```

These fields are **metadata only** — they have no effect on builder preview or HTML render.

## Selection Rules

| Rule | Applies to | Behaviour |
|------|-----------|-----------|
| `oldest_used` | Video, Audio | Pick the asset with the oldest `lastUsedAt` (`null` first) |
| `least_used` | Video, DataEntry | Pick the one with the lowest `usageCount` |
| `not_used_in_cycle` | DataEntry | Pick any entry where `usedInCycle = false`; fall back to `least_used` if all used |
| `manual` | All | No auto-selection — show the library picker for user to choose |

Resolver: `web/src/lib/contentLibraryResolver.ts` → `resolveLibraryPrefill(templateId)`

After a render completes (`RenderStatus.DONE`), `recordLibraryUsage(renderId)` in
`web/src/lib/recordLibraryUsage.ts` increments counters atomically. A failed render
must not consume an asset.

## Admin API Routes

**Base:** `web/src/app/api/admin/libraries/`

```
GET    /admin/libraries/media                          — list MediaLibrary
POST   /admin/libraries/media                          — create MediaLibrary
DELETE /admin/libraries/media/[id]                     — delete (cascade assets)

GET    /admin/libraries/media/[id]/assets              — list MediaAsset
POST   /admin/libraries/media/[id]/upload              — upload + probe → R2 → MediaAsset
DELETE /admin/libraries/media/assets/[assetId]         — delete asset (+ R2 cleanup)
POST   /admin/libraries/media/assets/[assetId]/edit    — submit RunPod media-edit job

GET    /admin/libraries/data                           — list DataLibrary
POST   /admin/libraries/data                           — create DataLibrary
DELETE /admin/libraries/data/[id]                      — delete

GET    /admin/libraries/data/[id]/campaigns            — list DataCampaign
POST   /admin/libraries/data/[id]/campaigns            — create DataCampaign
POST   /admin/libraries/data/campaigns/[id]/import     — CSV/XLSX import → DataEntry[]
POST   /admin/libraries/data/campaigns/[id]/reset      — set usedInCycle=false on all entries
DELETE /admin/libraries/data/campaigns/[id]            — delete campaign
```

All routes require admin role check via `web/src/lib/userContext.ts`.

## Media-Edit Async Flow (RunPod)

Asset editing (trim/crop) is async via RunPod webhook, not polling:

```
POST /admin/libraries/media/assets/[assetId]/edit
  → submitRunpodJob() with job_type: "media_edit"
  → asset updated to pending state

RunPod → POST /api/webhooks/runpod/media-edit
  → verifyRunpodWebhook() checks X-Webhook-Secret
  → parseRunpodWebhookBody() parses the body
  → updates MediaAsset.url / r2Key / duration on success
  → sets error state on failure
```

Webhook helper: `web/src/lib/webhooks/runpod.ts` (`verifyRunpodWebhook`, `parseRunpodWebhookBody`)
Webhook route: `web/src/app/api/webhooks/runpod/media-edit/route.ts`

## Admin UI

**Files:** `web/src/components/admin/libraries/`, `web/src/app/(app)/admin/libraries/`

Components: `MediaLibrariesPanel`, `MediaAssetsPanel`, `MediaAssetEditModal`,
`DataLibrariesPanel`, `DataCampaignsPanel`, `DataEntriesPanel`.

Key UX rules:
- Show `usageCount` and `lastUsedAt` per asset.
- In DataCampaign view, show how many entries are `usedInCycle=true` vs not.
- "Reset cycle" button must require a confirmation dialog.
- Only one `DataCampaign` can be `isActive=true` per `DataLibrary` — deactivate
  the previous one in the same transaction when activating another.

## Generation Form Pre-fill

`web/src/lib/contentLibraryResolver.ts` resolves library config to concrete
pre-filled values. Called when the template has at least one library binding.

- Pre-fills video picker per `VideoBlock` with a `libraryId`.
- Pre-fills audio picker.
- Pre-fills text fields from `DataEntry.fields` (see field mapping below).
- Shows a "Selected from library" badge on pre-filled fields.
- User can override any pre-filled field before launching.

## Field Mapping Convention (Data Library → Form)

Field names in `DataEntry.fields` are stable identifiers. Changing them breaks
existing entries.

| templateType | DataEntry fields |
|-------------|-----------------|
| `RPI` | `quartier`, `arrondissement`, `prix_m2`, `evo_5ans_pct` |
| `RTIPS` | `hook`, `theme`, `tip1`, `tip2`, `tip3` |

Add new rows when adding a new template type.

## Batch Generation (V2 — not yet implemented)

Do not implement until generation form pre-fill is stable in production.
Design: select template + campaign → preview N pre-fills as table → confirm →
enqueue N `Render` jobs. Must respect selection rules and not double-pick
assets across rows of the same batch.

## Key Files

| File | Role |
|------|------|
| `web/prisma/schema.prisma` | All five content library models |
| `web/src/types/template.ts` | `VideoBlock` and `TemplateJSON` library fields |
| `web/src/lib/contentLibraryResolver.ts` | Selection rule engine |
| `web/src/lib/recordLibraryUsage.ts` | Post-render usage tracking |
| `web/src/app/api/admin/libraries/` | Admin CRUD + upload routes |
| `web/src/app/api/admin/libraries/media/assets/[assetId]/edit/` | Asset-edit RunPod submission |
| `web/src/app/api/webhooks/runpod/media-edit/` | Asset-edit completion webhook |
| `web/src/lib/webhooks/runpod.ts` | Shared webhook auth + body parse helpers |
| `web/src/components/admin/libraries/` | Admin UI panels |
| `web/src/app/api/renders/` | Post-render hook that calls `recordLibraryUsage` |

## Invariants

- **Resolver nulls on missing IDs.** Deleted library → `resolveLibraryPrefill` returns `null`, no throw.
- **Usage tracking on DONE only.** Failed renders must not consume assets.
- **Cycle reset is destructive.** Always confirm first.
- **R2 cleanup on asset delete.** Delete R2 object first, then DB row. Abort if R2 delete fails.
- **One active campaign per DataLibrary.** Enforce in API and UI.
- **Builder fields are metadata only.** `libraryId` / `selectionRule` on `VideoBlock` have no effect on `buildHTML.ts` or canvas rendering.

