/**
 * Migration data : créer un preset TemplateCoverPreset "Default" par template existant
 * en agrégeant les overlayGroupIds utilisés par les AccountPattern existants.
 * Repointe les patterns pour y ajouter coverPresetName: "Default".
 *
 * Ce script est idempotent : il peut être relancé sans casser quoi que ce soit.
 * Les presets déjà créés sont skippés (contrainte unique templateId+name).
 * Les patterns déjà migrés (coverPresetName déjà présent) ne sont pas retouchés.
 *
 * Usage :
 *   cd web && npx tsx scripts/migrate-cover-config-to-presets.ts
 *
 * Dry-run par défaut. Passer --apply pour écrire en base.
 *   cd web && npx tsx scripts/migrate-cover-config-to-presets.ts --apply
 */

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

interface CoverConfigJson {
  enabled?: boolean;
  frameCount?: number;
  overlayGroupIds?: string[];
  excludeZones?: unknown[];
  excludeSlotIds?: string[];
  offsetX?: number;
  offsetY?: number;
  coverPresetName?: string;
}

function safeJson<T>(raw: Prisma.JsonValue | null | undefined, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  // raw est déjà un objet Prisma Json — pas besoin de parse
  return raw as unknown as T;
}

async function main() {
  console.log(`[migrate-cover-config-to-presets] Mode : ${APPLY ? "APPLY (écriture en DB)" : "DRY-RUN (aucune écriture)"}`);
  console.log("─".repeat(70));

  // 1. Charger tous les templates avec leurs patterns qui ont coverMode=auto
  const templates = await prisma.template.findMany({
    select: {
      id: true,
      name: true,
      accountPatterns: {
        where: { coverMode: "auto" },
        select: { id: true, coverConfig: true, label: true },
      },
      coverPresets: {
        where: { name: "Default" },
        select: { id: true, name: true },
      },
    },
  });

  let presetsCreated = 0;
  let presetsSkipped = 0;
  let patternsUpdated = 0;
  let patternsAlreadyMigrated = 0;
  let templatesWithNoPatterns = 0;
  const anomalies: string[] = [];

  for (const template of templates) {
    const patternsWithAuto = template.accountPatterns;

    // Filtrer les patterns qui ont des overlayGroupIds non vides dans leur coverConfig
    const patternsWithOverlays = patternsWithAuto.filter((p) => {
      const cfg = safeJson<CoverConfigJson>(p.coverConfig, {});
      return Array.isArray(cfg.overlayGroupIds) && cfg.overlayGroupIds.length > 0;
    });

    if (patternsWithOverlays.length === 0) {
      // Pas de patterns exploitables pour ce template
      if (patternsWithAuto.length > 0) {
        anomalies.push(
          `Template "${template.name}" (${template.id}) : ${patternsWithAuto.length} pattern(s) coverMode=auto mais aucun overlayGroupIds non vide — skip`
        );
      } else {
        templatesWithNoPatterns++;
      }
      continue;
    }

    // Agréger les overlayGroupIds distincts de tous les patterns
    const allGroupIds = new Set<string>();
    let frameCount = 36; // valeur par défaut
    let hasExcludeZones = false;
    let hasExcludeSlotIds = false;
    const excludeZonesUnion: unknown[] = [];
    const excludeSlotIdsUnion: string[] = [];

    for (const p of patternsWithOverlays) {
      const cfg = safeJson<CoverConfigJson>(p.coverConfig, {});
      for (const gid of cfg.overlayGroupIds ?? []) {
        allGroupIds.add(gid);
      }
      // Prendre la valeur frameCount la plus fréquente (simplification : on prend celle du premier pattern)
      if (cfg.frameCount && cfg.frameCount > 0) {
        frameCount = cfg.frameCount;
      }
      if (cfg.excludeZones?.length) {
        hasExcludeZones = true;
        for (const z of cfg.excludeZones) excludeZonesUnion.push(z);
      }
      if (cfg.excludeSlotIds?.length) {
        hasExcludeSlotIds = true;
        for (const sid of cfg.excludeSlotIds) {
          if (!excludeSlotIdsUnion.includes(sid)) excludeSlotIdsUnion.push(sid);
        }
      }
    }

    const overlayGroupIds = [...allGroupIds];

    // Avertir si les patterns ont des configs divergentes sur overlayGroupIds
    const uniqueGroupSets = new Set(
      patternsWithOverlays.map((p) =>
        JSON.stringify(
          safeJson<CoverConfigJson>(p.coverConfig, {}).overlayGroupIds?.slice().sort() ?? []
        )
      )
    );
    if (uniqueGroupSets.size > 1) {
      anomalies.push(
        `Template "${template.name}" (${template.id}) : overlayGroupIds divergents entre patterns — union créée (${overlayGroupIds.join(", ")})`
      );
    }

    const presetConfig: CoverConfigJson = {
      enabled: true,
      frameCount,
      overlayGroupIds,
      excludeZones: hasExcludeZones ? excludeZonesUnion : [],
      excludeSlotIds: hasExcludeSlotIds ? excludeSlotIdsUnion : [],
      offsetX: 0,
      offsetY: 0,
    };

    // 2. Créer le preset "Default" si absent
    const existingPreset = template.coverPresets.find((p) => p.name === "Default");
    if (existingPreset) {
      console.log(`  [SKIP] Template "${template.name}" — preset "Default" existe déjà (${existingPreset.id})`);
      presetsSkipped++;
    } else {
      console.log(
        `  [CREATE] Template "${template.name}" — preset "Default" avec overlayGroupIds=[${overlayGroupIds.join(", ")}]`
      );
      if (APPLY) {
        await prisma.templateCoverPreset.create({
          data: {
            templateId: template.id,
            name: "Default",
            config: presetConfig as Prisma.InputJsonValue,
            sortOrder: 0,
          },
        });
      }
      presetsCreated++;
    }

    // 3. Repointer les patterns pour ajouter coverPresetName: "Default"
    for (const pattern of patternsWithOverlays) {
      const cfg = safeJson<CoverConfigJson>(pattern.coverConfig, {});

      if (cfg.coverPresetName) {
        console.log(
          `    [SKIP PATTERN] "${pattern.label}" (${pattern.id}) — coverPresetName déjà présent: "${cfg.coverPresetName}"`
        );
        patternsAlreadyMigrated++;
        continue;
      }

      const updatedConfig: CoverConfigJson = {
        ...cfg,
        coverPresetName: "Default",
      };

      console.log(`    [UPDATE PATTERN] "${pattern.label}" (${pattern.id}) — ajout coverPresetName="Default"`);
      if (APPLY) {
        await prisma.accountPattern.update({
          where: { id: pattern.id },
          data: { coverConfig: updatedConfig as Prisma.InputJsonValue },
        });
      }
      patternsUpdated++;
    }
  }

  console.log("\n" + "─".repeat(70));
  console.log("[Résumé]");
  console.log(`  Templates sans pattern auto : ${templatesWithNoPatterns}`);
  console.log(`  Presets créés              : ${presetsCreated}${APPLY ? "" : " (dry-run)"}`);
  console.log(`  Presets déjà existants     : ${presetsSkipped}`);
  console.log(`  Patterns mis à jour        : ${patternsUpdated}${APPLY ? "" : " (dry-run)"}`);
  console.log(`  Patterns déjà migrés       : ${patternsAlreadyMigrated}`);

  if (anomalies.length > 0) {
    console.log(`\n[Anomalies] (${anomalies.length})`);
    for (const a of anomalies) {
      console.log(`  ! ${a}`);
    }
  } else {
    console.log("  Aucune anomalie");
  }

  console.log("─".repeat(70));
  if (!APPLY) {
    console.log("\n[DRY-RUN] Aucune modification en base. Relancer avec --apply pour appliquer.");
  } else {
    console.log("\n[APPLY] Migration terminée.");
  }
}

main()
  .catch((err) => {
    console.error("[migrate-cover-config-to-presets] Erreur fatale:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
