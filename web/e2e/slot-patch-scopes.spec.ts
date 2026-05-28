/**
 * E2E S1.8 — Couverture des scopes de PATCH sur slotService.patch
 *
 * Filet de sécurité ajouté avant S1.9 (retrait des shims). Étend la couverture
 * de `security.spec.ts` (qui ne testait que le scope MONTEUR + le guard
 * PUBLISHED) en validant chaque rôle qui peut écrire un slot.
 *
 * Approche : on utilise le slot seed `test-slot-1` mais on commence par poser
 * les overrides per-slot qui désactivent la cross-field validation Phase 5
 * (needsCaptions/needsDescription/coverMode → off au niveau slot). Sans ça,
 * tous les PATCH sur ce slot échoueraient en 400 car le pattern seed a
 * `needsCaptions: true` sans preset associé.
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { loginAs } from "./fixtures/auth";

const SLOT_ID = "test-slot-1";
const PATCH_URL = `http://localhost:3100/api/calendar/slots/${SLOT_ID}`;

async function patchAs(
  page: Page,
  request: APIRequestContext,
  data: Record<string, unknown>,
) {
  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  return request.patch(PATCH_URL, {
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    data,
  });
}

async function getSlot(page: Page, request: APIRequestContext) {
  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const resp = await request.get(PATCH_URL, { headers: { Cookie: cookieHeader } });
  return (await resp.json()) as Record<string, unknown>;
}

test.describe("slotService.patch — couverture des scopes (S1.8)", () => {
  // Setup : ADMIN désactive les contraintes cross-field au niveau slot pour que
  // les tests subséquents puissent PATCH sans buter sur la validation Phase 5.
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAs(page, "admin");
    const resp = await patchAs(page, ctx.request, {
      needsCaptionsOverride: false,
      needsDescriptionOverride: "none",
      coverModeOverride: "none",
    });
    expect(resp.status()).toBe(200);
    await ctx.close();
  });

  test("ADMIN peut modifier title", async ({ page, request }) => {
    await loginAs(page, "admin");
    const resp = await patchAs(page, request, { title: "Patched by ADMIN" });
    expect(resp.status()).toBe(200);
    const updated = (await resp.json()) as { title: string };
    expect(updated.title).toBe("Patched by ADMIN");
  });

  test("MONTEUR peut modifier notes (whitelisté)", async ({ page, request }) => {
    await loginAs(page, "monteur");
    const resp = await patchAs(page, request, { notes: "Note du monteur" });
    expect(resp.status()).toBe(200);
    const updated = (await resp.json()) as { notes: string };
    expect(updated.notes).toBe("Note du monteur");
  });

  test("MONTEUR PATCH title → ignoré silencieusement (pas dans whitelist)", async ({
    page,
    request,
  }) => {
    await loginAs(page, "monteur");
    const before = (await getSlot(page, request)) as { title: string };
    const resp = await patchAs(page, request, { title: "Hack title MONTEUR" });
    expect(resp.status()).toBe(200);
    const after = (await getSlot(page, request)) as { title: string };
    expect(after.title).toBe(before.title);
    expect(after.title).not.toBe("Hack title MONTEUR");
  });

  test("CM peut modifier caption (différence avec MONTEUR)", async ({ page, request }) => {
    await loginAs(page, "cm");
    const resp = await patchAs(page, request, { caption: "Caption du CM" });
    expect(resp.status()).toBe(200);
    const updated = (await resp.json()) as { caption: string };
    expect(updated.caption).toBe("Caption du CM");
  });

  test("MONTEUR PATCH caption → ignoré silencieusement (CM-only)", async ({ page, request }) => {
    await loginAs(page, "monteur");
    const before = (await getSlot(page, request)) as { caption: string };
    const resp = await patchAs(page, request, { caption: "Hack caption MONTEUR" });
    expect(resp.status()).toBe(200);
    const after = (await getSlot(page, request)) as { caption: string };
    expect(after.caption).toBe(before.caption);
  });

  test("CM PATCH status=PUBLISHED → 403 (statut terminal réservé)", async ({ page, request }) => {
    await loginAs(page, "cm");
    const resp = await patchAs(page, request, { status: "PUBLISHED" });
    expect(resp.status()).toBe(403);
  });

  test("EXTERNAL_GENERATOR PATCH → 404 (pas d'accès au slot)", async ({ page, request }) => {
    await loginAs(page, "user");
    const resp = await patchAs(page, request, { notes: "test" });
    expect(resp.status()).toBe(404);
  });

  test("ADMIN PATCH avec body vide → 200 no-op", async ({ page, request }) => {
    await loginAs(page, "admin");
    const resp = await patchAs(page, request, {});
    expect(resp.status()).toBe(200);
  });

  test("PATCH status invalide → 400", async ({ page, request }) => {
    await loginAs(page, "admin");
    const resp = await patchAs(page, request, { status: "NOT_A_REAL_STATUS" });
    expect(resp.status()).toBe(400);
  });

  test("PATCH title trop long (>5000 chars) → 400", async ({ page, request }) => {
    await loginAs(page, "admin");
    const resp = await patchAs(page, request, { title: "x".repeat(5001) });
    expect(resp.status()).toBe(400);
  });
});
