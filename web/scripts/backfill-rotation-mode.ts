/**
 * Matérialise `MediaLibrary.rotationMode` là où il vaut encore `NULL`.
 *
 * Applique exactement la règle legacy — `séquence non vide ? "override" : "auto"` —
 * donc **aucun changement de comportement**. L'intérêt est de rendre la colonne
 * auto-portante avant qu'elle ne devienne le discriminant du moteur : après ce
 * backfill, plus aucune bibliothèque ne dépend de la déduction implicite, et la
 * colonne peut passer en `NOT NULL DEFAULT 'auto'`.
 *
 * À lancer AVANT le déploiement du correctif de rotation, et APRÈS
 * `scripts/audit-rotation.ts`.
 *
 *   cd web && npx dotenv -e .env.local -- tsx scripts/backfill-rotation-mode.ts          # dry-run
 *   cd web && npx dotenv -e .env.local -- tsx scripts/backfill-rotation-mode.ts --apply  # écrit
 */

import { PrismaClient } from "@prisma/client";
import { parseSetSequence } from "../src/lib/rotation/rotationMode";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const libs = await prisma.mediaLibrary.findMany({
    where: { rotationMode: null },
    select: { id: true, name: true, setSequence: true },
    orderBy: { name: "asc" },
  });

  if (libs.length === 0) {
    console.log("Aucune bibliothèque avec rotationMode = NULL. Rien à faire.");
    return;
  }

  let auto = 0;
  let override = 0;
  for (const lib of libs) {
    const sequence = parseSetSequence(lib.setSequence);
    const mode = sequence.length > 0 ? "override" : "auto";
    if (mode === "auto") auto += 1;
    else override += 1;
    console.log(`  ${lib.name.padEnd(38).slice(0, 38)} séquence=${String(sequence.length).padStart(3)} → ${mode}`);
    if (APPLY) {
      await prisma.mediaLibrary.update({ where: { id: lib.id }, data: { rotationMode: mode } });
    }
  }

  console.log(
    `\n${libs.length} bibliothèque(s) : ${auto} → auto, ${override} → override.` +
      `\nTerminé${APPLY ? "." : " (dry-run — relancer avec --apply pour écrire)."}`,
  );
}

main()
  .catch((err) => {
    console.error("[backfill-rotation-mode] échec :", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
