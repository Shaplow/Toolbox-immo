#!/usr/bin/env tsx
/**
 * Backfill des messages d'échec des MediaAutocutJob.
 *
 * Contexte : jusqu'au fix, le webhook media-autocut écrivait le VRAI message
 * RunPod sur `MediaAutocutBatch.errorMsg` (champ que rien ne lit) et posait une
 * constante générique sur chacun des jobs du batch. Résultat : l'admin voyait
 * « Échec global du job RunPod » sur des dizaines de vidéos, sans jamais savoir
 * ce qui s'était passé. Le message existe, il est juste rangé au mauvais endroit.
 *
 * Ce script le recopie du batch vers ses jobs. Volontairement PAS une migration
 * Prisma : c'est une réparation de données dépendante du contenu de prod, une
 * migration s'exécuterait pour rien en CI et sur toute base neuve.
 *
 * Idempotent (ne réécrit que les messages génériques connus), dry-run par défaut.
 *
 * Usage :
 *   cd web && npx tsx scripts/backfill-autocut-error-msgs.ts            # dry-run
 *   cd web && npx tsx scripts/backfill-autocut-error-msgs.ts --apply    # écriture
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Les constantes qu'écrivaient les anciens chemins d'échec. */
const GENERIC_MESSAGES = [
  "Échec global du job RunPod",
  "Échec soumission RunPod",
  "Erreur lors du traitement des résultats",
];

const ERROR_MAX = 500;

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "Mode ÉCRITURE" : "Mode dry-run (ajouter --apply pour écrire)");

  const batches = await prisma.mediaAutocutBatch.findMany({
    where: { errorMsg: { not: null } },
    select: { id: true, errorMsg: true },
  });
  console.log(`${batches.length} batch(es) porteurs d'un message d'erreur.`);

  let updated = 0;
  for (const batch of batches) {
    const message = (batch.errorMsg ?? "").slice(0, ERROR_MAX);
    if (!message) continue;

    const where = {
      batchId: batch.id,
      status: "failed",
      errorMsg: { in: GENERIC_MESSAGES },
    } as const;

    if (!apply) {
      const n = await prisma.mediaAutocutJob.count({ where });
      if (n > 0) console.log(`  batch=${batch.id} → ${n} job(s) : « ${message.slice(0, 120)} »`);
      updated += n;
      continue;
    }

    const r = await prisma.mediaAutocutJob.updateMany({ where, data: { errorMsg: message } });
    if (r.count > 0) console.log(`  batch=${batch.id} → ${r.count} job(s) mis à jour`);
    updated += r.count;
  }

  // Les jobs dont le batch n'a jamais porté de message (ou dont le batch a été
  // purgé) sont irrécupérables : on les compte pour que le chiffre affiché dans
  // l'atelier ne surprenne pas.
  const orphans = await prisma.mediaAutocutJob.count({
    where: { status: "failed", errorMsg: { in: GENERIC_MESSAGES } },
  });

  console.log(`\n${updated} job(s) ${apply ? "mis à jour" : "à mettre à jour"}.`);
  const remaining = apply ? orphans : Math.max(0, orphans - updated);
  if (remaining > 0) {
    console.log(
      `${remaining} job(s) gardent un message générique : leur batch n'a pas de message ` +
        `(soumission perdue ou batch purgé). Rien à récupérer, il faut relancer l'analyse.`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
