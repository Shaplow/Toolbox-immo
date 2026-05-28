---
name: asset-rotation
description: >
  Understand, debug, and implement the asset rotation engine in Toolbox Immo.
  Use when a task involves the theme_sequence selection rule, auto mode vs override mode,
  category exclusion logic, per-account isolation (MediaAssetUsage), AccountLibraryCursor,
  group discovery, pickFromGroup, selectMediaAssetBySetSequence internals, how to simulate
  rotation manually, rotation bugs (wrong ordering, wrong account isolation, skipped groups),
  or extending the same rotation pattern to DataEntry.
---

# Asset Rotation Engine

The rotation engine determines which asset (or data entry) to suggest at generation time,
ensuring variety across consecutive generations while respecting per-account isolation.

**Entry point:** `web/src/lib/contentLibraryResolver.ts`
**Usage recording:** `web/src/lib/recordLibraryUsage.ts`

---

## Core Concepts

| Concept | Model/Field | Description |
|---------|-------------|-------------|
| **Set** | `MediaAsset.setTag` | Assets filmed together (intro + outro). The rotation unit within a family. |
| **Category** | `MediaAsset.category` | Family of sets — same model, shoot day, or location. Used for consecutive exclusion. |
| **Group** | `(category, setTag)` pair | The actual rotation unit. Two sets can share a setTag but differ in category → treated as separate groups. |
| **Override list** | `MediaLibrary.setSequence` | Optional JSON `string[]`. When non-empty, the admin controls exact rotation order. |
| **Per-account cursor** | `AccountLibraryCursor` | Tracks last-used set + category per (account, library). One row per pair. |
| **Per-account usage** | `MediaAssetUsage` | Per-account lastUsedAt + usageCount. Drives ordering inside each group. |
| **Global usage** | `MediaAsset.usageCount/lastUsedAt` | Global aggregate. Only used for ordering when no accountId present. |
| **Access restriction** | `MediaAssetAccess` | 0 rows = asset is global. 1+ rows = only listed accounts can use it. |

---

## Two Rotation Modes

### Auto Mode (`setSequence` is empty or `[]`)

The engine discovers groups dynamically and picks the one least recently used by the account,
with category exclusion to prevent consecutive same-category videos.

**Algorithm (`selectMediaAssetBySetSequence`):**

```
1. LOAD all distinct (category, setTag) groups from MediaAsset WHERE libraryId = ?
   - Access filter: (NOT EXISTS access) OR (EXISTS access WHERE accountId = ?)
   - Only groups with setTag IS NOT NULL
   - Ordered by MAX(mau.lastUsedAt) ASC NULLS FIRST per account

2. LOAD lastUsedCategory from AccountLibraryCursor for this (account, library)

3. EXCLUDE groups where category = lastUsedCategory
   (prevents two consecutive gens from same family)
   Fallback: if ALL groups are in the excluded category, allow repeating it

4. PICK the first remaining group (oldest MAX lastUsedAt for this account)

5. Within the chosen (category, setTag) group:
   - JOIN MediaAssetUsage WHERE accountId = ?
   - ORDER BY mau.lastUsedAt ASC NULLS FIRST, createdAt ASC
   - LIMIT 1 → this is the asset suggested

6. RETURN { id, url, filename, resolvedSetTag, resolvedCategory }
```

**At prefill time (selectMediaAssetBySetSequence with accountId):**
- Runs a `SELECT FOR UPDATE` on `AccountLibraryCursor` inside a Prisma transaction.
- Writes `lastUsedSetTag` + `lastUsedCategory` + `lastAdvancedAt` atomically before the form renders.
- Stores a `CursorRevertState` snapshot (`prevLastUsedCategory`, `claimedLastUsedCategory`) in the render's `usedAssets`.
- `cursor` field is NOT advanced in auto mode (stays 0).

**Post-render (recordLibraryUsage on DONE):**
- Only stamps `lastAdvancedAt` to record render completion. Cursor and category were already written.

**On render failure (revertLibraryCursors on ERROR):**
- Conditionally reverts `lastUsedCategory` to `prevLastUsedCategory` using `IS NOT DISTINCT FROM claimedLastUsedCategory` as the condition.
- If a concurrent generation has since advanced past the claimed state, the UPDATE is a no-op.

### Override Mode (`setSequence` is non-empty)

The admin has explicitly ordered setTags. The engine follows that list using an integer cursor.

**Algorithm:**

```
1. LOAD AccountLibraryCursor.cursor (default 0)
2. selectedSetTag = setSequence[cursor % setSequence.length]
3. SELECT asset WHERE setTag = selectedSetTag
   - Access filter applied
   - JOIN MediaAssetUsage for per-account ordering within the set
   - ORDER BY mau.lastUsedAt ASC NULLS FIRST, createdAt ASC
   - LIMIT 1
4. RETURN asset
```

**At prefill time (selectMediaAssetBySetSequence with accountId):**
- Runs a `SELECT FOR UPDATE` on `AccountLibraryCursor` inside a Prisma transaction.
- Advances `cursor` to `(current + 1) % setSequence.length` atomically.
- Stores a `CursorRevertState` snapshot (`prevCursor`, `claimedCursor`, `prevLastUsedCategory`) in the render's `usedAssets`.

**Post-render (recordLibraryUsage on DONE):**
- Only stamps `lastAdvancedAt`. Cursor was already advanced at prefill.

**On render failure (revertLibraryCursors on ERROR):**
- Conditionally reverts `cursor` to `prevCursor` using `cursor IS NOT DISTINCT FROM claimedCursor` as the condition.
- If a concurrent generation has since advanced past the claimed cursor, the UPDATE is a no-op.

**Override mode does not apply category exclusion.** The admin is responsible for the order.

---

## Per-Account Isolation

### The Isolation Guarantee

Multiple négociateurs sharing a library do NOT pollute each other's rotation.

| What is isolated | How |
|-----------------|-----|
| Group ordering (auto mode) | `MAX(mau.lastUsedAt)` per account — from `MediaAssetUsage` |
| Asset ordering within a group | `mau.lastUsedAt` per account — from `MediaAssetUsage` |
| Override mode cursor | `AccountLibraryCursor.cursor` per (account, library) |
| Category exclusion | `AccountLibraryCursor.lastUsedCategory` per (account, library) |

### The Global Aggregate

`MediaAsset.usageCount` and `MediaAsset.lastUsedAt` are still maintained as global aggregates
(incremented for every account's use). These are:
- Displayed in admin UI when no account filter is active.
- Used for ordering in `selectMediaAsset()` and `selectMediaAssetBySetSequence()` when
  `accountId` is not provided (admin preview, manual selection).

**Never use global counters for per-account rotation ordering.** Always JOIN `MediaAssetUsage`.

### Access Filtering

Applied at every SQL query level, not as a post-filter:

```sql
-- With accountId: global OR accessible to this account
AND (NOT EXISTS (SELECT 1 FROM "MediaAssetAccess" WHERE "assetId" = ma.id)
  OR EXISTS (SELECT 1 FROM "MediaAssetAccess" WHERE "assetId" = ma.id AND "accountId" = $accountId))

-- Without accountId: global only
AND NOT EXISTS (SELECT 1 FROM "MediaAssetAccess" WHERE "assetId" = ma.id)
```

---

## Pinned Set (Multi-Block Templates)

When a template has two `VideoBlock`s bound to the same library (e.g. intro + outro), both
blocks must receive assets from the **same set** in a single generation.

**Mechanism:** The resolver processes blocks grouped by `libraryId`:
1. First block in a library group → full discovery (auto or override) → `pinnedSetTag` set.
2. Subsequent blocks in the same library → `pickFromGroup(pinnedSetTag, pinnedCategory)` directly.
   The cursor is NOT read again. The category exclusion is NOT re-applied.

This guarantees intro and outro come from the same shoot, while still picking
different assets within the set (intro gets the least-recently-used asset in the set,
outro gets the next one).

---

## Locked Prefill and Failure Recovery

`theme_sequence` blocks use `SELECT FOR UPDATE` at prefill time to serialize concurrent
auto-cron generations. The cursor (override mode) or `lastUsedCategory` (auto mode) is written
before the form renders, not after DONE. This guarantees two simultaneous generations for
the same account pick different content families.

**Snapshot structure (`CursorRevertState`):**
```typescript
type CursorRevertState = {
  prevCursor: number;                    // cursor BEFORE advance (override mode)
  claimedCursor: number;                 // cursor WE WROTE (override mode)
  prevLastUsedCategory: string | null;   // lastUsedCategory BEFORE we wrote (auto mode)
  claimedLastUsedCategory: string | null;// lastUsedCategory WE WROTE (auto mode)
};
```

**Revert safety guarantee:**
The conditional UPDATE uses `IS NOT DISTINCT FROM` on the claimed value as a fence:
- If a subsequent generation has already advanced the field → WHERE doesn't match → no-op.
- If two renders fail in sequence → second revert finds the state left by first revert → may not match → no-op (one position lost, self-corrects on next cycle).

**Non-theme_sequence blocks** (`oldest_used`, `least_used`) do not use locking. They join
`MediaAssetUsage` for ordering; two concurrent opens may suggest the same asset. This is
acceptable — usage is recorded on DONE and self-corrects on the next generation.

---

## Non-Blocking Prefill (non-theme_sequence only)

For rules other than `theme_sequence` (`oldest_used`, `least_used`, `manual`):

---

## Admin UI: Rotation Simulation

`MediaAssetsPanel` (rotation view) simulates the auto-mode algorithm client-side to show
admins what the next suggested group would be for the filtered account:

```typescript
// groupedBySetTag memo in MediaAssetsPanel.tsx
const accessible = groups.filter(g => g.isAccessible);  // respects MediaAssetAccess
const byAge = accessible.sort by lastUsed ASC NULLS FIRST;
// simulate category exclusion:
while (remaining.length > 0) {
  const eligible = lastCategory ? remaining.filter(g => g.category !== lastCategory) : remaining;
  const pick = (eligible.length > 0 ? eligible : remaining)[0];
  pick.autoRank = ordered.length + 1;
  lastCategory = pick.category;
}
```

Key rules:
- `getLastUsed(group)` uses only accessible assets' `lastUsedAt` values — not inaccessible ones.
- Inaccessible groups (assets restricted to other accounts) are excluded from ranking and shown dimmed at the end.
- Without account filter: all groups participate, ordering uses global `lastUsedAt`.
- `accessibleCount` (not total count) is shown in group headers.

---

## Common Bugs

### Wrong account isolation for non-theme_sequence rules

`oldest_used` and `least_used` in `selectMediaAsset()` must JOIN `MediaAssetUsage` when
`accountId` is present. If you see ORDER BY `ma.lastUsedAt` without a JOIN, the query
is using global counters — accounts pollute each other.

Correct pattern:
```sql
SELECT ma.id, ma.url, ma.filename FROM "MediaAsset" ma
LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = $accountId
WHERE ma."libraryId" = $libraryId
  AND [accessFilter]
ORDER BY mau."lastUsedAt" ASC NULLS FIRST, ma."createdAt" ASC LIMIT 1
```

### Simulation shows wrong rank when inaccessible assets have usage data

`getLastUsed(groupAssets)` must filter `accessAccountIds` before computing MAX.
Otherwise an asset restricted to another account (with a recent `lastUsedAt`) inflates
the apparent "recency" of a group, making it appear lower in the rotation than it should be.

### theme_sequence blocks skipped without accountId

If `accountId` is undefined and you guard with `if (accountId && sequenceBlocks.length > 0)`,
all sequence blocks silently return no suggestion. The guard should be `if (sequenceBlocks.length > 0)`.
`selectMediaAssetBySetSequence` handles `accountId = undefined` correctly (global pool, no cursor advance).

### Category exclusion overfires when all groups share a category

The fallback `if (eligible.length === 0) eligible = remaining` is essential. Without it,
if a library has only one category, every generation is blocked.

### Pinned set ignores category exclusion

This is intentional. Do not add category exclusion to `pickFromGroup` calls made with
`pinnedSetTag`. The category was already chosen by the first block in the group.

---

## Extending to DataEntry (Planned)

The same pattern applies to text data. When implementing:

1. Add `category`, `setTag`, `isReference Boolean` to `DataEntry`.
2. Add `DataEntryAccess` and `DataEntryUsage` tables (same structure as their Media equivalents).
3. The rotation unit becomes `(category, setTag)` — same as for assets.
4. `isReference = true` entries (e.g. "Paris global") are fetched alongside the local entry
   but never consumed in the rotation (not used for group ranking, not marked `usedInCycle`).
5. `selectDataEntry()` returns `{ localEntry, referenceEntry }` — the template uses both.
6. Access filter and per-account usage ordering mirror `selectMediaAsset()`.
7. `recordLibraryUsage()` upserts `DataEntryUsage` and advances `DataCampaignCursor` (new model).

When implementing, use `selectMediaAssetBySetSequence` as the reference implementation.
The SQL patterns are identical — only the table names and the `isReference` filter differ.

---

## How to Debug Rotation

### Check what the resolver will pick next

```sql
-- Per-account usage for a library
SELECT ma.id, ma.filename, ma."setTag", ma.category,
       mau."lastUsedAt", mau."usageCount"
FROM "MediaAsset" ma
LEFT JOIN "MediaAssetUsage" mau ON mau."assetId" = ma.id AND mau."accountId" = '<accountId>'
WHERE ma."libraryId" = '<libraryId>'
ORDER BY mau."lastUsedAt" ASC NULLS FIRST;
```

```sql
-- Current cursor + last used set/category for an account
SELECT * FROM "AccountLibraryCursor"
WHERE "accountId" = '<accountId>' AND "libraryId" = '<libraryId>';
```

```sql
-- Which accounts can access an asset (0 rows = global)
SELECT "accountId" FROM "MediaAssetAccess" WHERE "assetId" = '<assetId>';
```

### Read rotation rank in the admin UI

Open the library in admin → select an account in the filter bar → switch to **Rotation** view.
The rank column shows what the resolver would pick. If a group is dimmed, the account has no access.

### Verify category exclusion is firing correctly

Check `AccountLibraryCursor.lastUsedCategory`. The auto mode will exclude all groups where
`category = lastUsedCategory`. If the library has only one category, all groups will be
excluded → the fallback kicks in and the category repeats.

### Confirm usage was recorded

After a `DONE` render, `MediaAssetUsage` should have a row for `(assetId, accountId)`.
If it's missing, check that `recordLibraryUsage` was called and that `usedAssets.videoAssets`
was populated in the `Render` row.

---

## Invariants

- **Cursor advances at prefill time for theme_sequence.** `selectMediaAssetBySetSequence` uses `SELECT FOR UPDATE` and writes cursor/lastUsedCategory before the form renders. `recordLibraryUsage` on DONE only stamps `lastAdvancedAt`. Failed renders trigger `revertLibraryCursors` which conditionally rolls back the cursor using a claimed-value fence.
- **Auto mode never advances the cursor field.** It writes `lastUsedSetTag` and `lastUsedCategory` to `AccountLibraryCursor`, but `cursor` remains 0. Cursor is only meaningful in override mode.
- **Override mode never applies category exclusion.** The admin is responsible for the order in `setSequence`. Do not add category exclusion logic to the override path.
- **Category exclusion fallback is mandatory.** If all candidate groups share `lastUsedCategory`, the exclusion must be dropped and the full list used. Without this fallback, a single-category library blocks all generations.
- **Access filter is SQL-level, never post-filter.** Fetching all assets and then filtering in application code bypasses the query optimiser and risks leaking restricted assets into selection if the filter code has a bug.
- **Global aggregates are not used for per-account ordering.** `MediaAsset.usageCount` and `MediaAsset.lastUsedAt` are correct only in the global view. Per-account rotation must JOIN `MediaAssetUsage`.
- **setTag=null assets are invisible to theme_sequence.** Groups without a `setTag` are excluded from `selectMediaAssetBySetSequence`. These assets may still be selected by `oldest_used` / `least_used` rules.
- **pinnedSetTag skips category exclusion — intentionally.** When the same library is bound to multiple blocks in one generation, subsequent blocks call `pickFromGroup(pinnedSetTag)` directly. Do not re-run auto mode or re-apply category exclusion for these calls.
- **Prefill locks for theme_sequence, not for other rules.** `selectMediaAssetBySetSequence` uses `SELECT FOR UPDATE`. `selectMediaAsset` (oldest_used/least_used) does not. Do not add locking to the non-theme_sequence path.
- **setSequence is append-only from asset PATCH.** The API auto-appends a new setTag to `setSequence` when a PATCH sets a previously unknown `setTag`. It never removes or reorders. All reordering requires an explicit PATCH on the library.
- **Resolver nulls on empty pool, does not throw.** If no accessible asset matches (library empty, all restricted, tag filter yields nothing), `selectMediaAsset` and `selectMediaAssetBySetSequence` return `null`. The form still opens without the suggestion.

---

## Key Files

| File | Role |
|------|------|
| `web/src/lib/contentLibraryResolver.ts` | Resolver — `selectMediaAsset`, `selectMediaAssetBySetSequence`, `resolveLibraryPrefill` |
| `web/src/lib/recordLibraryUsage.ts` | Post-render — updates global + per-account counters; `revertLibraryCursors` on failure |
| `web/src/components/admin/libraries/MediaAssetsPanel.tsx` | Admin UI — rotation simulation, account filter, group view |
| `web/prisma/schema.prisma` | `MediaAsset`, `MediaAssetAccess`, `MediaAssetUsage`, `AccountLibraryCursor` |
| `web/src/app/api/admin/libraries/media/[id]/assets/route.ts` | GET with ?accountId= for per-account stats |
| `web/src/app/api/admin/libraries/media/assets/[assetId]/route.ts` | PATCH — resetUsage, resetUsageForAccount, accessAccountIds |
