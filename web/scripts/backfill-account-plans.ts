/**
 * Backfill AccountPlan depuis les OfferScheduleRule actives.
 *
 * Pour chaque InstagramAccount, on cherche les OfferScheduleRule isActive=true
 * dont offre = account.offre. Pour chaque règle, on résout la ContentRecipe dont
 * le code = rule.contentType. Si la combinaison (accountId, dayOfWeek, publishTime,
 * recipeId) n'existe pas encore, on crée l'AccountPlan.
 *
 * Ce script est idempotent : il peut être relancé sans créer de doublons.
 *
 * IMPORTANT : au premier passage, il est attendu que le script ne crée rien si les
 * ContentRecipe n'ont pas encore été seedées via /api/admin/recipes/seed-from-templates.
 *
 * Usage local :
 *   cd web && npm run db:backfill-plans
 *   (dry-run par défaut — affiche ce qui SERAIT créé sans écrire)
 *
 * Pour écrire en base :
 *   cd web && npm run db:backfill-plans -- --commit
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const COMMIT = process.argv.includes("--commit");

async function main() {
  if (!COMMIT) {
    console.log("=== DRY-RUN (passer --commit pour écrire en base) ===\n");
  } else {
    console.log("=== MODE COMMIT — transaction unique, écriture en base ===\n");
  }

  // 1. Charger tous les comptes Instagram
  const accounts = await prisma.instagramAccount.findMany({
    select: { id: true, handle: true, offre: true },
    orderBy: { handle: "asc" },
  });
  console.log(`${accounts.length} compte(s) Instagram trouvé(s).`);

  // 2. Charger toutes les règles actives
  const rules = await prisma.offerScheduleRule.findMany({
    where: { isActive: true },
    select: { id: true, offre: true, dayOfWeek: true, publishTime: true, contentType: true },
    orderBy: [{ offre: "asc" }, { dayOfWeek: "asc" }, { publishTime: "asc" }],
  });
  console.log(`${rules.length} OfferScheduleRule active(s) trouvée(s).`);

  // 3. Charger toutes les recipes : index par code
  const allRecipes = await prisma.contentRecipe.findMany({
    select: { id: true, code: true, label: true },
  });
  const recipeByCode = new Map(allRecipes.map((r) => [r.code, r]));
  console.log(`${allRecipes.length} ContentRecipe(s) disponible(s).\n`);

  // 4. Charger tous les AccountPlan existants pour la détection de doublons
  const existingPlans = await prisma.accountPlan.findMany({
    select: { accountId: true, dayOfWeek: true, publishTime: true, recipeId: true },
  });
  // Set de clés composites pour lookup O(1)
  const existingKeys = new Set(
    existingPlans.map(
      (p) => `${p.accountId}::${p.dayOfWeek}::${p.publishTime}::${p.recipeId}`,
    ),
  );
  console.log(`${existingPlans.length} AccountPlan(s) déjà en base.\n`);

  // 5. Construire la liste des AccountPlan à créer
  type PlanToCreate = {
    accountId: string;
    handle: string;
    recipeId: string;
    recipeCode: string;
    dayOfWeek: number;
    publishTime: string;
  };

  const toCreate: PlanToCreate[] = [];

  for (const account of accounts) {
    const accountRules = rules.filter((r) => r.offre === account.offre);
    if (accountRules.length === 0) continue;

    for (const rule of accountRules) {
      const recipe = recipeByCode.get(rule.contentType);

      if (!recipe) {
        console.log(
          `  [SKIP] recipe "${rule.contentType}" not found for account ${account.handle} ` +
            `(rule id=${rule.id}) — seed recipes first via /api/admin/recipes/seed-from-templates`,
        );
        continue;
      }

      const key = `${account.id}::${rule.dayOfWeek}::${rule.publishTime}::${recipe.id}`;
      if (existingKeys.has(key)) {
        console.log(
          `  [EXISTS] account=${account.handle}  recipe=${recipe.code}` +
            `  day=${rule.dayOfWeek}  time=${rule.publishTime}  — déjà en base`,
        );
        continue;
      }

      toCreate.push({
        accountId: account.id,
        handle: account.handle,
        recipeId: recipe.id,
        recipeCode: recipe.code,
        dayOfWeek: rule.dayOfWeek,
        publishTime: rule.publishTime,
      });

      console.log(
        `  [CREATE] account=${account.handle}  recipe=${recipe.code}` +
          `  day=${rule.dayOfWeek}  time=${rule.publishTime}`,
      );
    }
  }

  console.log(
    `\n${toCreate.length} AccountPlan(s) à créer${COMMIT ? "" : " (dry-run — rien n'a été écrit)"}.`,
  );

  if (!COMMIT || toCreate.length === 0) {
    if (toCreate.length > 0) {
      console.log("Relancer avec --commit pour appliquer.");
    }
    return;
  }

  // 6. Transaction unique
  await prisma.$transaction(async (tx) => {
    for (const plan of toCreate) {
      await tx.accountPlan.create({
        data: {
          accountId: plan.accountId,
          recipeId: plan.recipeId,
          dayOfWeek: plan.dayOfWeek,
          publishTime: plan.publishTime,
          isActive: true,
        },
      });
    }
  });

  console.log(`\nTerminé. ${toCreate.length} AccountPlan(s) créé(s) en base.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
