import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth";

/**
 * Atelier « Analyse auto » — les compteurs et la lisibilité des échecs.
 *
 * Régression protégée : le badge et le titre « Review — N à valider »
 * interrogeaient `autocut-queue?reviewStatus=pending_review` SANS filtre sur
 * `status`. Or `reviewStatus` vaut "pending_review" dès la création du job :
 * les jobs en cours et en échec étaient donc comptés comme du travail à valider
 * (badge « 99+ » permanent sur une file réellement vide).
 *
 * Fixtures : cf. `scripts/seed-test-db.ts` — 3 jobs sur `test-media-lib-video`,
 * 1 `done` (validable) + 2 `failed` de causes distinctes. Sous l'ancien filtre,
 * le badge aurait affiché 3.
 */

const VIDEO_LIB = "test-media-lib-video";

test.describe("Atelier autocut — compteurs et échecs", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/admin/libraries/media/${VIDEO_LIB}`);
  });

  test("le badge ne compte que les analyses réellement validables", async ({ page }) => {
    const atelier = page.getByRole("button", { name: /Analyse auto/i });
    await expect(atelier).toBeVisible();

    // 1 et non 3 : les deux jobs en échec ne sont pas du travail à valider.
    const badge = atelier.locator("xpath=..").locator("span[title*='à valider']");
    await expect(badge).toHaveText("1");
    await expect(badge).toHaveAttribute("title", /1 analyse à valider/);
    await expect(badge).toHaveAttribute("title", /2 en échec/);
  });

  test("l'API summary expose la même définition du validable", async ({ page }) => {
    const res = await page.request.get(
      `/api/admin/libraries/media/${VIDEO_LIB}/autocut-queue?summary=1`,
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      counts: { reviewable: number; failed: number; inProgress: number; total: number };
    };
    expect(body.counts.reviewable).toBe(1);
    expect(body.counts.failed).toBe(2);
    expect(body.counts.total).toBe(3);
  });

  test("un filtre de statut hors domaine est rejeté", async ({ page }) => {
    const res = await page.request.get(
      `/api/admin/libraries/media/${VIDEO_LIB}/autocut-queue?status=DONE`,
    );
    expect(res.status()).toBe(400);
  });

  test("l'atelier groupe les échecs par cause et permet de les relancer", async ({ page }) => {
    await page.getByRole("button", { name: /Analyse auto/i }).click();

    // Le bouton d'entrée en review porte le même chiffre que le badge.
    await expect(page.getByRole("button", { name: /Valider les analyses \(1\)/ })).toBeVisible();

    // Section Échecs : 2 vidéos, 2 causes distinctes et lisibles.
    await expect(page.getByText(/2 analyses en échec/)).toBeVisible();
    await expect(page.getByText(/dépassé son temps d'exécution/)).toBeVisible();
    await expect(page.getByText(/n'a détecté aucune parole/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Tout relancer \(2\)/ })).toBeVisible();

    // « Sélectionner » sur un groupe arme la relance sans quitter la vue.
    // Scopé à la modale : la page en dessous porte des chips de tag dont le nom
    // accessible contient aussi « Sélectionner ».
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Sélectionner", exact: true }).first().click();
    await expect(dialog.getByRole("button", { name: /Analyser \(1\)/ })).toBeVisible();
  });

  test("la file de review ne contient que les analyses exploitables", async ({ page }) => {
    await page.getByRole("button", { name: /Analyse auto/i }).click();
    await page.getByRole("button", { name: /Valider les analyses/ }).click();

    await expect(page.getByRole("heading", { name: /Review — 1 à valider/ })).toBeVisible();
    // Aucune carte en échec ne doit atterrir dans la file.
    await expect(page.getByText(/Échec global du job RunPod/)).toHaveCount(0);
  });
});
