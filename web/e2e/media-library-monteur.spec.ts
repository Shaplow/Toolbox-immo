import { test, expect, type Page } from "@playwright/test";
import { loginAs } from "./fixtures/auth";

/**
 * Médiathèque en lecture seule pour le MONTEUR.
 *
 * Le monteur consulte, trie, filtre et télécharge les rushs — il ne peut ni
 * uploader, ni supprimer, ni désactiver, ni éditer quoi que ce soit.
 *
 * Trois niveaux de vérification :
 *  1. il ATTEINT la médiathèque (nav + pages, sans redirect) ;
 *  2. aucune surface mutante ne lui est proposée ;
 *  3. les routes API tiennent — download 200, mutations 403.
 *
 * Le point 3 est le seul qui protège réellement : masquer un bouton n'est pas
 * une autorisation. Le point 2 documente l'UI, le point 3 la sécurité.
 *
 * Fixtures : cf. `scripts/seed-test-db.ts` (`test-media-lib-video`,
 * `test-media-lib-audio`, `test-media-asset-video-0`).
 */

const BASE = "http://localhost:3100";
const VIDEO_LIB = "test-media-lib-video";
const AUDIO_LIB = "test-media-lib-audio";
const VIDEO_ASSET = "test-media-asset-video-0";

async function cookieHeader(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

test.describe("Médiathèque — accès MONTEUR (lecture seule)", () => {
  test("le monteur voit l'entrée Médiathèque dans la nav", async ({ page }) => {
    await loginAs(page, "monteur");
    await page.goto("/home");
    await expect(page.locator('a[href="/admin/libraries"]').first()).toBeVisible();
  });

  test("le monteur atteint la bibliothèque vidéo sans redirect", async ({ page }) => {
    await loginAs(page, "monteur");
    await page.goto(`/admin/libraries/media/${VIDEO_LIB}`);
    await expect(page).toHaveURL(new RegExp(`/admin/libraries/media/${VIDEO_LIB}`));
    await expect(page.getByText("Test Videos").first()).toBeVisible();
  });

  test("le monteur atteint la bibliothèque audio sans redirect", async ({ page }) => {
    await loginAs(page, "monteur");
    await page.goto(`/admin/libraries/audio/${AUDIO_LIB}`);
    await expect(page).toHaveURL(new RegExp(`/admin/libraries/audio/${AUDIO_LIB}`));
    await expect(page.getByText("Test Audio").first()).toBeVisible();
  });

  test("aucune action mutante n'est proposée au monteur", async ({ page }) => {
    await loginAs(page, "monteur");
    await page.goto(`/admin/libraries/media/${VIDEO_LIB}`);
    await expect(page.getByText("Test Videos").first()).toBeVisible();

    await expect(page.getByRole("button", { name: /Ajouter des vidéos/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Analyse auto/i })).toHaveCount(0);
    // Les réglages de bibliothèque sont library-level (ADMIN).
    await expect(page.getByRole("button", { name: /Réglages/i })).toHaveCount(0);
  });

  test("le monteur peut trier et filtrer", async ({ page }) => {
    await loginAs(page, "monteur");
    await page.goto(`/admin/libraries/media/${VIDEO_LIB}`);
    // La barre de filtres n'apparaît qu'une fois les assets chargés.
    const search = page.getByPlaceholder("Rechercher…");
    await expect(search).toBeVisible();
    await search.fill("test_video_0");
    await expect(page.getByText("test_video_0.mp4").first()).toBeVisible();
  });

  test("le CM reste exclu de la médiathèque", async ({ page }) => {
    await loginAs(page, "cm");
    await page.goto("/admin/libraries");
    await expect(page).not.toHaveURL(/\/admin\/libraries/);
  });
});

test.describe("Médiathèque — API MONTEUR : lecture ouverte, mutations fermées", () => {
  test("GET download unitaire → 200 + downloadUrl", async ({ page, request }) => {
    await loginAs(page, "monteur");
    const res = await request.get(
      `${BASE}/api/admin/libraries/media/assets/${VIDEO_ASSET}`,
      { headers: { Cookie: await cookieHeader(page) } },
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { downloadUrl?: string };
    expect(body.downloadUrl).toBeTruthy();
  });

  test("POST download-urls (lot) → 200 + liste d'URLs", async ({ page, request }) => {
    await loginAs(page, "monteur");
    const res = await request.post(
      `${BASE}/api/admin/libraries/media/assets/download-urls`,
      {
        headers: { "Content-Type": "application/json", Cookie: await cookieHeader(page) },
        data: { assetIds: [VIDEO_ASSET, "test-media-asset-video-1"] },
      },
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { assets?: { url: string }[] };
    expect(body.assets?.length).toBe(2);
  });

  test("POST download-urls au-delà du plafond → 400", async ({ page, request }) => {
    await loginAs(page, "monteur");
    const res = await request.post(
      `${BASE}/api/admin/libraries/media/assets/download-urls`,
      {
        headers: { "Content-Type": "application/json", Cookie: await cookieHeader(page) },
        data: { assetIds: Array.from({ length: 26 }, (_, i) => `id-${i}`) },
      },
    );
    expect(res.status()).toBe(400);
  });

  test("GET liste des assets → 200 (lecture ouverte)", async ({ page, request }) => {
    await loginAs(page, "monteur");
    const res = await request.get(
      `${BASE}/api/admin/libraries/media/${VIDEO_LIB}/assets`,
      { headers: { Cookie: await cookieHeader(page) } },
    );
    expect(res.status()).toBe(200);
  });

  test("GET comptes Instagram → 200 (sinon le filtre par compte disparaît en silence)", async ({
    page,
    request,
  }) => {
    await loginAs(page, "monteur");
    const res = await request.get(`${BASE}/api/admin/libraries/media/accounts`, {
      headers: { Cookie: await cookieHeader(page) },
    });
    expect(res.status()).toBe(200);
  });

  test("PATCH d'un asset → 403", async ({ page, request }) => {
    await loginAs(page, "monteur");
    const res = await request.patch(
      `${BASE}/api/admin/libraries/media/assets/${VIDEO_ASSET}`,
      {
        headers: { "Content-Type": "application/json", Cookie: await cookieHeader(page) },
        data: { category: "piraté" },
      },
    );
    expect(res.status()).toBe(403);
  });

  test("DELETE d'un asset → 403", async ({ page, request }) => {
    await loginAs(page, "monteur");
    const res = await request.delete(
      `${BASE}/api/admin/libraries/media/assets/${VIDEO_ASSET}`,
      { headers: { Cookie: await cookieHeader(page) } },
    );
    expect(res.status()).toBe(403);
  });

  test("POST upload → 403", async ({ page, request }) => {
    await loginAs(page, "monteur");
    const res = await request.post(
      `${BASE}/api/admin/libraries/media/${VIDEO_LIB}/upload`,
      {
        headers: { "Content-Type": "application/json", Cookie: await cookieHeader(page) },
        data: { filename: "x.mp4", contentType: "video/mp4", size: 1024 },
      },
    );
    expect(res.status()).toBe(403);
  });

  test("PATCH bulk → 403", async ({ page, request }) => {
    await loginAs(page, "monteur");
    const res = await request.patch(
      `${BASE}/api/admin/libraries/media/${VIDEO_LIB}/assets/bulk`,
      {
        headers: { "Content-Type": "application/json", Cookie: await cookieHeader(page) },
        data: { assetIds: [VIDEO_ASSET], tags: ["piraté"] },
      },
    );
    expect(res.status()).toBe(403);
  });

  test("PATCH de la bibliothèque (library-level) → 403", async ({ page, request }) => {
    await loginAs(page, "monteur");
    const res = await request.patch(`${BASE}/api/admin/libraries/media/${VIDEO_LIB}`, {
      headers: { "Content-Type": "application/json", Cookie: await cookieHeader(page) },
      data: { setSequence: [] },
    });
    expect(res.status()).toBe(403);
  });

  test("le CM reste refusé même en lecture", async ({ page, request }) => {
    await loginAs(page, "cm");
    const res = await request.get(
      `${BASE}/api/admin/libraries/media/assets/${VIDEO_ASSET}`,
      { headers: { Cookie: await cookieHeader(page) } },
    );
    expect(res.status()).toBe(403);
  });
});
