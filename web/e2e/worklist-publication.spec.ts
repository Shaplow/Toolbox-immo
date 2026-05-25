import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth";

test.describe("Worklists → fiche publication (Phase 1.2 + 1.3)", () => {
  test("monteur worklist contains assigned slot, click → /publications/[id]", async ({ page }) => {
    await loginAs(page, "monteur");

    // Le seed crée test-slot-1 assigné au monteur, titre "Test slot E2E"
    await expect(page.locator("text=Test slot E2E")).toBeVisible({ timeout: 10_000 });

    // Click sur la carte → redirige vers /publications/test-slot-1
    await page.locator("text=Test slot E2E").click();
    await expect(page).toHaveURL(/\/publications\/test-slot-1/);
  });

  test("cm can access the assigned slot's publication page directly", async ({ page }) => {
    // La worklist CM filtre sur status="À préparer" (EDIT_APPROVED/CAPTIONS_PENDING/READY_FOR_CM)
    // Le seed crée test-slot-1 en status PLANNED → ne sera pas dans la worklist CM.
    // On vérifie quand même que le CM peut accéder à la fiche (assigneeCmId match).
    await loginAs(page, "cm");
    const response = await page.goto("/publications/test-slot-1");
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1").filter({ hasText: "Test slot E2E" }).first()).toBeVisible();
  });

  test("publication page renders production chain + header", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/publications/test-slot-1");

    // Le titre du slot doit apparaître dans le header (utilise un sélecteur précis + first)
    await expect(page.locator("h1").filter({ hasText: "Test slot E2E" }).first()).toBeVisible();

    // Sections présentes (au moins certaines selon recipe needs*)
    // La recipe TEST_RPI a needsCover=auto + needsCaptions=true + needsDescription=autoGenerate
    const body = await page.locator("body").textContent();
    expect(body?.match(/render|cover|caption|description|publish/i)).toBeTruthy();
  });
});
