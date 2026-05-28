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
    // test-slot-1 est dans 3 jours, status PLANNED → section "À shooter cette
    // semaine" ou "À venir" (collapsible). HomeVideaste filtre par
    // assigneeVideasteId + VIDEASTE_STATUSES. Le titre du slot ou le pattern
    // label devraient apparaître.
    const slotOrPattern = page.locator("text=/Test slot E2E|Test Pattern/").first();
    await expect(slotOrPattern).toBeVisible({ timeout: 10_000 });
  });

  test("clic sur le slot ouvre la fiche publication", async ({ page }) => {
    await loginAs(page, "videaste");
    const slotCard = page.locator("text=/Test slot E2E|Test Pattern/").first();
    await expect(slotCard).toBeVisible({ timeout: 10_000 });
    await slotCard.click();
    await expect(page).toHaveURL(/\/publications\/test-slot-1/, { timeout: 5_000 });
  });
});

test.describe("Vidéaste — calendar accès", () => {
  test("accède au /calendar", async ({ page }) => {
    await loginAs(page, "videaste");
    await page.goto("/calendar");
    await expect(page.locator("text=/^Lun$/").first()).toBeVisible({ timeout: 10_000 });
  });

  test("ne voit pas les boutons admin (Générer / Slot)", async ({ page }) => {
    await loginAs(page, "videaste");
    await page.goto("/calendar");
    await expect(page.locator("button:has-text('Générer la semaine')")).toHaveCount(0);
    await expect(page.locator("button:has-text('Slot')").first()).toHaveCount(0);
  });

  test("calendrier est accessible et la grille charge", async ({ page }) => {
    // Le scope par-vidéaste est déjà testé via le toggle "À moi" et la
    // worklist. Ce test vérifie juste que la grille se charge sans erreur
    // pour un vidéaste — l'apparition d'un slot dépend de scheduledAt vs
    // semaine en cours, ce qui n'est pas déterministe pour un test E2E.
    await loginAs(page, "videaste");
    await page.goto("/calendar");
    await expect(page.locator("text=/^Lun$/").first()).toBeVisible({ timeout: 10_000 });
    // Pas de message d'erreur d'accès
    await expect(page.locator("body")).not.toContainText(/réservé aux administrateurs/i);
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
    // Attendre que la fiche soit chargée (header visible)
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 10_000 });
    // Les sections primaires VIDEASTE doivent être présentes dans le DOM
    await expect(page.locator("text=/Brief éditorial|Brief/").first()).toBeVisible();
    await expect(page.locator("text=/Rushes/").first()).toBeVisible();
    await expect(page.locator("text=/Commentaires|Conversation/").first()).toBeVisible();
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
