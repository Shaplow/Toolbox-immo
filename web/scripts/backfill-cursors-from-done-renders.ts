/**
 * Backfill AccountLibraryCursor depuis les renders DONE.
 *
 * Problème : le curseur était avancé au prefill (page load) même si la génération
 * était abandonnée. Ce script remet chaque curseur à l'état correspondant au
 * dernier render DONE réel pour ce (accountId, libraryId).
 *
 * Usage local :
 *   cd web && npx dotenv -e .env.local -- tsx scripts/backfill-cursors-from-done-renders.ts
 *
 * Usage prod (depuis /var/www/toolbox/web) :
 *   npx dotenv -e .env.local -- tsx scripts/backfill-cursors-from-done-renders.ts
 *
 * Dry-run par défaut. Passer --apply pour écrire en base.
 *   npx dotenv -e .env.local -- tsx scripts/backfill-cursors-from-done-renders.ts --apply
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const SHARED_CURSOR_ACCOUNT_ID = "__shared__";

interface PrevCursorState {
  prevCursor: number;
  claimedCursor: number;
  prevLastUsedCategory: string | null;
  claimedLastUsedCategory: string | null;
  cursorAccountId?: string;
}

interface UsedAssets {
  setSequencedLibraryIds?: string[];
  usedSetTagByLibrary?: Record<string, string>;
  usedCategoryByLibrary?: Record<string, string>;
  prevCursorStateByLibrary?: Record<string, PrevCursorState>;
}

async function main() {
  if (!APPLY) {
    console.log("=== DRY-RUN (passer --apply pour écrire) ===\n");
  } else {
    console.log("=== MODE APPLY — écriture en base ===\n");
  }

  // Charger tous les curseurs existants
  const cursors = await prisma.accountLibraryCursor.findMany({
    select: {
      accountId: true,
      libraryId: true,
      cursor: true,
      lastUsedSetTag: true,
      lastUsedCategory: true,
      lastAdvancedAt: true,
    },
  });

  if (cursors.length === 0) {
    console.log("Aucun AccountLibraryCursor en base. Rien à faire.");
    return;
  }

  console.log(`${cursors.length} curseur(s) à analyser.\n`);

  // Charger tous les renders DONE avec usedAssets (on filtre en JS — script one-off)
  const doneRenders = await prisma.render.findMany({
    where: { status: "DONE" },
    select: {
      id: true,
      accountId: true,
      usedAssets: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`${doneRenders.length} render(s) DONE chargés.\n`);

  // Construire un index : (accountId|__shared__, libraryId) → render le plus récent avec état curseur
  type CursorKey = string; // `${accountId}::${libraryId}`
  const bestRender = new Map<
    CursorKey,
    { renderId: string; claimedCursor: number; lastUsedSetTag: string | null; lastUsedCategory: string | null; createdAt: Date }
  >();

  for (const render of doneRenders) {
    let parsed: UsedAssets = {};
    try {
      parsed = JSON.parse(render.usedAssets ?? "{}") as UsedAssets;
    } catch {
      continue;
    }

    const prevStates = parsed.prevCursorStateByLibrary ?? {};
    for (const [libraryId, state] of Object.entries(prevStates)) {
      // cursorAccountId peut être __shared__ ou le vrai accountId
      const cursorAccountId = state.cursorAccountId ?? render.accountId ?? null;
      if (!cursorAccountId) continue;

      const key: CursorKey = `${cursorAccountId}::${libraryId}`;
      if (bestRender.has(key)) continue; // déjà le plus récent (renders triés DESC)

      bestRender.set(key, {
        renderId: render.id,
        claimedCursor: state.claimedCursor,
        lastUsedSetTag: parsed.usedSetTagByLibrary?.[libraryId] ?? null,
        lastUsedCategory: parsed.usedCategoryByLibrary?.[libraryId] ?? null,
        createdAt: render.createdAt,
      });
    }
  }

  let updated = 0;
  let skipped = 0;
  let noData = 0;

  for (const cursor of cursors) {
    const key: CursorKey = `${cursor.accountId}::${cursor.libraryId}`;
    const best = bestRender.get(key);

    if (!best) {
      // Aucun render DONE pour ce curseur — probablement que des prefills abandonnés
      console.log(
        `  [NO DATA]  account=${cursor.accountId}  library=${cursor.libraryId}` +
        `  cursor_actuel=${cursor.cursor}  →  aucun render DONE trouvé, cursor remis à 0 / setTag null`,
      );
      if (APPLY) {
        await prisma.accountLibraryCursor.update({
          where: { accountId_libraryId: { accountId: cursor.accountId, libraryId: cursor.libraryId } },
          data: { cursor: 0, lastUsedSetTag: null, lastUsedCategory: null },
        });
      }
      noData++;
      continue;
    }

    const sameState =
      cursor.cursor === best.claimedCursor &&
      cursor.lastUsedSetTag === best.lastUsedSetTag &&
      cursor.lastUsedCategory === best.lastUsedCategory;

    if (sameState) {
      console.log(
        `  [OK]       account=${cursor.accountId}  library=${cursor.libraryId}` +
        `  cursor=${cursor.cursor}  setTag=${cursor.lastUsedSetTag ?? "null"}  — déjà correct`,
      );
      skipped++;
      continue;
    }

    console.log(
      `  [FIX]      account=${cursor.accountId}  library=${cursor.libraryId}\n` +
      `             cursor:   ${cursor.cursor} → ${best.claimedCursor}\n` +
      `             setTag:   ${cursor.lastUsedSetTag ?? "null"} → ${best.lastUsedSetTag ?? "null"}\n` +
      `             category: ${cursor.lastUsedCategory ?? "null"} → ${best.lastUsedCategory ?? "null"}\n` +
      `             (render DONE: ${best.renderId}  le ${best.createdAt.toISOString()})`,
    );

    if (APPLY) {
      await prisma.accountLibraryCursor.update({
        where: { accountId_libraryId: { accountId: cursor.accountId, libraryId: cursor.libraryId } },
        data: {
          cursor: best.claimedCursor,
          lastUsedSetTag: best.lastUsedSetTag,
          lastUsedCategory: best.lastUsedCategory,
        },
      });
    }
    updated++;
  }

  console.log(
    `\nTerminé${APPLY ? "" : " (dry-run)"}. ` +
    `${updated} à corriger, ${skipped} déjà corrects, ${noData} sans render DONE (remis à 0).`,
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
