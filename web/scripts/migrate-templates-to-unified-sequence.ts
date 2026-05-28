/**
 * Migration data : tous les Template du mode "single video block" vers le mode
 * unifié videoSequence avec 1 slot par défaut.
 *
 * Pour chaque Template :
 *   - Parse jsonData → TemplateJSON
 *   - Applique ensureVideoSequence :
 *       - Si videoSequence non-vide ou pas de VideoBlock → no-op (skipped)
 *       - Sinon : crée 1 slot avec videoBlockId/binding/libraryId/selectionRule
 *         copiés du VideoBlock principal
 *   - Réécrit jsonData en base si modifié
 *
 * Idempotent : ré-applicable sans casser. Les Template déjà migrés ou sans
 * VideoBlock sont skippés silencieusement.
 *
 * Usage :
 *   cd web && npx tsx scripts/migrate-templates-to-unified-sequence.ts
 *     → dry-run : compte les changements, n'écrit rien.
 *
 *   cd web && npx tsx scripts/migrate-templates-to-unified-sequence.ts --apply
 *     → applique en DB. Backup obligatoire avant (npm run db:backup).
 */

import { PrismaClient } from "@prisma/client";
import type { TemplateJSON } from "../src/types/template";
import { ensureVideoSequence } from "../src/lib/videoSequenceUtils";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function main() {
  console.log(`[migrate-templates-to-unified-sequence] Mode : ${APPLY ? "APPLY (écriture en DB)" : "DRY-RUN (aucune écriture)"}`);
  console.log("─".repeat(70));

  const templates = await prisma.template.findMany({
    select: { id: true, name: true, jsonData: true },
  });

  let migrated = 0;
  let alreadyOk = 0;
  let noVideoBlock = 0;
  let parseFailed = 0;

  for (const tpl of templates) {
    let parsed: TemplateJSON;
    try {
      parsed = JSON.parse(tpl.jsonData) as TemplateJSON;
    } catch (err) {
      parseFailed += 1;
      console.warn(`  ⚠️  ${tpl.id} (${tpl.name}) : jsonData invalide — skip. Erreur :`, err);
      continue;
    }

    const out = ensureVideoSequence(parsed, makeId);

    if (out === parsed) {
      // Cas 1 : déjà non-vide (idempotent skip)
      // Cas 2 : pas de VideoBlock (rien à migrer)
      if ((parsed.videoSequence?.length ?? 0) > 0) {
        alreadyOk += 1;
      } else {
        noVideoBlock += 1;
      }
      continue;
    }

    // Modifié : on a une nouvelle videoSequence
    const newSlot = out.videoSequence?.[0];
    console.log(`  ✏️  ${tpl.id} (${tpl.name})`);
    console.log(`       → slot ajouté : id=${newSlot?.id} videoBlockId=${newSlot?.videoBlockId} libraryId=${newSlot?.libraryId ?? "—"} binding=${newSlot?.binding ?? "—"}`);

    if (APPLY) {
      await prisma.template.update({
        where: { id: tpl.id },
        data: { jsonData: JSON.stringify(out) },
      });
    }
    migrated += 1;
  }

  console.log("─".repeat(70));
  console.log(`Total templates       : ${templates.length}`);
  console.log(`Migrés                : ${migrated} ${APPLY ? "(écrits en DB)" : "(dry-run)"}`);
  console.log(`Déjà OK (videoSequence non-vide) : ${alreadyOk}`);
  console.log(`Sans VideoBlock (non migrables)  : ${noVideoBlock}`);
  if (parseFailed > 0) {
    console.log(`jsonData invalide     : ${parseFailed}`);
  }
  console.log("─".repeat(70));

  if (!APPLY && migrated > 0) {
    console.log("Pour appliquer : npx tsx scripts/migrate-templates-to-unified-sequence.ts --apply");
  }
}

main()
  .catch((err) => {
    console.error("Migration échouée :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
