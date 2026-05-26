/**
 * D3 — Cleanup pattern.coverConfig legacy fields
 *
 * For each AccountPattern, transforms coverConfig from:
 *   { enabled, frameCount, overlayGroupIds, offsetX, offsetY, excludeZones, excludeSlotIds, coverPresetName, ... }
 * to:
 *   { enabled, coverPresetName }
 *
 * All other fields are dropped. This is safe because the detail has been
 * migrated to TemplateCoverPreset in Wave A3.
 *
 * Run: npx tsx scripts/cleanup-pattern-cover-config.ts
 *
 * Pre-conditions:
 *   - A database backup was taken (npm run db:backup)
 *   - All patterns with coverMode=auto that have legacy fields are reviewed
 */

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const LEGACY_FIELDS = [
  "frameCount",
  "overlayGroupIds",
  "offsetX",
  "offsetY",
  "excludeZones",
  "excludeSlotIds",
];

async function main() {
  const patterns = await prisma.accountPattern.findMany({
    select: { id: true, label: true, coverConfig: true, coverMode: true },
  });

  console.log(`Found ${patterns.length} patterns total.`);

  let updated = 0;
  let skipped = 0;

  for (const pattern of patterns) {
    const cfg = pattern.coverConfig as Record<string, unknown> | null;
    if (!cfg) {
      skipped++;
      continue;
    }

    // Check if any legacy field is present
    const hasLegacyField = LEGACY_FIELDS.some((f) => f in cfg);
    if (!hasLegacyField) {
      skipped++;
      continue;
    }

    // Build new config: only keep enabled + coverPresetName
    const newConfig: Record<string, unknown> = {};
    if ("enabled" in cfg) newConfig.enabled = cfg.enabled;
    if ("coverPresetName" in cfg) newConfig.coverPresetName = cfg.coverPresetName;

    const droppedFields = LEGACY_FIELDS.filter((f) => f in cfg);
    console.log(
      `[UPDATE] Pattern "${pattern.label}" (${pattern.id}) — dropping: ${droppedFields.join(", ")}`
    );

    await prisma.accountPattern.update({
      where: { id: pattern.id },
      data: { coverConfig: newConfig as Prisma.InputJsonValue },
    });
    updated++;
  }

  console.log(`\nDone. Updated: ${updated}, Skipped (no legacy fields): ${skipped}`);
}

main()
  .catch((err: unknown) => {
    console.error("ERROR:", err);
    process.exit(1);
  })
  .finally(() => { void prisma.$disconnect(); });
