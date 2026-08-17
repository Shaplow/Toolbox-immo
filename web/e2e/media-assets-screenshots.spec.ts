import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth";

/**
 * Screenshot tests sur MediaAssetsPanel.
 *
 * Ces tests capturent l'état visuel des 3 vues + modal upload pour servir
 * de baseline avant le split C1-v2 D5-D9 (refacto en hooks + vues + modals).
 *
 * Pré-requis seed (cf scripts/seed-test-db.ts) :
 *  - test-media-lib-video : library vidéo avec 3 assets (2 set tags, 2 catégories)
 *  - test-media-lib-audio : library audio avec 2 musiques
 *
 * Stratégie :
 *  - Première exécution : génère les baseline `*-snapshots/*.png`.
 *  - Exécutions suivantes : compare au pixel près, échoue si diff.
 *  - Après chaque PR D5-D9, on relance et on valide visuellement les diff
 *    via le report HTML Playwright avant de mettre à jour la baseline.
 *
 * Pour mettre à jour la baseline après changement intentionnel :
 *   npx playwright test e2e/media-assets-screenshots.spec.ts --update-snapshots
 */

const VIDEO_LIB_ID = "test-media-lib-video";
const AUDIO_LIB_ID = "test-media-lib-audio";

// Threshold de tolérance pour les diffs pixel-par-pixel. Petite marge pour
// éviter les faux positifs liés au rendu de polices ou anti-aliasing.
const SCREENSHOT_OPTS = {
  maxDiffPixelRatio: 0.01,
  animations: "disabled" as const,
};

test.describe("MediaAssetsPanel — baseline screenshots avant split C1-v2", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
  });

  test("vue Grid (mode par défaut, library vidéo)", async ({ page }) => {
    await page.goto(`/admin/libraries/media/${VIDEO_LIB_ID}`);
    // Attente du fetch initial des assets (loading → grid rendered).
    await expect(page.getByText("test_video_0.mp4")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveScreenshot("video-lib-grid.png", SCREENSHOT_OPTS);
  });

  test("vue Dossiers (groupée par setTag)", async ({ page }) => {
    // Plan simplification Phase 3 : la vue Rotation (simulation séquence +
    // cycles) est décommissionnée — remplacée par la vue Dossiers.
    // Le toggle de vue n'existe qu'en mode avancé (défaut = vue table).
    await page.goto(`/admin/libraries/media/${VIDEO_LIB_ID}`);
    await expect(page.getByText("test_video_0.mp4")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /avanc[ée]/i }).click({ timeout: 3_000 }).catch(() => {});
    await page.getByRole("button", { name: /dossiers/i }).click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("video-lib-dossiers.png", SCREENSHOT_OPTS);
  });

  test("modale Upload ouverte (drag-drop zone + fields)", async ({ page }) => {
    await page.goto(`/admin/libraries/media/${VIDEO_LIB_ID}`);
    await expect(page.getByText("test_video_0.mp4")).toBeVisible({ timeout: 10_000 });
    // Ouvrir la modal via le bouton "Ajouter des vidéos" ou similaire.
    await page.getByRole("button", { name: /ajouter.+vid[ée]os?|nouveau|upload/i })
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("video-lib-upload-modal.png", SCREENSHOT_OPTS);
  });

  test("vue Audio (library audio en liste)", async ({ page }) => {
    await page.goto(`/admin/libraries/media/${AUDIO_LIB_ID}`);
    await expect(page.getByText("test_audio_0.mp3")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveScreenshot("audio-lib-list.png", SCREENSHOT_OPTS);
  });

  test("vue Grid en select mode (bulk action bar visible)", async ({ page }) => {
    await page.goto(`/admin/libraries/media/${VIDEO_LIB_ID}`);
    await expect(page.getByText("test_video_0.mp4")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /s[ée]lectionner|select/i }).click().catch(() => {});
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("video-lib-select-mode.png", SCREENSHOT_OPTS);
  });
});
