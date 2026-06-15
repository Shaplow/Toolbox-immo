/**
 * P2 — Migration AccountPattern → PatternTemplate + PatternBinding.
 *
 * Pour chaque AccountPattern existant :
 *  1. Calcule une "signature" sur les champs métier (template + presets +
 *     coverConfig + needs* + workflow flags). 2 patterns ayant la même
 *     signature partagent la même recette et seront fusionnés en 1
 *     PatternTemplate unique.
 *  2. Si la signature n'a pas encore de PatternTemplate, le crée (label =
 *     mode le plus fréquent dans le cluster ; defaults raisonnables).
 *  3. Crée un PatternBinding qui pointe vers ce template + copie les champs
 *     spécifiques au compte (publishTime, dayOfWeek, isActive, assignees).
 *  4. Backfille slot.patternBindingId pour les slots qui pointaient sur
 *     l'AccountPattern source (mapping AccountPattern.id → Binding.id).
 *
 * Idempotent : peut être ré-exécuté sans dupliquer (skip si binding existe
 * déjà pour (accountId, patternTemplateId, publishTime, dayOfWeek)).
 *
 * Usage :
 *   cd web && npx dotenv -e .env.local -- tsx scripts/migrate-patterns-to-templates.ts
 *   cd web && npx dotenv -e .env.local -- tsx scripts/migrate-patterns-to-templates.ts --apply
 *
 * Dry-run par défaut.
 */

import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

interface PatternSignatureInput {
  source: string;
  templateId: string | null;
  captionPresetId: string | null;
  descriptionPromptId: string | null;
  coverMode: string;
  coverConfig: unknown;
  needsCaptions: boolean;
  needsCaptionsMode: string;
  needsDescription: string;
  needsAdminValidation: boolean;
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  needsBrief: boolean;
}

function computeSignature(p: PatternSignatureInput): string {
  // Ordre des clés strict pour garantir des hash identiques même si Prisma
  // retourne les champs dans un ordre différent.
  const normalized = {
    source: p.source,
    templateId: p.templateId ?? null,
    captionPresetId: p.captionPresetId ?? null,
    descriptionPromptId: p.descriptionPromptId ?? null,
    coverMode: p.coverMode,
    coverConfig: p.coverConfig ?? null,
    needsCaptions: p.needsCaptions,
    needsCaptionsMode: p.needsCaptionsMode,
    needsDescription: p.needsDescription,
    needsAdminValidation: p.needsAdminValidation,
    needsClientValidation: p.needsClientValidation,
    allowsClientRevision: p.allowsClientRevision,
    needsBrief: p.needsBrief,
  };
  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex")
    .slice(0, 16);
}

function pickLabelForCluster(labels: string[]): string {
  // Label le plus fréquent ; en cas d'égalité, le plus court (plus générique).
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  const sorted = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].length - b[0].length,
  );
  return sorted[0]?.[0] ?? "Recette";
}

async function main() {
  console.log(`\n=== Migration AccountPattern → Template/Binding ===\n`);
  console.log(`Mode : ${APPLY ? "APPLY (écriture DB)" : "DRY-RUN"}`);

  const patterns = await prisma.accountPattern.findMany({
    orderBy: [{ accountId: "asc" }, { createdAt: "asc" }],
  });
  console.log(`\nAccountPattern à migrer : ${patterns.length}`);

  if (patterns.length === 0) {
    console.log("Aucun pattern à migrer. Sortie.");
    return;
  }

  // Étape 1 : clustering par signature.
  const clusters = new Map<string, { signature: string; patterns: typeof patterns }>();
  for (const p of patterns) {
    const sig = computeSignature({
      source: p.source,
      templateId: p.templateId,
      captionPresetId: p.captionPresetId,
      descriptionPromptId: p.descriptionPromptId,
      coverMode: p.coverMode,
      coverConfig: p.coverConfig,
      needsCaptions: p.needsCaptions,
      needsCaptionsMode: p.needsCaptionsMode,
      needsDescription: p.needsDescription,
      needsAdminValidation: p.needsAdminValidation,
      needsClientValidation: p.needsClientValidation,
      allowsClientRevision: p.allowsClientRevision,
      needsBrief: p.needsBrief,
    });
    if (!clusters.has(sig)) clusters.set(sig, { signature: sig, patterns: [] });
    clusters.get(sig)!.patterns.push(p);
  }

  console.log(`Clusters distincts (= PatternTemplates à créer) : ${clusters.size}`);
  for (const c of clusters.values()) {
    const sample = c.patterns[0];
    console.log(
      `  sig=${c.signature} | ${c.patterns.length} pattern(s) | source=${sample.source} | label sample="${sample.label}"`,
    );
  }

  if (!APPLY) {
    console.log("\nDry-run terminé. Relance avec --apply pour écrire.");
    return;
  }

  // Étape 2 : créer / réutiliser PatternTemplate par signature.
  // Idempotence : si un template avec ce label + source existe déjà avec
  // exactement les mêmes champs, on le réutilise. Sinon création.
  const sigToTemplateId = new Map<string, string>();

  for (const cluster of clusters.values()) {
    const sample = cluster.patterns[0];
    const label = pickLabelForCluster(cluster.patterns.map((p) => p.label));

    // Cherche un template existant avec exactement les mêmes valeurs métier.
    const existing = await prisma.patternTemplate.findFirst({
      where: {
        label,
        source: sample.source,
        templateId: sample.templateId,
        captionPresetId: sample.captionPresetId,
        descriptionPromptId: sample.descriptionPromptId,
        coverMode: sample.coverMode,
        needsCaptionsMode: sample.needsCaptionsMode,
        needsDescription: sample.needsDescription,
        needsAdminValidation: sample.needsAdminValidation,
        needsClientValidation: sample.needsClientValidation,
        allowsClientRevision: sample.allowsClientRevision,
        needsBrief: sample.needsBrief,
      },
    });

    let templateId: string;
    if (existing) {
      templateId = existing.id;
      console.log(`[skip] PatternTemplate déjà présent : ${label} (id=${templateId})`);
    } else {
      const created = await prisma.patternTemplate.create({
        data: {
          label,
          source: sample.source,
          templateId: sample.templateId,
          captionPresetId: sample.captionPresetId,
          descriptionPromptId: sample.descriptionPromptId,
          coverMode: sample.coverMode,
          coverConfig:
            sample.coverConfig === null
              ? undefined
              : (sample.coverConfig as object),
          needsCaptions: sample.needsCaptions,
          needsCaptionsMode: sample.needsCaptionsMode,
          needsDescription: sample.needsDescription,
          needsAdminValidation: sample.needsAdminValidation,
          needsClientValidation: sample.needsClientValidation,
          allowsClientRevision: sample.allowsClientRevision,
          needsBrief: sample.needsBrief,
          isArchived: false,
          notes: `Migrée le ${new Date().toISOString().slice(0, 10)} depuis ${cluster.patterns.length} AccountPattern(s).`,
        },
      });
      templateId = created.id;
      console.log(`[create] PatternTemplate : ${label} (id=${templateId})`);
    }
    sigToTemplateId.set(cluster.signature, templateId);
  }

  // Étape 3 : créer un PatternBinding par AccountPattern (ou réutiliser si
  // déjà créé sur un run précédent).
  // Map AccountPattern.id → PatternBinding.id, utile pour le backfill slot.
  const patternIdToBindingId = new Map<string, string>();

  for (const cluster of clusters.values()) {
    const templateId = sigToTemplateId.get(cluster.signature)!;
    for (const p of cluster.patterns) {
      // Idempotence : un binding existant pour (account, template, publishTime)
      // est réutilisé. Évite la duplication sur ré-exécution.
      const existingBinding = await prisma.patternBinding.findFirst({
        where: {
          accountId: p.accountId,
          patternTemplateId: templateId,
          publishTime: p.publishTime,
        },
      });

      let bindingId: string;
      if (existingBinding) {
        bindingId = existingBinding.id;
        console.log(
          `[skip] PatternBinding déjà présent : account=${p.accountId} template=${templateId} (id=${bindingId})`,
        );
      } else {
        const customLabel = (() => {
          const sample = cluster.patterns[0];
          const baseLabel = pickLabelForCluster(cluster.patterns.map((x) => x.label));
          return p.label !== baseLabel ? p.label : null;
        })();
        const created = await prisma.patternBinding.create({
          data: {
            accountId: p.accountId,
            patternTemplateId: templateId,
            customLabel,
            dayOfWeek: p.dayOfWeek,
            publishTime: p.publishTime,
            isActive: p.isActive,
            defaultAssigneeMonteurId: p.defaultAssigneeMonteurId,
            defaultAssigneeCmId: p.defaultAssigneeCmId,
            defaultAssigneeVideasteId: p.defaultAssigneeVideasteId,
            notes: p.notes,
          },
        });
        bindingId = created.id;
        console.log(
          `[create] PatternBinding : account=${p.accountId} publishTime=${p.publishTime} (id=${bindingId})`,
        );
      }
      patternIdToBindingId.set(p.id, bindingId);
    }
  }

  // Étape 4 : backfill slot.patternBindingId pour les slots historiques.
  // On match par patternId existant → binding correspondant. Les slots sans
  // patternId restent inchangés.
  console.log(`\nBackfill slot.patternBindingId…`);
  let updated = 0;
  let skipped = 0;
  for (const [patternId, bindingId] of patternIdToBindingId.entries()) {
    const r = await prisma.publicationSlot.updateMany({
      where: { patternId, patternBindingId: null },
      data: { patternBindingId: bindingId },
    });
    updated += r.count;
    if (r.count === 0) skipped++;
  }
  console.log(
    `Slots backfillés : ${updated} | Patterns sans slots (skip) : ${skipped}`,
  );

  // Stats finales
  const finalTemplateCount = await prisma.patternTemplate.count();
  const finalBindingCount = await prisma.patternBinding.count();
  const slotsWithBinding = await prisma.publicationSlot.count({
    where: { patternBindingId: { not: null } },
  });
  const slotsWithPattern = await prisma.publicationSlot.count({
    where: { patternId: { not: null } },
  });
  console.log(`\n=== Résultat ===`);
  console.log(`PatternTemplate : ${finalTemplateCount}`);
  console.log(`PatternBinding : ${finalBindingCount}`);
  console.log(`Slots avec patternId : ${slotsWithPattern}`);
  console.log(`Slots avec patternBindingId : ${slotsWithBinding}`);
  console.log(
    `Couverture : ${slotsWithPattern > 0 ? Math.round((slotsWithBinding / slotsWithPattern) * 100) : 100}%`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
