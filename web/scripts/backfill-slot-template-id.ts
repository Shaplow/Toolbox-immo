/**
 * Backfill `PublicationSlot.templateId` depuis le gabarit de la recette.
 *
 * POURQUOI. `createSlot` n'écrivait pas le gabarit builder de la recette sur le
 * slot, là où `generateCalendarSlots` (cron) et `attachMissionsToEntity` le
 * faisaient. Résultat : les publications nées de la modale de création ou du
 * remplissage de semaine n'affichent pas le lien « Ouvrir le formulaire de
 * génération » dans le drawer du calendrier — elles ne sont lançables depuis
 * nulle part. Le code est corrigé, mais seulement pour les nouvelles.
 *
 * Ce script répare les anciennes. Il ne touche QUE les slots dont `templateId`
 * est null et dont la recette effective en porte un : aucune valeur existante
 * n'est écrasée.
 *
 * Usage :
 *   cd web && npx dotenv -e .env.local -- tsx scripts/backfill-slot-template-id.ts        # dry-run
 *   cd web && npx dotenv -e .env.local -- tsx scripts/backfill-slot-template-id.ts --apply
 *
 * Sur la prod, faire un `npm run db:backup` avant l'exécution avec --apply.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  // Les deux façons dont un slot porte une recette : le binding (cas courant)
  // ou la recette globale directe (missions sans compte).
  const slots = await prisma.publicationSlot.findMany({
    where: {
      templateId: null,
      OR: [{ patternBindingId: { not: null } }, { patternTemplateId: { not: null } }],
    },
    select: {
      id: true,
      title: true,
      patternBinding: { select: { patternTemplate: { select: { templateId: true } } } },
      patternTemplate: { select: { templateId: true } },
    },
  });

  const toFix = slots
    .map((s) => ({
      id: s.id,
      title: s.title,
      templateId:
        s.patternBinding?.patternTemplate.templateId ?? s.patternTemplate?.templateId ?? null,
    }))
    .filter((s): s is { id: string; title: string | null; templateId: string } => !!s.templateId);

  console.log(`${slots.length} publication(s) sans gabarit et rattachée(s) à une recette.`);
  console.log(`${toFix.length} réparable(s) — les autres ont une recette sans gabarit.`);

  if (toFix.length === 0) return;

  if (!APPLY) {
    for (const s of toFix.slice(0, 20)) {
      console.log(`  ${s.id}  ${s.title ?? "(sans titre)"} → ${s.templateId}`);
    }
    if (toFix.length > 20) console.log(`  … et ${toFix.length - 20} autres`);
    console.log("\nDry-run. Relancer avec --apply pour écrire.");
    return;
  }

  // Groupé par gabarit : quelques updateMany plutôt qu'un update par slot.
  const byTemplate = new Map<string, string[]>();
  for (const s of toFix) {
    const ids = byTemplate.get(s.templateId);
    if (ids) ids.push(s.id);
    else byTemplate.set(s.templateId, [s.id]);
  }

  let written = 0;
  for (const [templateId, ids] of byTemplate) {
    const res = await prisma.publicationSlot.updateMany({
      // `templateId: null` re-vérifié ici : si quelque chose a écrit entre la
      // lecture et l'écriture, on ne l'écrase pas.
      where: { id: { in: ids }, templateId: null },
      data: { templateId },
    });
    written += res.count;
  }
  console.log(`${written} publication(s) mise(s) à jour.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
