import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth";

test.describe("Sécurité — filtrage par rôle (Phase 1.2.2) + escalade PUBLISHED (Phase 1.3.3 H1)", () => {
  test("monteur ne peut PAS accéder au slot orphelin (titre masqué)", async ({ page }) => {
    await loginAs(page, "monteur");
    // test-slot-orphan n'est assigné à personne — le monteur ne doit pas voir
    // son titre (Next rend une page 404 par notFound() ou contenu masqué).
    await page.goto("/publications/test-slot-orphan");
    const body = await page.locator("body").textContent();
    expect(body).not.toContain("Test slot orphelin");
  });

  test("cm ne peut PAS accéder au slot orphelin (titre masqué)", async ({ page }) => {
    await loginAs(page, "cm");
    await page.goto("/publications/test-slot-orphan");
    const body = await page.locator("body").textContent();
    expect(body).not.toContain("Test slot orphelin");
  });

  test("admin PEUT accéder au slot orphelin", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/publications/test-slot-orphan");
    // L'admin doit voir le titre du slot
    const body = await page.locator("body").textContent();
    expect(body).toContain("Test slot orphelin");
  });

  test("monteur PATCH status=PUBLISHED → 403 (escalation defense, Phase 1.3.3 H1)", async ({
    page,
    request,
  }) => {
    await loginAs(page, "monteur");

    // Récupère les cookies de session pour les utiliser dans request
    const cookies = await page.context().cookies();
    const cookieHeader = cookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    const response = await request.patch(
      "http://localhost:3100/api/calendar/slots/test-slot-1",
      {
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        data: { status: "PUBLISHED" },
      }
    );
    // 403 : statuts terminaux (PUBLISHED/CANCELLED/ARCHIVED/REJECTED) réservés
    expect(response.status()).toBe(403);
  });

  test("monteur PATCH status non-terminal → 200 (autorisé)", async ({ page, request }) => {
    await loginAs(page, "monteur");
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const response = await request.patch(
      "http://localhost:3100/api/calendar/slots/test-slot-1",
      {
        headers: { "Content-Type": "application/json", Cookie: cookieHeader },
        data: { status: "IN_EDIT" },
      }
    );
    expect(response.status()).toBe(200);
  });

  test("monteur PATCH assigneeMonteurId → ignoré silencieusement (whitelist)", async ({
    page,
    request,
  }) => {
    await loginAs(page, "monteur");
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    // Le monteur essaie de se réassigner / changer l'assignée
    const response = await request.patch(
      "http://localhost:3100/api/calendar/slots/test-slot-1",
      {
        headers: { "Content-Type": "application/json", Cookie: cookieHeader },
        data: { assigneeMonteurId: "fake-user-id" },
      }
    );
    // Doit passer (200) mais ALLOWED_PATCH_FIELDS_BY_ROLE filtre silencieusement
    // le champ — assigneeMonteurId n'est PAS modifié en base
    expect(response.status()).toBe(200);

    // Vérification : récupère le slot et confirme que l'assignée n'a pas changé
    const slotResponse = await request.get(
      "http://localhost:3100/api/calendar/slots/test-slot-1",
      { headers: { Cookie: cookieHeader } }
    );
    const slot = await slotResponse.json() as { assigneeMonteurId?: string };
    // L'assignée doit être restée le vrai monteur (seed test) et NON "fake-user-id"
    expect(slot.assigneeMonteurId).not.toBe("fake-user-id");
  });
});
