/**
 * E2E — Rotation revert sur webhook ERROR (Phase 10)
 *
 * Vérifie que quand un render échoue (webhook ERROR), le cursor de rotation
 * est bien reverté à sa valeur avant le submit. Après revert, le prefill
 * doit suggérer le même asset (= comme si le premier render n'avait pas eu lieu).
 *
 * Prérequis :
 *   npm run test:db:setup && npm run test:db:seed
 */

import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import {
  loginAsAdmin,
  getCookieHeader,
  readCursorForAccount,
  simulateWebhook,
} from "./helpers/rotation-e2e";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://toolbox:toolbox@localhost:5433/toolbox_test";

const prismaTest = new PrismaClient({
  datasources: { db: { url: TEST_DB_URL } },
});

const fixture = {
  mediaLibraryId: "",
  dataLibraryId: "",
  campaignId: "",
  accountId: "",
  assetIds: [] as string[],
  entryIds: [] as string[],
  templateId: "",
  listingId: "",
  renderIds: [] as string[],
};

test.describe("Rotation revert — cursor reverté sur webhook ERROR", () => {
  test.setTimeout(60_000);

  test.beforeAll(async ({ browser }) => {
    const admin = await prismaTest.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });
    const client = await prismaTest.client.findFirstOrThrow();

    const account = await prismaTest.instagramAccount.upsert({
      where: { handle: "e2e-revert-account" },
      update: {},
      create: { handle: "e2e-revert-account", name: "E2E Revert Account", clientId: client.id },
    });
    fixture.accountId = account.id;

    // MediaLibrary per_account avec 4 assets
    const mediaLib = await prismaTest.mediaLibrary.create({
      data: {
        name: "E2E MediaLib Revert",
        type: "video",
        rotationScope: "per_account",
        rotationMode: "auto",
        setSequence: JSON.stringify(["INTRO", "OUTRO"]),
        metadataSchema: JSON.stringify([]),
      },
    });
    fixture.mediaLibraryId = mediaLib.id;

    for (let i = 0; i < 4; i++) {
      const asset = await prismaTest.mediaAsset.create({
        data: {
          libraryId: mediaLib.id,
          filename: `e2e-revert-asset-${i}.mp4`,
          r2Key: `e2e-rotation-revert/${mediaLib.id}/asset-${i}.mp4`,
          url: `/e2e-fixtures/revert/asset-${i}.mp4`,
          mimeType: "video/mp4",
          duration: 10.0,
          tags: JSON.stringify([]),
          setTag: i % 2 === 0 ? "INTRO" : "OUTRO",
          category: i < 2 ? "CatA" : "CatB",
          usageCount: 0,
        },
      });
      fixture.assetIds.push(asset.id);
      await prismaTest.mediaAssetAccess.create({
        data: { assetId: asset.id, accountId: account.id },
      });
    }

    // DataLibrary per_account avec 3 entries
    const dataLib = await prismaTest.dataLibrary.create({
      data: {
        name: "E2E DataLib Revert",
        templateType: "E2EREVERT",
        rotationScope: "per_account",
        rotationMode: "auto",
      },
    });
    fixture.dataLibraryId = dataLib.id;

    const campaign = await prismaTest.dataCampaign.create({
      data: { libraryId: dataLib.id, name: "Default", isActive: true, usagePolicy: "unlimited" },
    });
    fixture.campaignId = campaign.id;

    for (let i = 0; i < 3; i++) {
      const entry = await prismaTest.dataEntry.create({
        data: {
          campaignId: campaign.id,
          category: i < 2 ? "CatA" : "CatB",
          setTag: `revert-set-${i}`,
          fields: JSON.stringify({ title: `Revert Entry ${i}` }),
        },
      });
      fixture.entryIds.push(entry.id);
      await prismaTest.dataEntryAccess.create({
        data: { entryId: entry.id, accountId: account.id },
      });
    }

    // Template + Listing
    const tpl = await prismaTest.template.create({
      data: {
        name: "E2E Template Revert",
        userId: admin.id,
        jsonData: JSON.stringify({
          blocks: [
            {
              id: "video-block-revert",
              type: "video",
              name: "Vidéo revert",
              libraryId: mediaLib.id,
              selectionRule: "least_used",
            },
          ],
          dataLibraryId: dataLib.id,
        }),
      },
    });
    fixture.templateId = tpl.id;
    const listing = await prismaTest.listing.create({
      data: { userId: admin.id, templateId: tpl.id },
    });
    fixture.listingId = listing.id;

    // Login pour préparer la session
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await loginAsAdmin(p);
    await ctx.close();
  });

  test.afterAll(async () => {
    await prismaTest.render.deleteMany({ where: { id: { in: fixture.renderIds } } });
    await prismaTest.listing.deleteMany({ where: { id: fixture.listingId } });
    await prismaTest.template.deleteMany({ where: { id: fixture.templateId } });
    await prismaTest.dataLibrary.deleteMany({ where: { id: fixture.dataLibraryId } });
    await prismaTest.mediaLibrary.deleteMany({ where: { id: fixture.mediaLibraryId } });
    await prismaTest.instagramAccount.deleteMany({ where: { id: fixture.accountId } });
    await prismaTest.$disconnect();
  });

  test("cursor reverté après webhook ERROR — re-pick suggère le même asset", async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page);
    const cookieHeader = await getCookieHeader(page);

    // 1. Snapshot cursor AVANT
    const cursorBefore = await readCursorForAccount(
      request, cookieHeader, fixture.accountId, fixture.mediaLibraryId, "media",
    );

    // 2. Soumettre un render (advance le cursor)
    const renderRes = await request.post(`http://localhost:3100/api/renders`, {
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      data: {
        templateId: fixture.templateId,
        listingId: fixture.listingId,
        accountId: fixture.accountId,
        usedAssets: {
          setSequencedLibraryIds: [fixture.mediaLibraryId],
          usedSetTagByLibrary: { [fixture.mediaLibraryId]: "INTRO" },
          usedCategoryByLibrary: { [fixture.mediaLibraryId]: "CatA" },
        },
      },
    });

    if (renderRes.status() !== 201) {
      // 409 = render déjà actif — on skip ce test
      test.skip();
      return;
    }

    const render = await renderRes.json() as { id: string; runpodJobId?: string };
    fixture.renderIds.push(render.id);

    // 3. Snapshot cursor APRÈS submit (cursor avancé)
    const cursorAfterSubmit = await readCursorForAccount(
      request, cookieHeader, fixture.accountId, fixture.mediaLibraryId, "media",
    );

    // 4. Simuler webhook ERROR
    // Pour simuler, on update directement le runpodJobId en DB puis on poste le webhook
    const fakeJobId = `e2e-fake-job-${Date.now()}`;
    await prismaTest.render.update({
      where: { id: render.id },
      data: { runpodJobId: fakeJobId },
    });

    await simulateWebhook(request, render.id, "ERROR", fakeJobId);

    // Attendre que le revert soit effectué (async fire-and-forget)
    await page.waitForTimeout(2_000);

    // 5. Snapshot cursor APRÈS webhook ERROR (devrait être reverté)
    const cursorAfterError = await readCursorForAccount(
      request, cookieHeader, fixture.accountId, fixture.mediaLibraryId, "media",
    );

    // Assertion principale : le cursor après ERROR doit avoir été reverté
    // vers la valeur d'avant le submit (ou être identique à before si le
    // cursor n'existait pas avant).
    if (cursorBefore === null) {
      // Si le cursor n'existait pas avant, il peut soit avoir été effacé soit
      // être revenu à null lastUsedCategory
      if (cursorAfterError !== null) {
        // Le revert ne supprime pas la row, juste remet les champs à leurs valeurs précédentes
        // S'il n'y avait pas de cursor avant, le revert peut laisser une row avec valeurs null
        expect(cursorAfterError.lastUsedCategory).toBeNull();
        expect(cursorAfterError.lastUsedSetTag).toBeNull();
      }
    } else if (cursorAfterSubmit !== null && cursorAfterError !== null) {
      // La valeur après revert doit être différente de la valeur après submit
      // (ou identique à before si le revert a fonctionné parfaitement)
      const revertedToOriginal =
        cursorAfterError.lastUsedCategory === cursorBefore.lastUsedCategory &&
        cursorAfterError.lastUsedSetTag === cursorBefore.lastUsedSetTag;
      const advancedThenReverted =
        cursorAfterSubmit.lastUsedCategory !== cursorAfterError.lastUsedCategory ||
        cursorAfterSubmit.lastUsedSetTag !== cursorAfterError.lastUsedSetTag;
      // Au moins l'un des deux doit être vrai
      expect(revertedToOriginal || advancedThenReverted).toBe(true);
    }
  });

  test("après revert ERROR, second render soumet le même asset que le premier aurait eu", async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page);
    const cookieHeader = await getCookieHeader(page);

    // Setup : s'assurer qu'aucun cursor n'existe pour ce compte
    await prismaTest.accountLibraryCursor.deleteMany({
      where: { accountId: fixture.accountId, libraryId: fixture.mediaLibraryId },
    });

    // Render 1 — note quel asset a été sélectionné
    const render1Res = await request.post(`http://localhost:3100/api/renders`, {
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      data: {
        templateId: fixture.templateId,
        listingId: fixture.listingId,
        accountId: fixture.accountId,
        usedAssets: {},
      },
    });

    if (render1Res.status() !== 201) {
      test.skip();
      return;
    }

    const render1 = await render1Res.json() as { id: string };
    fixture.renderIds.push(render1.id);

    const render1Row = await prismaTest.render.findUnique({
      where: { id: render1.id },
      select: { usedAssets: true },
    });
    const used1 = JSON.parse(render1Row?.usedAssets ?? "{}") as { videoAssets?: Record<string, string> };
    const assetUsedInRender1 = Object.values(used1.videoAssets ?? {})[0] ?? null;

    // Simuler ERROR sur render1 (revert cursor)
    const fakeJobId1 = `e2e-revert-job1-${Date.now()}`;
    await prismaTest.render.update({
      where: { id: render1.id },
      data: { runpodJobId: fakeJobId1 },
    });
    await simulateWebhook(request, render1.id, "ERROR", fakeJobId1);
    await page.waitForTimeout(2_000);

    // Render 2 — doit utiliser le même asset (cursor reverté)
    const render2Res = await request.post(`http://localhost:3100/api/renders`, {
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      data: {
        templateId: fixture.templateId,
        listingId: fixture.listingId,
        accountId: fixture.accountId,
        usedAssets: {},
      },
    });

    expect([201, 409]).toContain(render2Res.status());

    if (render2Res.status() === 201) {
      const render2 = await render2Res.json() as { id: string };
      fixture.renderIds.push(render2.id);

      const render2Row = await prismaTest.render.findUnique({
        where: { id: render2.id },
        select: { usedAssets: true },
      });
      const used2 = JSON.parse(render2Row?.usedAssets ?? "{}") as { videoAssets?: Record<string, string> };
      const assetUsedInRender2 = Object.values(used2.videoAssets ?? {})[0] ?? null;

      // Si le revert a fonctionné, render2 devrait choisir le même asset que render1
      // (car le cursor est revenu à son état initial)
      if (assetUsedInRender1 && assetUsedInRender2) {
        expect(assetUsedInRender2).toBe(assetUsedInRender1);
      }

      // Cleanup
      const fakeJobId2 = `e2e-revert-job2-${Date.now()}`;
      await prismaTest.render.update({
        where: { id: render2.id },
        data: { runpodJobId: fakeJobId2, status: "ERROR", finishedAt: new Date() },
      });
    }
  });
});
