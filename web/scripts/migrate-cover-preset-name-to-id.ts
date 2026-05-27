/**
 * Migration data : convertit `AccountPattern.coverConfig.coverPresetName` (référence
 * fragile par nom) vers `coverPresetId` (référence stable par UUID).
 *
 * Contexte : avant cette migration, un pattern référençait son preset cover par son
 * nom textuel ("Standard"). Renommer le preset cassait silencieusement tous les
 * patterns qui le pointaient. La migration switch sur l'ID stable du preset.
 *
 * Règles :
 *  - Idempotent : si `coverPresetId` est déjà présent dans coverConfig, on skip.
 *  - Si le preset référencé par nom est introuvable (preset déjà supprimé) :
 *    on laisse `coverPresetName` intact + log d'alerte (l'admin verra le warning
 *    "preset introuvable" dans CoverConfigEditor à la prochaine édition).
 *  - Transaction unique pour atomicité.
 *
 * Usage local :
 *   cd web && npx dotenv -e .env.local -- tsx scripts/migrate-cover-preset-name-to-id.ts
 *
 * Prod :
 *   npx dotenv -e .env.local -- tsx scripts/migrate-cover-preset-name-to-id.ts --apply
 *
 * Dry-run par défaut. `--apply` pour écrire.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

interface CoverConfig {
  enabled?: boolean;
  coverPresetName?: string;
  coverPresetId?: string;
}

interface MigrationStat {
  alreadyMigrated: number;
  resolved: number;
  orphaned: { patternId: string; presetName: string }[];
  noCoverConfig: number;
}

async function main() {
  console.log(`=== ${APPLY ? "APPLY" : "DRY-RUN"} — migration coverPresetName → coverPresetId ===\n`);

  // Charger tous les patterns avec coverMode=auto et coverConfig non null
  const patterns = await prisma.accountPattern.findMany({
    where: {
      coverMode: "auto",
      coverConfig: { not: null as never },
    },
    select: {
      id: true,
      label: true,
      templateId: true,
      coverConfig: true,
    },
  });

  console.log(`Patterns auto avec coverConfig trouvés : ${patterns.length}\n`);
  if (patterns.length === 0) {
    console.log("Rien à migrer.");
    await prisma.$disconnect();
    return;
  }

  const stat: MigrationStat = {
    alreadyMigrated: 0,
    resolved: 0,
    orphaned: [],
    noCoverConfig: 0,
  };
  const updates: { patternId: string; newConfig: CoverConfig }[] = [];

  for (const p of patterns) {
    const cfg = (p.coverConfig as unknown as CoverConfig | null) ?? null;
    if (!cfg) {
      stat.noCoverConfig++;
      continue;
    }

    // Déjà migré
    if (cfg.coverPresetId) {
      stat.alreadyMigrated++;
      continue;
    }

    // Pas de coverPresetName : rien à résoudre (config incohérente côté admin)
    if (!cfg.coverPresetName || !p.templateId) {
      continue;
    }

    const preset = await prisma.templateCoverPreset.findUnique({
      where: {
        templateId_name: { templateId: p.templateId, name: cfg.coverPresetName },
      },
      select: { id: true },
    });

    if (!preset) {
      stat.orphaned.push({ patternId: p.id, presetName: cfg.coverPresetName });
      continue;
    }

    // Nouveau config : on ajoute coverPresetId, on garde coverPresetName comme
    // fallback pendant 1 release (suppression à terme).
    updates.push({
      patternId: p.id,
      newConfig: { ...cfg, coverPresetId: preset.id },
    });
    stat.resolved++;
  }

  console.log("== Rapport ==");
  console.log(`Déjà migrés (skip)                : ${stat.alreadyMigrated}`);
  console.log(`Sans coverConfig (skip)           : ${stat.noCoverConfig}`);
  console.log(`Résolus (prêts à écrire)          : ${stat.resolved}`);
  console.log(`Orphelins (preset introuvable)    : ${stat.orphaned.length}`);
  if (stat.orphaned.length > 0) {
    console.log("\n  → Patterns orphelins (à corriger manuellement) :");
    for (const o of stat.orphaned) {
      console.log(`    - ${o.patternId} (preset "${o.presetName}")`);
    }
  }
  console.log("");

  if (!APPLY) {
    console.log("DRY-RUN — aucune écriture. Relance avec --apply pour migrer.");
    await prisma.$disconnect();
    return;
  }

  if (updates.length === 0) {
    console.log("Rien à écrire.");
    await prisma.$disconnect();
    return;
  }

  console.log("== Application ==");
  await prisma.$transaction(
    updates.map((u) =>
      prisma.accountPattern.update({
        where: { id: u.patternId },
        data: { coverConfig: u.newConfig as never },
      }),
    ),
  );
  console.log(`✓ ${updates.length} patterns migrés (coverPresetId ajouté)`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
