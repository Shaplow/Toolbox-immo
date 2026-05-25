/**
 * E2E Security — Scoping et isolation des slots, permissions par rôle.
 *
 * Ces tests vérifient que :
 * 1. Un MONTEUR non assigné ne peut pas accéder au slot orphan.
 * 2. Un MONTEUR non assigné reçoit 403/404 sur l'endpoint presign.
 * 3. Un CM ne voit pas le bouton "Promouvoir" (ADMIN seul).
 * 4. Un USER reçoit 404 sur toute route /publications.
 * 5. Un appel direct à upload-presign sans session → 401.
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth";

const ASSIGNED_SLOT = "test-slot-1";   // assigné monteur + CM
const ORPHAN_SLOT = "test-slot-orphan"; // aucun assigné

// ── 1. MONTEUR non assigné — isolation slot ───────────────────────────────────

test.describe("Security — MONTEUR non assigné", () => {
  test("GET /publications/test-slot-orphan → 404 ou redirect", async ({ page }) => {
    await loginAs(page, "monteur");
    const response = await page.goto(`/publications/${ORPHAN_SLOT}`);
    const status = response?.status() ?? 0;
    const finalUrl = page.url();
    const isBlocked =
      status === 404 ||
      finalUrl.includes("/home") ||
      finalUrl.includes("/404") ||
      !finalUrl.includes(`/publications/${ORPHAN_SLOT}`);
    expect(isBlocked).toBe(true);
  });

  test("POST /api/publications/test-slot-orphan/upload-presign → 403 ou 404", async ({ page }) => {
    await loginAs(page, "monteur");

    // Appel direct à l'API
    const response = await page.request.post(
      `/api/publications/${ORPHAN_SLOT}/upload-presign`,
      {
        data: {
          kind: "version",
          filename: "test.mp4",
          contentType: "video/mp4",
          size: 1024 * 1024,
        },
        headers: { "Content-Type": "application/json" },
      }
    );
    // L'endpoint doit renvoyer 403 ou 404 (pas de presign pour slot non assigné)
    expect([403, 404]).toContain(response.status());
  });

  test("POST /api/publications/test-slot-orphan/upload-complete → 403 ou 404", async ({ page }) => {
    await loginAs(page, "monteur");

    const response = await page.request.post(
      `/api/publications/${ORPHAN_SLOT}/upload-complete`,
      {
        data: {
          kind: "version",
          r2Key: "publications/test-slot-orphan/versions/v1-fake.mp4",
          fileName: "test.mp4",
          mimeType: "video/mp4",
        },
        headers: { "Content-Type": "application/json" },
      }
    );
    expect([403, 404]).toContain(response.status());
  });
});

// ── 2. CM ne peut pas promouvoir ─────────────────────────────────────────────

test.describe("Security — CM ne peut pas promouvoir une version", () => {
  test("POST /api/publications/[id]/versions/fake-id/promote → 403 pour CM", async ({ page }) => {
    await loginAs(page, "cm");

    const response = await page.request.post(
      `/api/publications/${ASSIGNED_SLOT}/versions/fake-version-id/promote`,
      {
        data: {},
        headers: { "Content-Type": "application/json" },
      }
    );
    // Soit 403 (permission refusée) soit 404 (version inexistante) — les deux sont acceptables
    // L'important : pas de 200 ni 201
    expect(response.status()).not.toBe(200);
    expect(response.status()).not.toBe(201);
  });

  test("CM ne voit pas le bouton Promouvoir dans l'UI", async ({ page }) => {
    await loginAs(page, "cm");
    await page.goto(`/publications/${ASSIGNED_SLOT}`);
    await page.waitForLoadState("domcontentloaded");

    const promouvoirBtn = page.getByRole("button", { name: /promouvoir/i });
    const count = await promouvoirBtn.count();
    expect(count).toBe(0);
  });
});

// ── 3. USER legacy — accès interdit partout ───────────────────────────────────

test.describe("Security — USER legacy bloqué", () => {
  test("GET /publications/[id] → bloqué pour USER", async ({ page }) => {
    await loginAs(page, "user");
    const response = await page.goto(`/publications/${ASSIGNED_SLOT}`);
    const status = response?.status() ?? 0;
    const finalUrl = page.url();
    const isBlocked =
      status === 404 ||
      finalUrl.includes("/home") ||
      finalUrl.includes("/tools") ||
      !finalUrl.includes(`/publications/${ASSIGNED_SLOT}`);
    expect(isBlocked).toBe(true);
  });

  test("POST /api/publications/[id]/upload-presign → 403 pour USER", async ({ page }) => {
    await loginAs(page, "user");

    const response = await page.request.post(
      `/api/publications/${ASSIGNED_SLOT}/upload-presign`,
      {
        data: {
          kind: "rush",
          filename: "test.mp4",
          contentType: "video/mp4",
          size: 1024 * 1024,
        },
        headers: { "Content-Type": "application/json" },
      }
    );
    // USER ne peut pas accéder aux publications → 401 ou 403 ou 404
    expect([401, 403, 404]).toContain(response.status());
  });
});

// ── 4. Sans session — endpoints non autorisés ─────────────────────────────────

test.describe("Security — appels sans session", () => {
  test("POST /api/publications/[id]/upload-presign sans session → 401", async ({ request }) => {
    // Appel direct sans cookie de session
    const response = await request.post(
      `/api/publications/${ASSIGNED_SLOT}/upload-presign`,
      {
        data: {
          kind: "version",
          filename: "test.mp4",
          contentType: "video/mp4",
          size: 1024 * 1024,
        },
        headers: { "Content-Type": "application/json" },
      }
    );
    expect(response.status()).toBe(401);
  });

  test("POST /api/publications/[id]/upload-complete sans session → 401", async ({ request }) => {
    const response = await request.post(
      `/api/publications/${ASSIGNED_SLOT}/upload-complete`,
      {
        data: {
          kind: "rush",
          r2Key: "publications/test-slot-1/rushes/fake.mp4",
          fileName: "fake.mp4",
          mimeType: "video/mp4",
        },
        headers: { "Content-Type": "application/json" },
      }
    );
    expect(response.status()).toBe(401);
  });

  test("POST /api/publications/[id]/versions/[vId]/promote sans session → 401", async ({ request }) => {
    const response = await request.post(
      `/api/publications/${ASSIGNED_SLOT}/versions/fake-version-id/promote`,
      {
        data: {},
        headers: { "Content-Type": "application/json" },
      }
    );
    expect(response.status()).toBe(401);
  });
});

// ── 5. Scoping r2Key — cross-slot forgé ──────────────────────────────────────

test.describe("Security — scoping r2Key cross-slot", () => {
  test("upload-complete avec r2Key d'un autre slot → 400 ou 403", async ({ page }) => {
    await loginAs(page, "monteur");

    // Tentative de compléter un upload en utilisant un r2Key qui ne contient pas le slotId correct
    const response = await page.request.post(
      `/api/publications/${ASSIGNED_SLOT}/upload-complete`,
      {
        data: {
          kind: "version",
          // r2Key contient un autre slotId → devrait être rejeté
          r2Key: `publications/${ORPHAN_SLOT}/versions/v1-forgé.mp4`,
          fileName: "forgé.mp4",
          mimeType: "video/mp4",
        },
        headers: { "Content-Type": "application/json" },
      }
    );
    // L'endpoint doit rejeter le r2Key qui ne correspond pas au slot
    expect([400, 403, 404]).toContain(response.status());
  });
});
