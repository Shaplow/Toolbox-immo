import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth";

test.describe("Admin navigation structure (Phase 1.4 + 1.4.6)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
  });

  test("nav admin has all expected items (Production / Clients / Configuration)", async ({ page }) => {
    // Vérification par hrefs (plus robuste que sélecteurs sur les labels uppercase).
    // Production : Templates (Phase 1.4 B1) + Planification (Recettes supprimées Phase 1.6)
    await expect(page.locator('a[href="/templates"]').first()).toBeVisible();
    await expect(page.locator('a[href="/admin/offer-schedule"]').first()).toBeVisible();
    // Clients
    await expect(page.locator('a[href="/admin/clients"]').first()).toBeVisible();
    // Configuration : Ressources (renommée Bibliothèques→Ressources Phase 1.4.6) + Utilisateurs
    await expect(page.locator('a[href="/admin/libraries"]').first()).toBeVisible();
    await expect(page.locator('a[href="/admin/users"]').first()).toBeVisible();
  });

  test("nav does NOT contain dead/merged routes", async ({ page }) => {
    // /admin/ia-config supprimé Phase 1.4.6
    expect(await page.locator('a[href="/admin/ia-config"]').count()).toBe(0);
    // /admin/accounts supprimé Phase 1.4.5
    expect(await page.locator('a[href="/admin/accounts"]').count()).toBe(0);
    // /admin/offers fusionné en onglet Planification
    expect(await page.locator('a[href="/admin/offers"]').count()).toBe(0);
  });

  test("Ressources hub : 4 cards (Médias, Données, Typographies, Prompts IA)", async ({ page }) => {
    await page.goto("/admin/libraries");
    await expect(page.locator("h1, h2").filter({ hasText: /ressources/i })).toBeVisible();
    await expect(page.locator('a[href="/admin/libraries/media"]')).toBeVisible();
    await expect(page.locator('a[href="/admin/libraries/data"]')).toBeVisible();
    await expect(page.locator('a[href="/admin/fonts"]')).toBeVisible();
    await expect(page.locator('a[href="/admin/prompts"]')).toBeVisible();
  });

  test("Planification page : affiche OffersPanel (onglet Règles supprimé Phase 1.6)", async ({ page }) => {
    // Phase 1.6 : OfferSchedulePanel (Règles) supprimé — la page n'affiche plus que OffersPanel
    await page.goto("/admin/offer-schedule");
    await expect(page.locator("h1, h2, h3").filter({ hasText: /planification/i }).first()).toBeVisible();
  });

  test("Client detail : 2 tabs (Infos + Comptes Instagram)", async ({ page }) => {
    await page.goto("/admin/clients/test-client-1");
    await expect(page.locator("text=Infos").first()).toBeVisible();
    await expect(page.locator("text=Comptes Instagram").first()).toBeVisible();
  });

  test("Old URLs redirect : /admin/offers → /admin/offer-schedule?tab=offers", async ({ page }) => {
    await page.goto("/admin/offers");
    await expect(page).toHaveURL(/\/admin\/offer-schedule/);
  });

  test("Old URLs redirect : /admin/presets → 404 (gestion via /tools/captions)", async ({ page }) => {
    const response = await page.goto("/admin/presets");
    // Phase 1.4.6 : page supprimée, doit retourner 404
    expect(response?.status()).toBe(404);
  });
});
