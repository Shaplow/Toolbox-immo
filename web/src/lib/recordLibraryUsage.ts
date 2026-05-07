/**
 * recordLibraryUsage.ts
 *
 * Called after a Render reaches status=DONE. Reads `render.usedAssets` and
 * atomically increments usage counters on the relevant MediaAssets and DataEntry.
 *
 * Design: best-effort — errors are logged but do not throw (render already succeeded).
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

interface UsedAssets {
  /** blockId → assetId */
  videoAssets?: Record<string, string>;
  audioAssetId?: string;
  dataEntryId?: string;
  /** Libraries that used set_sequence — cursor/lastUsedSetTag will be updated */
  setSequencedLibraryIds?: string[];
  /** libraryId → resolved setTag used during this generation */
  usedSetTagByLibrary?: Record<string, string>;
  /** libraryId → resolved category used during this generation */
  usedCategoryByLibrary?: Record<string, string>;
  /** libraryId → cursor snapshot for failure-recovery revert */
  prevCursorStateByLibrary?: Record<string, {
    prevCursor: number;
    claimedCursor: number;
    prevLastUsedCategory: string | null;
    claimedLastUsedCategory: string | null;
  }>;
  /** DataEntry claim state for failure-recovery revert */
  prevDataEntryState?: {
    entryId: string;
    campaignId: string;
    usagePolicy: string;
    claimType: "usedInCycle" | "perAccountUsage";
    accountId?: string;
  };
}

export async function recordLibraryUsage(renderId: string): Promise<void> {
  let render;
  try {
    render = await prisma.render.findUnique({
      where: { id: renderId },
      select: { usedAssets: true, status: true, accountId: true },
    });
  } catch (err) {
    console.error(`[recordLibraryUsage] Failed to fetch render ${renderId}:`, err);
    return;
  }

  if (!render || render.status !== "DONE") return;

  let usedAssets: UsedAssets = {};
  try {
    usedAssets = JSON.parse(render.usedAssets) as UsedAssets;
  } catch (err) {
    console.error(`[recordLibraryUsage] malformed usedAssets JSON for render ${renderId}:`, err);
    return;
  }

  const now = new Date();

  // --- Video assets ---
  const videoAssetIds = Object.values(usedAssets.videoAssets ?? {});
  if (videoAssetIds.length > 0) {
    const accountId = render.accountId;
    await Promise.allSettled(
      videoAssetIds.map(async (assetId) => {
        // Always update global aggregate
        await prisma.mediaAsset.update({
          where: { id: assetId },
          data: { usageCount: { increment: 1 }, lastUsedAt: now },
        });
        // Upsert per-account usage when accountId is present
        if (accountId) {
          await prisma.mediaAssetUsage.upsert({
            where: { assetId_accountId: { assetId, accountId } },
            update: { usageCount: { increment: 1 }, lastUsedAt: now },
            create: { assetId, accountId, usageCount: 1, lastUsedAt: now },
          });
        }
      }),
    );
  }

  // --- Audio asset ---
  if (usedAssets.audioAssetId) {
    const audioAssetId = usedAssets.audioAssetId;
    const accountId = render.accountId;
    await prisma.mediaAsset
      .update({
        where: { id: audioAssetId },
        data: { usageCount: { increment: 1 }, lastUsedAt: now },
      })
      .catch((err: unknown) => console.error("[recordLibraryUsage] audio asset update failed:", err));
    if (accountId) {
      await prisma.mediaAssetUsage
        .upsert({
          where: { assetId_accountId: { assetId: audioAssetId, accountId } },
          update: { usageCount: { increment: 1 }, lastUsedAt: now },
          create: { assetId: audioAssetId, accountId, usageCount: 1, lastUsedAt: now },
        })
        .catch((err: unknown) => console.error("[recordLibraryUsage] audio asset usage upsert failed:", err));
    }
  }

  // --- Data entry ---
  if (usedAssets.dataEntryId) {
    const dataEntryId = usedAssets.dataEntryId;
    const accountId = render.accountId;
    const claimType = usedAssets.prevDataEntryState?.claimType;
    await prisma.dataEntry
      .update({
        where: { id: dataEntryId },
        data: {
          usageCount: { increment: 1 },
          lastUsedAt: now,
          // usedInCycle was already set at prefill for "usedInCycle" claim types.
          // For "perAccountUsage" and fallback (no claim), set it here on DONE.
          ...(claimType === "usedInCycle" ? {} : { usedInCycle: true }),
        },
      })
      .catch((err: unknown) => console.error("[recordLibraryUsage] data entry update failed:", err));
    if (accountId) {
      await prisma.dataEntryUsage
        .upsert({
          where: { entryId_accountId: { entryId: dataEntryId, accountId } },
          // For perAccountUsage claim: row exists with usageCount=0 — increment to 1.
          // For no claim: create with usageCount=1.
          update: { usageCount: { increment: 1 }, lastUsedAt: now },
          create: { entryId: dataEntryId, accountId, usageCount: 1, lastUsedAt: now },
        })
        .catch((err: unknown) => console.error("[recordLibraryUsage] data entry usage upsert failed:", err));
    }
  }

  // --- Set sequence cursors ---
  // Cursor position and lastUsedCategory were already written at prefill time by
  // selectMediaAssetBySetSequence (SELECT FOR UPDATE, serialized across concurrent
  // generations). Here we only stamp lastAdvancedAt to mark render completion.
  const seqLibraryIds = usedAssets.setSequencedLibraryIds ?? [];
  const accountId = render.accountId;
  if (accountId && seqLibraryIds.length > 0) {
    await Promise.allSettled(
      seqLibraryIds.map(async (libraryId) => {
        try {
          await prisma.accountLibraryCursor.upsert({
            where: { accountId_libraryId: { accountId, libraryId } },
            update: { lastAdvancedAt: now },
            create: { accountId, libraryId, cursor: 0, lastAdvancedAt: now },
          });
        } catch (err) {
          console.error(`[recordLibraryUsage] cursor lastAdvancedAt update failed for library ${libraryId}:`, err);
        }
      }),
    );
  }
}

/**
 * revertLibraryCursors — called when a render reaches status=ERROR.
 *
 * Uses a conditional UPDATE to roll back the cursor that was advanced at prefill time,
 * but only if no subsequent generation has since written a newer value.
 * This ensures a failed render's claimed content slot becomes available again on the next
 * run, restoring the normal rotation cycle.
 *
 * Safety: best-effort, non-throwing.  If the condition doesn't match (another gen already
 * advanced past this claim), the update is a harmless no-op.
 */
export async function revertLibraryCursors(renderId: string): Promise<void> {
  let render;
  try {
    render = await prisma.render.findUnique({
      where: { id: renderId },
      select: { usedAssets: true, accountId: true },
    });
  } catch (err) {
    console.error(`[revertLibraryCursors] Failed to fetch render ${renderId}:`, err);
    return;
  }

  if (!render?.accountId || !render.usedAssets) return;

  let usedAssets: UsedAssets = {};
  try {
    usedAssets = JSON.parse(render.usedAssets as string) as UsedAssets;
  } catch {
    return;
  }

  const accountId = render.accountId;
  const prevStateMap = usedAssets.prevCursorStateByLibrary;
  if (!prevStateMap || Object.keys(prevStateMap).length === 0) return;

  await Promise.allSettled(
    Object.entries(prevStateMap).map(async ([libraryId, state]) => {
      try {
        // Conditional revert: only apply if the cursor row still reflects exactly what
        // this generation wrote.  If a concurrent or later generation has since advanced
        // the cursor, the WHERE won't match and the update is a no-op.
        const updated = await prisma.$executeRaw(Prisma.sql`
          UPDATE "AccountLibraryCursor"
          SET
            cursor               = ${state.prevCursor},
            "lastUsedCategory"   = ${state.prevLastUsedCategory}
          WHERE "accountId"  = ${accountId}
            AND "libraryId"  = ${libraryId}
            AND cursor IS NOT DISTINCT FROM ${state.claimedCursor}
            AND "lastUsedCategory" IS NOT DISTINCT FROM ${state.claimedLastUsedCategory}
        `);
        if (updated > 0) {
          console.info(`[revertLibraryCursors] render=${renderId} library=${libraryId} cursor reverted ${state.claimedCursor}→${state.prevCursor}`);
        }
      } catch (err) {
        console.error(`[revertLibraryCursors] revert failed for render=${renderId} library=${libraryId}:`, err);
      }
    }),
  );

  // --- DataEntry claim revert ---
  const dataState = usedAssets.prevDataEntryState;
  if (dataState) {
    try {
      if (dataState.claimType === "usedInCycle") {
        // Claimed via usedInCycle=true. Revert only if usageCount=0 (DONE never ran).
        const updated = await prisma.$executeRaw(Prisma.sql`
          UPDATE "DataEntry"
          SET "usedInCycle" = false
          WHERE id = ${dataState.entryId}
            AND "usageCount" = 0
            AND "usedInCycle" = true
        `);
        if (updated > 0) {
          console.info(`[revertLibraryCursors] render=${renderId} DataEntry=${dataState.entryId} usedInCycle reverted`);
        }
      } else if (dataState.claimType === "perAccountUsage" && dataState.accountId) {
        // Claimed via DataEntryUsage(usageCount=0) insert. Delete only if still at 0.
        const deleted = await prisma.$executeRaw(Prisma.sql`
          DELETE FROM "DataEntryUsage"
          WHERE "entryId"   = ${dataState.entryId}
            AND "accountId" = ${dataState.accountId}
            AND "usageCount" = 0
        `);
        if (deleted > 0) {
          console.info(`[revertLibraryCursors] render=${renderId} DataEntry=${dataState.entryId} perAccountUsage claim deleted`);
        }
      }
    } catch (err) {
      console.error(`[revertLibraryCursors] DataEntry revert failed for render=${renderId}:`, err);
    }
  }
}
