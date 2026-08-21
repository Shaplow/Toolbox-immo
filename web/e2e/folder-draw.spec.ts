/**
 * E2E — Folder-draw claim d'usage au submit (Plan simplification Phase 4)
 *
 * Remplace les 4 specs rotation-*.spec.ts (curseurs/catégories, décommissionnés).
 * Teste avec la vraie DB de test que POST /api/renders stampe bien
 * MediaAssetUsage.lastUsedAt / DataEntryUsage.lastUsedAt au submit (claim),
 * pour le bon compte, sans toucher aux autres comptes.
 *
 * Prérequis :
 *   npm run test:db:setup && npm run test:db:seed
 *
 * Infrastructure : PrismaClient direct pour les fixtures (les assets ne
 * peuvent pas être créés via upload R2 réel en test) — pattern de l'ancien
 * rotation-flow.spec.ts (cf. `git show HEAD:web/e2e/rotation-flow.spec.ts`).
 * POST /api/renders retourne 201 dès que le claim est posé et le render créé
 * (PENDING→PROCESSING) — la génération réelle tourne en fire-and-forget
 * ensuite (startRenderGeneration) et n'affecte pas nos assertions.
 */

import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAsAdmin, getCookieHeader } from "./helpers/rotation-e2e";
import { SHARED_USAGE_ACCOUNT_ID } from "../src/lib/rotation/sentinels";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://toolbox:toolbox@localhost:5433/toolbox_test";

const prismaTest = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });

const fixture = {
  accountId: "",
  otherAccountId: "",
  mediaLibraryId: "",
  dataLibraryId: "",
  mediaAssetIds: [] as string[],
  dataEntryIds: [] as string[],
  // P8 fix #4 — bibliothèque `shared` dédiée : une génération SANS accountId
  // doit quand même claimer, sous la sentinelle __shared__.
  sharedMediaLibraryId: "",
  sharedMediaAssetIds: [] as string[],
  templateId: "",
  listingId: "",
  renderIds: [] as string[],
};

test.describe("Folder-draw — claim d'usage au submit (POST /api/renders)", () => {
  test.setTimeout(60_000);

  test.beforeAll(async ({ browser }) => {
    const admin = await prismaTest.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });
    const client = await prismaTest.client.findFirstOrThrow();

    const account = await prismaTest.instagramAccount.upsert({
      where: { handle: "e2e-folder-draw" },
      update: {},
      create: { handle: "e2e-folder-draw", name: "E2E Folder Draw", clientId: client.id },
    });
    fixture.accountId = account.id;
    const other = await prismaTest.instagramAccount.upsert({
      where: { handle: "e2e-folder-draw-other" },
      update: {},
      create: { handle: "e2e-folder-draw-other", name: "E2E Folder Draw Other", clientId: client.id },
    });
    fixture.otherAccountId = other.id;

    // MediaLibrary : 4 assets répartis en 2 dossiers (d1/d2), 2 chacun.
    const mediaLib = await prismaTest.mediaLibrary.create({
      data: {
        name: "E2E MediaLib Folder Draw",
        type: "video",
        rotationScope: "per_account",
        rotationMode: "auto",
        setSequence: JSON.stringify([]),
        metadataSchema: JSON.stringify([]),
      },
    });
    fixture.mediaLibraryId = mediaLib.id;
    const folders = ["d1", "d1", "d2", "d2"];
    for (let i = 0; i < 4; i++) {
      const asset = await prismaTest.mediaAsset.create({
        data: {
          libraryId: mediaLib.id,
          filename: `e2e-folder-draw-${i}.mp4`,
          r2Key: `e2e-folder-draw/${mediaLib.id}/asset-${i}.mp4`,
          url: `/e2e-fixtures/folder-draw/asset-${i}.mp4`,
          mimeType: "video/mp4",
          duration: 10.0,
          tags: JSON.stringify([]),
          setTag: folders[i],
        },
      });
      fixture.mediaAssetIds.push(asset.id);
    }

    // MediaLibrary `shared` — 2 assets, 1 seul dossier ("s1") : sert le test
    // P8 fix #4 (claim sentinelle sans accountId).
    const sharedMediaLib = await prismaTest.mediaLibrary.create({
      data: {
        name: "E2E MediaLib Folder Draw Shared",
        type: "video",
        rotationScope: "shared",
        rotationMode: "auto",
        setSequence: JSON.stringify([]),
        metadataSchema: JSON.stringify([]),
      },
    });
    fixture.sharedMediaLibraryId = sharedMediaLib.id;
    for (let i = 0; i < 2; i++) {
      const asset = await prismaTest.mediaAsset.create({
        data: {
          libraryId: sharedMediaLib.id,
          filename: `e2e-folder-draw-shared-${i}.mp4`,
          r2Key: `e2e-folder-draw/${sharedMediaLib.id}/asset-${i}.mp4`,
          url: `/e2e-fixtures/folder-draw/shared-asset-${i}.mp4`,
          mimeType: "video/mp4",
          duration: 10.0,
          tags: JSON.stringify([]),
          setTag: "s1",
        },
      });
      fixture.sharedMediaAssetIds.push(asset.id);
    }

    // DataLibrary : 4 fiches réparties en 2 dossiers (d1/d2), 2 chacune.
    const dataLib = await prismaTest.dataLibrary.create({
      data: {
        name: "E2E DataLib Folder Draw",
        templateType: "E2EFOLDERDRAW",
        rotationScope: "per_account",
        rotationMode: "auto",
      },
    });
    fixture.dataLibraryId = dataLib.id;
    for (let i = 0; i < 4; i++) {
      const entry = await prismaTest.dataEntry.create({
        data: { libraryId: dataLib.id, setTag: folders[i], fields: JSON.stringify({ title: `Entry ${i}` }) },
      });
      fixture.dataEntryIds.push(entry.id);
    }

    // Template + Listing minimal pour POST /api/renders — le claim ne dépend
    // pas des blocks déclarés dans le template (cf. /api/renders/route.ts,
    // usedAssets.videoAssets/dataEntryId sont validés indépendamment).
    const tpl = await prismaTest.template.create({
      data: { name: "E2E Template Folder Draw", userId: admin.id, jsonData: JSON.stringify({ blocks: [] }) },
    });
    fixture.templateId = tpl.id;
    const listing = await prismaTest.listing.create({ data: { userId: admin.id, templateId: tpl.id } });
    fixture.listingId = listing.id;

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAsAdmin(page);
    await ctx.close();
  });

  test.afterAll(async () => {
    await prismaTest.render.deleteMany({ where: { id: { in: fixture.renderIds } } });
    await prismaTest.listing.deleteMany({ where: { id: fixture.listingId } });
    await prismaTest.template.deleteMany({ where: { id: fixture.templateId } });
    await prismaTest.dataLibrary.deleteMany({ where: { id: fixture.dataLibraryId } });
    await prismaTest.mediaLibrary.deleteMany({
      where: { id: { in: [fixture.mediaLibraryId, fixture.sharedMediaLibraryId] } },
    });
    await prismaTest.instagramAccount.deleteMany({
      where: { id: { in: [fixture.accountId, fixture.otherAccountId] } },
    });
    await prismaTest.$disconnect();
  });

  test("media — MediaAssetUsage.lastUsedAt stampé au submit pour le bon compte", async ({ page, request }) => {
    await loginAsAdmin(page);
    const cookieHeader = await getCookieHeader(page);

    const baseline = await prismaTest.mediaAssetUsage.findMany({ where: { assetId: { in: fixture.mediaAssetIds } } });
    expect(baseline.length).toBe(0);

    const [assetA, assetB] = fixture.mediaAssetIds;
    for (const assetId of [assetA, assetB]) {
      const res = await request.post(`http://localhost:3100/api/renders`, {
        headers: { "Content-Type": "application/json", Cookie: cookieHeader },
        data: {
          templateId: fixture.templateId,
          listingId: fixture.listingId,
          accountId: fixture.accountId,
          usedAssets: {
            videoAssets: { "video-block-1": assetId },
            setSequencedLibraryIds: [fixture.mediaLibraryId],
          },
        },
      });
      expect(res.status()).toBe(201);
      const render = (await res.json()) as { id: string };
      fixture.renderIds.push(render.id);

      // Le fixture n'a pas de theme/canvas complet : le pipeline de rendu
      // (hors périmètre de ce lot) échoue async juste après et revert le
      // claim (CAS sur MediaAssetUsage — cf. revertAdvancesOnFailure). On
      // vérifie donc la preuve du claim posée en DB de façon synchrone au
      // submit : `Render.usedAssets.prevMediaUsageStates`, écrite par
      // advanceMediaUsageOnSubmit APRÈS commit de son upsert
      // MediaAssetUsage — donc strictement équivalente à lire la table en
      // direct, sans la course avec le revert async.
      const renderRow = await prismaTest.render.findUniqueOrThrow({ where: { id: render.id }, select: { usedAssets: true } });
      const usedAssets = JSON.parse(renderRow.usedAssets) as {
        prevMediaUsageStates?: { assetId: string; accountId: string; claimedLastUsedAt: string }[];
      };
      const claim = usedAssets.prevMediaUsageStates?.find((s) => s.assetId === assetId);
      expect(claim?.accountId).toBe(fixture.accountId);
      expect(claim?.claimedLastUsedAt).toBeTruthy();
    }

    // Le second compte n'a jamais soumis de render — aucun claim pour lui.
    const otherUsage = await prismaTest.mediaAssetUsage.findMany({
      where: { assetId: { in: fixture.mediaAssetIds }, accountId: fixture.otherAccountId },
    });
    expect(otherUsage.length).toBe(0);
  });

  test("data — DataEntryUsage.lastUsedAt stampé au submit pour le bon compte", async ({ page, request }) => {
    await loginAsAdmin(page);
    const cookieHeader = await getCookieHeader(page);

    const [entryA, entryB] = fixture.dataEntryIds;
    for (const entryId of [entryA, entryB]) {
      const res = await request.post(`http://localhost:3100/api/renders`, {
        headers: { "Content-Type": "application/json", Cookie: cookieHeader },
        data: {
          templateId: fixture.templateId,
          listingId: fixture.listingId,
          accountId: fixture.accountId,
          usedAssets: { dataEntryId: entryId },
        },
      });
      expect(res.status()).toBe(201);
      const render = (await res.json()) as { id: string };
      fixture.renderIds.push(render.id);

      // Même raisonnement que le test media ci-dessus (course avec le revert
      // async du pipeline de rendu) — on lit la preuve du claim posée en DB
      // au submit via Render.usedAssets.prevDataUsageState.
      const renderRow = await prismaTest.render.findUniqueOrThrow({ where: { id: render.id }, select: { usedAssets: true } });
      const usedAssets = JSON.parse(renderRow.usedAssets) as {
        prevDataUsageState?: { entryId: string; accountId: string; claimedLastUsedAt: string };
      };
      expect(usedAssets.prevDataUsageState?.entryId).toBe(entryId);
      expect(usedAssets.prevDataUsageState?.accountId).toBe(fixture.accountId);
      expect(usedAssets.prevDataUsageState?.claimedLastUsedAt).toBeTruthy();
    }

    const otherUsage = await prismaTest.dataEntryUsage.findMany({
      where: { entryId: { in: fixture.dataEntryIds }, accountId: fixture.otherAccountId },
    });
    expect(otherUsage.length).toBe(0);
  });

  // P8 fix #4 : une génération SANS accountId sur une lib `shared` ne doit
  // plus voir son claim sauté (route.ts:493 avant fix : gardé par
  // `validatedAccountId`, résultat quasi-systématiquement le même asset
  // reservi car jamais marqué "récemment utilisé"). Le claim doit atterrir
  // sous la sentinelle SHARED_USAGE_ACCOUNT_ID, lisible aussi bien via
  // Render.usedAssets.prevMediaUsageStates (preuve synchrone au submit, même
  // raisonnement que les tests media/data ci-dessus) que via la table
  // MediaAssetUsage elle-même (pas de revert async pour ce cas puisqu'on ne
  // lit la ligne qu'une fois le 201 reçu, avant tout webhook ERROR éventuel).
  test("media shared — claim posé sous la sentinelle __shared__ MÊME SANS accountId", async ({ page, request }) => {
    await loginAsAdmin(page);
    const cookieHeader = await getCookieHeader(page);

    const baseline = await prismaTest.mediaAssetUsage.findMany({
      where: { assetId: { in: fixture.sharedMediaAssetIds } },
    });
    expect(baseline.length).toBe(0);

    const [assetId] = fixture.sharedMediaAssetIds;
    const res = await request.post(`http://localhost:3100/api/renders`, {
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      data: {
        templateId: fixture.templateId,
        listingId: fixture.listingId,
        // Pas d'accountId — c'est le coeur du scénario.
        usedAssets: {
          videoAssets: { "video-block-1": assetId },
          setSequencedLibraryIds: [fixture.sharedMediaLibraryId],
        },
      },
    });
    expect(res.status()).toBe(201);
    const render = (await res.json()) as { id: string };
    fixture.renderIds.push(render.id);

    const renderRow = await prismaTest.render.findUniqueOrThrow({ where: { id: render.id }, select: { usedAssets: true } });
    const usedAssets = JSON.parse(renderRow.usedAssets) as {
      prevMediaUsageStates?: { assetId: string; accountId: string; claimedLastUsedAt: string }[];
    };
    const claim = usedAssets.prevMediaUsageStates?.find((s) => s.assetId === assetId);
    expect(claim?.accountId).toBe(SHARED_USAGE_ACCOUNT_ID);
    expect(claim?.claimedLastUsedAt).toBeTruthy();

    const usageRow = await prismaTest.mediaAssetUsage.findUnique({
      where: { assetId_accountId: { assetId, accountId: SHARED_USAGE_ACCOUNT_ID } },
    });
    expect(usageRow?.lastUsedAt).toBeTruthy();
  });
});
