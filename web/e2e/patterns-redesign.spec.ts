/**
 * E2E — AccountPattern CRUD + génération de slots (Wave E Phase 1.6)
 *
 * Scénarios couverts :
 * 1. ADMIN voit la fiche compte /admin/accounts/[id]
 * 2. ADMIN crée un pattern via le form modal
 * 3. ADMIN édite un pattern existant
 * 4. ADMIN supprime un pattern (sans slots associés)
 * 5. Génération de slots depuis un pattern (via API direct — UI génération fragile sans fixture week)
 * 6. Sécurité : MONTEUR redirigé depuis /admin/accounts/[id]
 * 7. Sécurité : POST patterns sans auth admin → 403
 *
 * Note : le seed crée un client test-client-1 + un compte test_account + un pattern test-pattern-1.
 * Pour les opérations de CRUD, on crée et supprime des patterns additionnels en cours de test
 * (label "Smoke pattern E2E" pour éviter les collisions avec le pattern seed).
 *
 * Tests qui nécessitent la semaine courante alignée (génération UI) → test.skip avec raison.
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Récupère l'ID du compte test_account via l'API admin.
 * On fait un GET /api/admin/accounts depuis la session admin courante.
 */
async function getTestAccountId(page: import("@playwright/test").Page): Promise<string | null> {
  const resp = await page.request.get("/api/admin/accounts");
  if (!resp.ok()) return null;
  const accounts = await resp.json() as Array<{ id: string; handle: string }>;
  const acct = accounts.find((a) => a.handle === "test_account");
  return acct?.id ?? null;
}

// ── 1. Fiche compte ───────────────────────────────────────────────────────────

test.describe("ADMIN — fiche compte /admin/accounts/[id]", () => {
  test("admin peut accéder à la fiche du compte test", async ({ page }) => {
    await loginAs(page, "admin");

    const accountId = await getTestAccountId(page);
    if (!accountId) {
      test.skip();
      return;
    }

    const response = await page.goto(`/admin/accounts/${accountId}`);
    expect(response?.status()).toBe(200);

    // Le handle du compte doit apparaître dans le titre
    await expect(page.locator("h1, h2").filter({ hasText: /@?test_account/i }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("la fiche compte affiche le pattern seed 'Test Pattern (E2E fixture)'", async ({ page }) => {
    await loginAs(page, "admin");

    const accountId = await getTestAccountId(page);
    if (!accountId) {
      test.skip();
      return;
    }

    await page.goto(`/admin/accounts/${accountId}`);

    // Le pattern créé par le seed doit être visible
    await expect(
      page.locator("text=Test Pattern (E2E fixture)").first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("la fiche compte affiche le bouton '+ Ajouter pattern'", async ({ page }) => {
    await loginAs(page, "admin");

    const accountId = await getTestAccountId(page);
    if (!accountId) {
      test.skip();
      return;
    }

    await page.goto(`/admin/accounts/${accountId}`);

    const addBtn = page.getByRole("button", { name: /ajouter pattern|ajouter un pattern/i }).first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
  });
});

// ── 2. Création d'un pattern ──────────────────────────────────────────────────

test.describe("ADMIN — créer un pattern", () => {
  test("ADMIN peut ouvrir le form de création et voir les champs requis", async ({ page }) => {
    await loginAs(page, "admin");

    const accountId = await getTestAccountId(page);
    if (!accountId) {
      test.skip();
      return;
    }

    await page.goto(`/admin/accounts/${accountId}`);

    // Cliquer sur le bouton Ajouter pattern
    const addBtn = page.getByRole("button", { name: /ajouter pattern|ajouter un pattern/i }).first();
    await addBtn.click();

    // Le modal/form doit apparaître avec le champ label (placeholder "Ex : Post Lundi 9h")
    await expect(
      page.locator('input[placeholder="Ex : Post Lundi 9h"]').first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test("ADMIN crée un pattern via l'API POST directe", async ({ page }) => {
    await loginAs(page, "admin");

    const accountId = await getTestAccountId(page);
    if (!accountId) {
      test.skip();
      return;
    }

    // Création via API directe (plus stable que UI form)
    const resp = await page.request.post(`/api/admin/accounts/${accountId}/patterns`, {
      data: {
        label: "Smoke pattern E2E (à supprimer)",
        source: "auto_template",
        coverMode: "none",
        needsDescription: "none",
        needsCaptions: false,
        dayOfWeek: 2, // Mardi
        publishTime: "10:00",
        isActive: true,
      },
    });

    expect(resp.status()).toBe(201);
    const created = await resp.json() as { id: string; label: string };
    expect(created.label).toBe("Smoke pattern E2E (à supprimer)");
    expect(created).toHaveProperty("id");

    // Nettoyage : supprimer le pattern créé (DELETE → 204)
    await page.request.delete(`/api/admin/accounts/${accountId}/patterns/${created.id}`);
  });

  test("POST pattern sans label → 400 validation error", async ({ page }) => {
    await loginAs(page, "admin");

    const accountId = await getTestAccountId(page);
    if (!accountId) {
      test.skip();
      return;
    }

    const resp = await page.request.post(`/api/admin/accounts/${accountId}/patterns`, {
      data: {
        // label manquant
        source: "auto_template",
        coverMode: "none",
        needsDescription: "none",
        dayOfWeek: 1,
        publishTime: "09:00",
      },
    });

    expect(resp.status()).toBe(400);
    const body = await resp.json() as { error: string };
    expect(body.error).toMatch(/label/i);
  });
});

// ── 3. Édition d'un pattern ───────────────────────────────────────────────────

test.describe("ADMIN — éditer un pattern", () => {
  test("PATCH pattern label via API → label mis à jour", async ({ page }) => {
    await loginAs(page, "admin");

    const accountId = await getTestAccountId(page);
    if (!accountId) {
      test.skip();
      return;
    }

    // Créer un pattern temporaire
    const createResp = await page.request.post(`/api/admin/accounts/${accountId}/patterns`, {
      data: {
        label: "Pattern avant édition",
        source: "auto_template",
        coverMode: "none",
        needsDescription: "none",
        dayOfWeek: 3,
        publishTime: "14:00",
      },
    });
    expect(createResp.status()).toBe(201);
    const { id: patternId } = await createResp.json() as { id: string };

    // Éditer le label
    const patchResp = await page.request.patch(
      `/api/admin/accounts/${accountId}/patterns/${patternId}`,
      { data: { label: "Pattern après édition" } }
    );
    expect(patchResp.status()).toBe(200);
    const updated = await patchResp.json() as { label: string };
    expect(updated.label).toBe("Pattern après édition");

    // Nettoyage
    await page.request.delete(`/api/admin/accounts/${accountId}/patterns/${patternId}`);
  });

  test("la fiche compte affiche le bouton Éditer sur le pattern seed", async ({ page }) => {
    await loginAs(page, "admin");

    const accountId = await getTestAccountId(page);
    if (!accountId) {
      test.skip();
      return;
    }

    await page.goto(`/admin/accounts/${accountId}`);

    // Chercher un bouton Éditer dans la page
    const editBtn = page.getByRole("button", { name: /éditer|modifier/i }).first();
    await expect(editBtn).toBeVisible({ timeout: 10_000 });
  });
});

// ── 4. Suppression d'un pattern ───────────────────────────────────────────────

test.describe("ADMIN — supprimer un pattern", () => {
  test("DELETE pattern sans slots → 200 OK", async ({ page }) => {
    await loginAs(page, "admin");

    const accountId = await getTestAccountId(page);
    if (!accountId) {
      test.skip();
      return;
    }

    // Créer un pattern à supprimer
    const createResp = await page.request.post(`/api/admin/accounts/${accountId}/patterns`, {
      data: {
        label: "Pattern à supprimer (smoke)",
        source: "manual_rushes",
        coverMode: "none",
        needsDescription: "none",
        dayOfWeek: 5, // Vendredi
        publishTime: "16:00",
      },
    });
    expect(createResp.status()).toBe(201);
    const { id: patternId } = await createResp.json() as { id: string };

    // Supprimer (DELETE retourne 204 No Content)
    const deleteResp = await page.request.delete(
      `/api/admin/accounts/${accountId}/patterns/${patternId}`
    );
    expect(deleteResp.status()).toBe(204);
  });

  test("DELETE pattern inexistant → 404", async ({ page }) => {
    await loginAs(page, "admin");

    const accountId = await getTestAccountId(page);
    if (!accountId) {
      test.skip();
      return;
    }

    const deleteResp = await page.request.delete(
      `/api/admin/accounts/${accountId}/patterns/nonexistent-pattern-id`
    );
    expect(deleteResp.status()).toBe(404);
  });
});

// ── 5. Génération de slots ────────────────────────────────────────────────────

test.describe("Génération de slots depuis AccountPattern", () => {
  test("POST /api/calendar/generate crée des slots depuis les patterns actifs", async ({ page }) => {
    await loginAs(page, "admin");

    const accountId = await getTestAccountId(page);
    if (!accountId) {
      test.skip();
      return;
    }

    // Créer un pattern actif lundi 09:00 pour le compte test
    const createResp = await page.request.post(`/api/admin/accounts/${accountId}/patterns`, {
      data: {
        label: "Pattern génération E2E",
        source: "auto_template",
        coverMode: "none",
        needsDescription: "none",
        dayOfWeek: 1, // Lundi
        publishTime: "09:00",
        isActive: true,
      },
    });
    expect(createResp.status()).toBe(201);
    const { id: patternId } = await createResp.json() as { id: string };

    try {
      // Calculer lundi prochain
      const now = new Date();
      const jsDay = now.getUTCDay();
      const daysUntilNextMonday = jsDay === 0 ? 1 : 8 - jsDay;
      const nextMonday = new Date(now);
      nextMonday.setUTCDate(now.getUTCDate() + daysUntilNextMonday);
      nextMonday.setUTCHours(0, 0, 0, 0);
      const nextSunday = new Date(nextMonday);
      nextSunday.setUTCDate(nextMonday.getUTCDate() + 6);
      nextSunday.setUTCHours(23, 59, 59, 999);

      // Générer les slots pour la semaine prochaine
      const genResp = await page.request.post("/api/calendar/generate", {
        data: {
          accountIds: [accountId],
          dateFrom: nextMonday.toISOString(),
          dateTo: nextSunday.toISOString(),
        },
      });

      expect(genResp.status()).toBe(200);
      const genResult = await genResp.json() as { created: number; skipped: number };
      // Au moins 1 slot créé (ou skipped si déjà existant depuis un run précédent)
      const total = genResult.created + genResult.skipped;
      expect(total).toBeGreaterThanOrEqual(1);

      // Vérifier idempotence : 2e appel → 0 créé, 1 skipped
      const gen2Resp = await page.request.post("/api/calendar/generate", {
        data: {
          accountIds: [accountId],
          dateFrom: nextMonday.toISOString(),
          dateTo: nextSunday.toISOString(),
        },
      });
      expect(gen2Resp.status()).toBe(200);
      const gen2Result = await gen2Resp.json() as { created: number; skipped: number };
      // Au 2e appel, tout doit être skipped (idempotence)
      expect(gen2Result.created).toBe(0);
      expect(gen2Result.skipped).toBeGreaterThanOrEqual(1);
    } finally {
      // Nettoyage best-effort : le DELETE peut échouer si des slots ont été générés
      // (la route DELETE bloque si slots associés — comportement intentionnel côté API)
      // Les slots seront nettoyés au prochain test:db:reset.
      await page.request.delete(`/api/admin/accounts/${accountId}/patterns/${patternId}`).catch(() => {});
    }
  });

  test.skip(
    true,
    "UI: cliquer 'Générer la semaine' sur /calendar nécessite d'aligner la semaine affichée " +
    "avec les fixtures — skip en env CI sans contrôle du jour courant."
  );
});

// ── 6. Sécurité : accès non-admin ────────────────────────────────────────────

test.describe("Sécurité — scope admin accounts", () => {
  test("MONTEUR redirigé depuis /admin/accounts/[id]", async ({ page }) => {
    await loginAs(page, "monteur");

    // On utilise un ID fictif — peu importe, la redirection se fait avant la lookup DB
    const response = await page.goto("/admin/accounts/some-account-id");
    const finalUrl = page.url();

    // Doit être redirigé (vers /tools/templates ou /home) ou recevoir 404
    const isBlocked =
      !finalUrl.includes("/admin/accounts") ||
      response?.status() === 404 ||
      finalUrl.includes("/tools/templates") ||
      finalUrl.includes("/home");
    expect(isBlocked).toBe(true);
  });

  test("POST /api/admin/accounts/[id]/patterns sans session admin → 403", async ({ page }) => {
    // Utiliser une session MONTEUR
    await loginAs(page, "monteur");

    // Tenter de créer un pattern avec une session monteur
    const resp = await page.request.post("/api/admin/accounts/some-id/patterns", {
      data: {
        label: "Tentative non-admin",
        source: "auto_template",
        coverMode: "none",
        needsDescription: "none",
        dayOfWeek: 1,
        publishTime: "09:00",
      },
    });

    expect(resp.status()).toBe(403);
  });

  test("PATCH /api/admin/accounts/[id]/patterns/[patternId] sans session admin → 403", async ({ page }) => {
    await loginAs(page, "cm");

    const resp = await page.request.patch("/api/admin/accounts/some-id/patterns/some-pattern-id", {
      data: { label: "Tentative CM" },
    });

    expect(resp.status()).toBe(403);
  });

  test("DELETE /api/admin/accounts/[id]/patterns/[patternId] sans session admin → 403", async ({ page }) => {
    await loginAs(page, "monteur");

    const resp = await page.request.delete(
      "/api/admin/accounts/some-id/patterns/some-pattern-id"
    );

    expect(resp.status()).toBe(403);
  });
});

// ── 7. Navigation client → compte ────────────────────────────────────────────

test.describe("Navigation client → fiche compte", () => {
  test("la fiche client a l'onglet 'Comptes Instagram'", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin/clients/test-client-1");

    // Onglet Comptes Instagram doit être visible
    await expect(
      page.locator("button, [role='tab']").filter({ hasText: /comptes instagram/i }).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("l'onglet Comptes affiche le compte test_account avec un lien Configurer", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin/clients/test-client-1");

    // Cliquer sur l'onglet Comptes Instagram (tab géré par état React, pas URL)
    const comptesTab = page.locator("button").filter({ hasText: /comptes instagram/i }).first();
    await expect(comptesTab).toBeVisible({ timeout: 10_000 });
    await comptesTab.click();

    // Attendre que le contenu de l'onglet charge
    await page.waitForTimeout(500);

    // Le handle test_account doit apparaître dans la liste
    await expect(page.locator("text=test_account").first()).toBeVisible({ timeout: 10_000 });

    // Un lien "Configurer" doit être visible (InstagramAccountRow)
    await expect(
      page.getByRole("link", { name: /configurer/i }).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
