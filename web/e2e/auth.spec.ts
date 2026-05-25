import { test, expect } from "@playwright/test";
import { loginAs, TEST_USERS } from "./fixtures/auth";

test.describe("Auth & home dispatch by role", () => {
  test("admin → HomeAdmin dashboard", async ({ page }) => {
    await loginAs(page, "admin");
    await expect(page).toHaveURL(/\/home/);
    // HomeAdmin a un titre "Tableau de bord" + métriques
    await expect(page.locator("body")).toContainText(/Tableau de bord/i);
  });

  test("monteur → HomeMonteur worklist", async ({ page }) => {
    await loginAs(page, "monteur");
    await expect(page).toHaveURL(/\/home/);
    // HomeMonteur affiche les sections worklist (au moins "À monter" ou "Cette semaine")
    const body = await page.locator("body").textContent();
    expect(body?.match(/à monter|cette semaine|en cours|envois en attente/i)).toBeTruthy();
  });

  test("cm → HomeCm worklist", async ({ page }) => {
    await loginAs(page, "cm");
    await expect(page).toHaveURL(/\/home/);
    const body = await page.locator("body").textContent();
    expect(body?.match(/à préparer|à publier|publié récemment/i)).toBeTruthy();
  });

  test("user (legacy) → HomeUser fallback", async ({ page }) => {
    await loginAs(page, "user");
    await expect(page).toHaveURL(/\/home/);
    const body = await page.locator("body").textContent();
    // HomeUser smarter : soit "Bienvenue" si permissions, soit "Rôle non configuré"
    expect(body?.match(/bienvenue|rôle|outils/i)).toBeTruthy();
  });
});

test.describe("Auth invariants", () => {
  test("invalid credentials → no redirect", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="username"], input[type="text"]', TEST_USERS.admin.username);
    await page.fill('input[name="password"], input[type="password"]', "wrong-password");
    await page.click('button[type="submit"]');
    // Doit rester sur /login (pas de redirection /home)
    await page.waitForTimeout(2000);
    expect(page.url()).toContain("/login");
  });
});
