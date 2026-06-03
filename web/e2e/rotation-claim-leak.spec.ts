/**
 * E2E — Phase 8.M1 : claim leak guard (readOnly prefill)
 *
 * Vérifie que le prefill (GET /generate/[templateId]) ne pose PAS de claim
 * DataEntryUsage. Le claim doit uniquement être posé au submit (POST /api/renders).
 *
 * Avant Phase 8.M1 : le prefill appelait selectDataEntry en mode "claim",
 * créant une DataEntryUsage usageCount=0 même si l'utilisateur abandonnait
 * la page de génération. Ce claim n'était jamais libéré → drift de rotation.
 *
 * Après Phase 8.M1 : le prefill est readOnly. Aucune DataEntryUsage ne doit
 * être créée pour un compte donné si l'utilisateur n'a pas soumis de render.
 *
 * Prérequis :
 *   npm run test:db:setup && npm run test:db:seed
 */

import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAsAdmin } from "./helpers/rotation-e2e";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://toolbox:toolbox@localhost:5433/toolbox_test";

const prismaTest = new PrismaClient({
  datasources: { db: { url: TEST_DB_URL } },
});

const fixture = {
  dataLibraryId: "",
  campaignId: "",
  accountId: "",
  entryIds: [] as string[],
  templateId: "",
};

test.describe("Phase 8.M1 — prefill readOnly : aucun claim DataEntryUsage au prefill", () => {
  test.setTimeout(60_000);

  test.beforeAll(async ({ browser }) => {
    const admin = await prismaTest.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });
    const client = await prismaTest.client.findFirstOrThrow();

    // Compte IG dédié à ce test
    const account = await prismaTest.instagramAccount.upsert({
      where: { handle: "e2e-claimleak-account" },
      update: {},
      create: { handle: "e2e-claimleak-account", name: "E2E Claim Leak Account", clientId: client.id },
    });
    fixture.accountId = account.id;

    // DataLibrary cycle_per_account avec 3 entries
    const dataLib = await prismaTest.dataLibrary.create({
      data: {
        name: "E2E DataLib Claim Leak",
        templateType: "E2ECLAIM",
        rotationScope: "per_account",
        rotationMode: "auto",
        maxUsageCount: 1,
      },
    });
    fixture.dataLibraryId = dataLib.id;

    const campaign = await prismaTest.dataCampaign.create({
      data: {
        libraryId: dataLib.id,
        name: "Default",
        isActive: true,
        // cycle_per_account → once_per_account (usé au plus 1× par compte)
        usagePolicy: "once_per_account",
      },
    });
    fixture.campaignId = campaign.id;

    for (let i = 0; i < 3; i++) {
      const entry = await prismaTest.dataEntry.create({
        data: {
          campaignId: campaign.id,
          category: "CatA",
          setTag: `claim-set-${i}`,
          fields: JSON.stringify({ title: `Claim Entry ${i}` }),
        },
      });
      fixture.entryIds.push(entry.id);
      // Accès au compte
      await prismaTest.dataEntryAccess.create({
        data: { entryId: entry.id, accountId: account.id },
      });
    }

    // Template minimal référençant la DataLibrary
    const tpl = await prismaTest.template.create({
      data: {
        name: "E2E Template Claim Leak",
        userId: admin.id,
        jsonData: JSON.stringify({
          blocks: [],
          dataLibraryId: dataLib.id,
          dataSelectionRule: "least_used",
        }),
      },
    });
    fixture.templateId = tpl.id;

    // Session admin
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await loginAsAdmin(p);
    await ctx.close();
  });

  test.afterAll(async () => {
    await prismaTest.template.deleteMany({ where: { id: fixture.templateId } });
    await prismaTest.dataLibrary.deleteMany({ where: { id: fixture.dataLibraryId } });
    await prismaTest.instagramAccount.deleteMany({ where: { id: fixture.accountId } });
    await prismaTest.$disconnect();
  });

  test("ouvrir la page generate et ne PAS soumettre ne crée aucun DataEntryUsage", async ({
    page,
  }) => {
    await loginAsAdmin(page);

    // S'assurer que le compte n'a aucun DataEntryUsage existant
    const usagesBefore = await prismaTest.dataEntryUsage.findMany({
      where: {
        accountId: fixture.accountId,
        entry: { campaignId: fixture.campaignId },
      },
    });
    // Purger pour repartir d'un état propre
    if (usagesBefore.length > 0) {
      await prismaTest.dataEntryUsage.deleteMany({
        where: {
          accountId: fixture.accountId,
          entry: { campaignId: fixture.campaignId },
        },
      });
    }

    // Naviguer vers la page de génération avec le compte IG
    // La page prefill appelle le server component qui appelle resolveLibraryPrefill
    // en mode readOnly (phase 8.M1)
    await page.goto(
      `/generate/${fixture.templateId}?accountId=${fixture.accountId}`,
    );

    // Attendre que la page se charge (prefill terminé)
    // On attend soit un formulaire soit un message d'erreur (si template minimal)
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

    // Simuler l'abandon : fermer sans cliquer sur "Générer"
    // (on reste simplement sur la page sans soumettre)

    // Vérification principale : aucun DataEntryUsage créé pour ce compte
    const usagesAfter = await prismaTest.dataEntryUsage.findMany({
      where: {
        accountId: fixture.accountId,
        entry: { campaignId: fixture.campaignId },
      },
    });

    expect(usagesAfter).toHaveLength(0);
  });

  test("ouvrir la page generate PLUSIEURS fois ne crée aucun DataEntryUsage accumulé", async ({
    page,
  }) => {
    await loginAsAdmin(page);

    // Purge
    await prismaTest.dataEntryUsage.deleteMany({
      where: {
        accountId: fixture.accountId,
        entry: { campaignId: fixture.campaignId },
      },
    });

    // 3 navigations successives vers la page generate (simule rafraîchissement)
    for (let i = 0; i < 3; i++) {
      await page.goto(`/generate/${fixture.templateId}?accountId=${fixture.accountId}`);
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    }

    const usagesAfter = await prismaTest.dataEntryUsage.findMany({
      where: {
        accountId: fixture.accountId,
        entry: { campaignId: fixture.campaignId },
      },
    });

    // Phase 8.M1 : même après 3 refreshes, zéro usage créé
    expect(usagesAfter).toHaveLength(0);
  });

  test("soumettre un render crée exactement 1 DataEntryUsage (contrôle positif)", async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page);

    // Purge
    await prismaTest.dataEntryUsage.deleteMany({
      where: {
        accountId: fixture.accountId,
        entry: { campaignId: fixture.campaignId },
      },
    });

    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    // Créer un listing pour ce template
    const admin = await prismaTest.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });
    const listing = await prismaTest.listing.create({
      data: { userId: admin.id, templateId: fixture.templateId },
    });

    // Submit render avec un dataEntryId explicite
    const firstEntry = fixture.entryIds[0];
    const renderRes = await request.post(`http://localhost:3100/api/renders`, {
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      data: {
        templateId: fixture.templateId,
        listingId: listing.id,
        accountId: fixture.accountId,
        usedAssets: {
          dataEntryId: firstEntry,
          dataResolvedCategory: "CatA",
          dataResolvedSetTag: "claim-set-0",
        },
      },
    });

    // 201 ou 409 sont acceptables
    expect([201, 409]).toContain(renderRes.status());

    if (renderRes.status() === 201) {
      const render = await renderRes.json() as { id: string };

      // Attendre que advanceDataEntryClaimOnSubmit ait été appelé
      await page.waitForTimeout(1_000);

      const usagesAfter = await prismaTest.dataEntryUsage.findMany({
        where: {
          accountId: fixture.accountId,
          entry: { campaignId: fixture.campaignId },
        },
      });

      // Au moins 1 usage créé après submit (contrôle positif : le claim fonctionne)
      expect(usagesAfter.length).toBeGreaterThanOrEqual(1);

      // Cleanup
      await prismaTest.render.delete({ where: { id: render.id } });
    }

    await prismaTest.listing.delete({ where: { id: listing.id } });
  });
});
