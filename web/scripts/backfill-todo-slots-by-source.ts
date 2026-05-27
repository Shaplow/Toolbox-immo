/**
 * Backfill : re-classe les slots restés en `TO_DO` (legacy status) vers le
 * statut initial correct dérivé de `pattern.source`.
 *
 * Contexte : avant la Phase 1 de Cohérence Workflows, tous les slots créés par
 * `generateCalendarSlots` étaient marqués `TO_DO` — un statut legacy absent
 * des nouvelles worklists (MONTEUR_SECTION_MAP, CM_SECTION_MAP). Conséquence :
 * les missions `manual_rushes` et `external_upload` n'apparaissaient nulle part.
 *
 * Règles de migration :
 *  - Si `pattern.source = auto_template` → `PLANNED`
 *  - Si `pattern.source = manual_rushes` → `RUSHES_EXPECTED`
 *  - Si `pattern.source = external_upload` → `READY_FOR_CM`
 *  - SKIP si `render.status === "DONE"` (le rattrapage opportuniste
 *    `syncSlotsPipelineStatuses` s'en occupe — ne pas écraser ces slots)
 *  - SKIP si `slot.pattern` est null (slot orphelin — pas de source à dériver)
 *
 * Idempotent : ne touche que les slots strictement `TO_DO`.
 *
 * Usage local :
 *   cd web && npx dotenv -e .env.local -- tsx scripts/backfill-todo-slots-by-source.ts
 *
 * Usage prod :
 *   npx dotenv -e .env.local -- tsx scripts/backfill-todo-slots-by-source.ts --apply
 *
 * Dry-run par défaut. Passer `--apply` pour écrire.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

function mapSourceToInitialStatus(source: string): string {
  switch (source) {
    case "auto_template":
      return "PLANNED";
    case "manual_rushes":
      return "RUSHES_EXPECTED";
    case "external_upload":
      return "READY_FOR_CM";
    default:
      return "PLANNED";
  }
}

interface BucketStat {
  source: string;
  targetStatus: string;
  count: number;
}

async function main() {
  console.log(`=== ${APPLY ? "APPLY" : "DRY-RUN"} — backfill slots TO_DO par source ===\n`);

  // Charger tous les slots TO_DO avec leur pattern.source et render.status
  const todoSlots = await prisma.publicationSlot.findMany({
    where: { status: "TO_DO" },
    select: {
      id: true,
      pattern: { select: { source: true } },
      render: { select: { status: true } },
    },
  });

  console.log(`Slots en TO_DO trouvés : ${todoSlots.length}\n`);

  if (todoSlots.length === 0) {
    console.log("Rien à backfiller. Sortie.");
    await prisma.$disconnect();
    return;
  }

  // Catégoriser
  const buckets = new Map<string, BucketStat>();
  const skippedNoPattern: string[] = [];
  const skippedRenderDone: string[] = [];
  const toMigrate: { id: string; targetStatus: string; source: string }[] = [];

  for (const slot of todoSlots) {
    if (!slot.pattern) {
      skippedNoPattern.push(slot.id);
      continue;
    }
    if (slot.render?.status === "DONE") {
      skippedRenderDone.push(slot.id);
      continue;
    }

    const targetStatus = mapSourceToInitialStatus(slot.pattern.source);
    toMigrate.push({ id: slot.id, targetStatus, source: slot.pattern.source });

    const key = `${slot.pattern.source}→${targetStatus}`;
    const entry = buckets.get(key) ?? { source: slot.pattern.source, targetStatus, count: 0 };
    entry.count++;
    buckets.set(key, entry);
  }

  // Rapport
  console.log("== Répartition ==");
  for (const bucket of buckets.values()) {
    console.log(`  ${bucket.source.padEnd(18)} → ${bucket.targetStatus.padEnd(18)} : ${bucket.count} slots`);
  }
  console.log("");
  console.log(`Skipped (pattern null)   : ${skippedNoPattern.length}`);
  console.log(`Skipped (render DONE)    : ${skippedRenderDone.length} (laissés au rattrapage opportuniste)`);
  console.log(`À migrer                 : ${toMigrate.length}`);
  console.log("");

  if (!APPLY) {
    console.log("DRY-RUN : aucune écriture. Relancer avec --apply pour migrer.");
    await prisma.$disconnect();
    return;
  }

  // Appliquer : un updateMany par (targetStatus) pour batcher
  console.log("== Application ==");
  const byTarget = new Map<string, string[]>();
  for (const m of toMigrate) {
    const ids = byTarget.get(m.targetStatus) ?? [];
    ids.push(m.id);
    byTarget.set(m.targetStatus, ids);
  }

  let totalUpdated = 0;
  for (const [targetStatus, ids] of byTarget.entries()) {
    const result = await prisma.publicationSlot.updateMany({
      where: { id: { in: ids } },
      data: { status: targetStatus },
    });
    console.log(`  → ${targetStatus.padEnd(18)} : ${result.count} slots mis à jour`);
    totalUpdated += result.count;

    // Log Activity pour traçabilité (BACKFILL_SYNC — même trigger que le rattrapage pipeline)
    for (const slotId of ids) {
      await prisma.publicationActivity.create({
        data: {
          slotId,
          actorId: null,
          type: "STATUS_CHANGED",
          payload: {
            from: "TO_DO",
            to: targetStatus,
            trigger: "BACKFILL_INITIAL_STATUS_BY_SOURCE",
          },
        },
      });
    }
  }

  console.log(`\n✓ Total migré : ${totalUpdated}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
