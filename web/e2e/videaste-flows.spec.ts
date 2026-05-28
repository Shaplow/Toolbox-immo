import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth";

/**
 * Tests E2E dédiés au rôle VIDÉASTE.
 *
 * Le seed crée test-slot-1 avec assigneeVideasteId=videaste.id (slot
 * assigné), et test-slot-orphan SANS assignation (vérif isolation).
 *
 * Couvre :
 * - Accès au /home, /calendar
 * - Worklist vidéaste affiche test-slot-1
 * - test-slot-orphan invisible pour ce vidéaste
 * - Restrictions admin (pas de "Générer la semaine", pas de "Slot")
 * - Accès à /publications/test-slot-1 OK + sections filtrées par rôle
 */

test.describe("Vidéaste — home / worklist", () => {
  test("se connecte et arrive sur /home (worklist vidéaste)", async ({ page }) => {
    await loginAs(page, "videaste");
    await expect(page).toHaveURL(/\/home/);
    await expect(page.locator("text=/Bonjour/")).toBeVisible({ timeout: 5_000 });
  });

  test("worklist contient le slot assigné (test-slot-1)", async ({ page }) => {
    await loginAs(page, "videaste");
    // test-slot-1 est dans 3 jours, status PLANNED → section "À shooter cette semaine"
    await expect(page.locator("text=Test slot E2E")).toBeVisible({ timeout: 10_000 });
  });

  test("clic sur le slot ouvre la fiche publication", async ({ page }) => {
    await loginAs(page, "videaste");
    await page.locator("text=Test slot E2E").first().click();
    await expect(page).toHaveURL(/\/publications\/test-slot-1/);
  });
});

test.describe("Vidéaste — calendar accès", () => {
  test("accède au /calendar", async ({ page }) => {
    await loginAs(page, "videaste");
    await page.goto("/calendar");
    await expect(page.locator("body")).toContainText(/lundi|lun/i, { timeout: 5_000 });
  });

  test("ne voit pas les boutons admin (Générer / Slot)", async ({ page }) => {
    await loginAs(page, "videaste");
    await page.goto("/calendar");
    await expect(page.locator("button:has-text('Générer la semaine')")).toHaveCount(0);
    await expect(page.locator("button:has-text('Slot')").first()).toHaveCount(0);
  });

  test("voit son slot assigné dans la grille", async ({ page }) => {
    await loginAs(page, "videaste");
    await page.goto("/calendar");
    // Navigue à la semaine du slot (dans 3 jours = soit semaine en cours, soit suivante)
    const slotVisible = await page.locator("text=Test slot E2E").first().isVisible({ timeout: 3_000 }).catch(() => false);
    if (!slotVisible) {
      // Tente d'avancer d'une semaine si pas visible
      await page.locator('button[title*="ChevronRight"], button:has-text("›")').first().click().catch(() => {});
    }
    // Le slot doit apparaître après navigation
    await expect(page.locator("text=Test slot E2E").first()).toBeVisible({ timeout: 5_000 });
  });

  test("ne voit pas le slot orphelin (non assigné à lui)", async ({ page }) => {
    await loginAs(page, "videaste");
    await page.goto("/calendar");
    // test-slot-orphan est en DRAFT sans assigneeVideasteId → invisible
    await expect(page.locator("text=test slot orphelin")).toHaveCount(0);
  });
});

test.describe("Vidéaste — sections fiche publication filtrées", () => {
  test("voit Brief + Rushes + Commentaires (sections primaires)", async ({ page }) => {
    await loginAs(page, "videaste");
    await page.goto("/publications/test-slot-1");
    const body = await page.locator("body").textContent();
    expect(body).toMatch(/brief/i);
    expect(body).toMatch(/rushes/i);
    expect(body).toMatch(/commentaires/i);
  });

  test("ne voit PAS Cover/Captions/Description (sections hors-rôle)", async ({ page }) => {
    await loginAs(page, "videaste");
    await page.goto("/publications/test-slot-1");
    // Ces sections sont masquées par shouldRenderForRole pour le vidéaste
    await expect(page.locator("h2:has-text('Cover Instagram')")).toHaveCount(0);
    await expect(page.locator("h2:has-text('Sous-titres')")).toHaveCount(0);
    await expect(page.locator("h2:has-text('Description')").first()).toHaveCount(0);
    await expect(page.locator("h2:has-text('Légende Instagram')")).toHaveCount(0);
  });
});

test.describe("Vidéaste — sécurité PATCH", () => {
  test("PATCH status=PUBLISHED retourne 403 (RESERVED_TERMINAL_STATUSES bloque non-admin)", async ({ request, page }) => {
    await loginAs(page, "videaste");
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await request.patch("/api/calendar/slots/test-slot-1", {
      data: { status: "PUBLISHED" },
      headers: { cookie: cookieHeader },
    });
    expect(res.status()).toBe(403);
  });

  test("DELETE slot interdit (NotFoundError, anti-énumération)", async ({ request, page }) => {
    await loginAs(page, "videaste");
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await request.delete("/api/calendar/slots/test-slot-1", {
      headers: { cookie: cookieHeader },
    });
    expect(res.status()).toBe(404);
  });
});
