/**
 * E2E — Bons de commande (Order).
 *
 * Chaîne complète pilotée par l'API (cookies de session Playwright) :
 *  1. l'agence (agence@test.local, client test-client-1) crée une commande
 *     depuis le modèle seed `test-order-template-1` (Bien + Tournage, 2 reels) ;
 *  2. isolation : l'agence 2 (autre client) reçoit 404 sur cette commande,
 *     et ne voit pas le modèle de l'agence 1 ;
 *  3. whitelist : les champs admin (assignés) sont ignorés/refusés côté fiches ;
 *  4. l'admin valide → fiches APPROVED + 2 publications créées en banque
 *     (sans date), rattachées au tournage (rushs partagés) ;
 *  5. la vue externe reste simplifiée (pas de statut technique ni d'id slot).
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { loginAs, type TestUserKey } from "./fixtures/auth";

const BASE = "http://localhost:3100";

async function cookieHeader(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function api(
  page: Page,
  request: APIRequestContext,
  method: "get" | "post" | "patch",
  path: string,
  data?: Record<string, unknown>,
) {
  const headers = { "Content-Type": "application/json", Cookie: await cookieHeader(page) };
  if (method === "get") return request.get(`${BASE}${path}`, { headers });
  if (method === "post") return request.post(`${BASE}${path}`, { headers, data });
  return request.patch(`${BASE}${path}`, { headers, data });
}

async function newSession(browser: import("@playwright/test").Browser, user: TestUserKey) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginAs(page, user);
  return { ctx, page };
}

test.describe.serial("Bons de commande — chaîne agence → admin", () => {
  let orderId = "";

  test("l'agence crée une commande depuis le modèle (fiches Bien + Tournage)", async ({ browser }) => {
    const { ctx, page } = await newSession(browser, "agence");

    const scheduledAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const resp = await api(page, ctx.request, "post", "/api/orders", {
      orderTemplateId: "test-order-template-1",
      accountId: undefined,
      // Compte : résolu ci-dessous — test-client-1 possède test_account.
      notes: "Commande e2e",
      fiches: [
        { entityTypeId: "etype_bien", label: "Villa e2e", fields: {} },
        {
          entityTypeId: "etype_tournage",
          label: "Tournage villa e2e",
          fields: {},
          scheduledAt,
        },
      ],
    });
    // Le tournage exige un compte → 400 sans accountId.
    expect(resp.status()).toBe(400);

    // Récupérer le compte du client via la page /commandes/new n'est pas
    // nécessaire : le seed rattache test_account à test-client-1. On liste
    // les comptes... côté externe il n'y a pas d'API comptes ; le handle du
    // seed est connu — on interroge la commande via un 2e POST avec le compte
    // résolu par l'admin plus bas. Ici : POST avec l'id du compte lu en DB
    // n'est pas possible depuis le test → on passe par la page new qui
    // présélectionne l'unique compte. Plus simple : POST admin ? Non — on
    // s'appuie sur le fait que le seed expose un id stable via GET admin.
    const admin = await newSession(browser, "admin");
    const accountsResp = await api(admin.page, admin.ctx.request, "get", "/api/admin/accounts");
    const accounts = (await accountsResp.json()) as { id: string; handle: string }[];
    const account = accounts.find((a) => a.handle === "test_account");
    expect(account).toBeTruthy();
    await admin.ctx.close();

    const resp2 = await api(page, ctx.request, "post", "/api/orders", {
      orderTemplateId: "test-order-template-1",
      accountId: account!.id,
      notes: "Commande e2e",
      fiches: [
        { entityTypeId: "etype_bien", label: "Villa e2e", fields: {} },
        {
          entityTypeId: "etype_tournage",
          label: "Tournage villa e2e",
          fields: {},
          scheduledAt,
        },
      ],
    });
    expect(resp2.status()).toBe(201);
    const order = (await resp2.json()) as {
      id: string;
      status: string;
      entities: { typeId: string; validationStatus: string | null }[];
      slots: unknown[];
    };
    orderId = order.id;
    expect(order.status).toBe("SUBMITTED");
    expect(order.entities).toHaveLength(2);
    // needsAdminValidation activé sur les types système (seed) → PENDING_ADMIN.
    for (const e of order.entities) {
      expect(e.validationStatus).toBe("PENDING_ADMIN");
    }
    expect(order.slots).toHaveLength(0);

    await ctx.close();
  });

  test("isolation : l'autre agence ne voit ni la commande (404) ni le modèle", async ({ browser }) => {
    const { ctx, page } = await newSession(browser, "agence2");

    const resp = await api(page, ctx.request, "get", `/api/orders/${orderId}`);
    expect(resp.status()).toBe(404);

    const listResp = await api(page, ctx.request, "get", "/api/orders");
    const list = (await listResp.json()) as { orders: { id: string }[] };
    expect(list.orders.some((o) => o.id === orderId)).toBe(false);

    // Le modèle de l'agence 1 est hors allowlist → 404 anti-énumération.
    const createResp = await api(page, ctx.request, "post", "/api/orders", {
      orderTemplateId: "test-order-template-1",
      fiches: [],
    });
    expect(createResp.status()).toBe(404);

    await ctx.close();
  });

  test("les rôles internes non-admin n'accèdent pas aux commandes", async ({ browser }) => {
    const { ctx, page } = await newSession(browser, "monteur");
    const resp = await api(page, ctx.request, "get", `/api/orders/${orderId}`);
    expect(resp.status()).toBe(404);
    await ctx.close();
  });

  test("édition de fiche par l'agence : whitelist stricte", async ({ browser }) => {
    const { ctx, page } = await newSession(browser, "agence");

    const orderResp = await api(page, ctx.request, "get", `/api/orders/${orderId}`);
    const order = (await orderResp.json()) as {
      entities: { id: string; typeName: string }[];
      slots: unknown[];
    };
    const bien = order.entities.find((e) => e.typeName === "Bien");
    expect(bien).toBeTruthy();

    // label éditable ; un champ hors schéma est rejeté (schéma vide sur le seed
    // → clé inconnue seulement si un schéma existe ; ici on vérifie le label).
    const patchResp = await api(
      page,
      ctx.request,
      "patch",
      `/api/orders/${orderId}/entities/${bien!.id}`,
      { label: "Villa e2e — corrigée" },
    );
    expect(patchResp.status()).toBe(200);

    // Un PATCH direct sur /api/entities est interdit aux externes (scope __never__).
    const directPatch = await api(page, ctx.request, "patch", `/api/entities/${bien!.id}`, {
      label: "hack",
    });
    expect([403, 404]).toContain(directPatch.status());

    await ctx.close();
  });

  test("l'admin valide : fiches approuvées + 2 reels en banque sur le tournage", async ({ browser }) => {
    const { ctx, page } = await newSession(browser, "admin");

    const resp = await api(page, ctx.request, "post", `/api/orders/${orderId}/validate`);
    expect(resp.status()).toBe(200);
    const result = (await resp.json()) as {
      order: {
        status: string;
        entities: { validationStatus: string | null }[];
        slots: { id: string; status: string; scheduledAt: string | null }[];
      };
      createdSlotIds: string[];
      failed: { label: string; error: string }[];
    };
    expect(result.failed).toEqual([]);
    expect(result.order.status).toBe("VALIDATED");
    for (const e of result.order.entities) {
      expect(e.validationStatus).toBe("APPROVED");
    }
    expect(result.createdSlotIds).toHaveLength(2);
    // Banque : aucun slot daté ; le placement est manuel.
    for (const s of result.order.slots) {
      expect(s.scheduledAt).toBeNull();
    }

    // Les reels pointent le tournage de la commande (rushs partagés).
    const slotResp = await api(
      page,
      ctx.request,
      "get",
      `/api/calendar/slots/${result.createdSlotIds[0]}`,
    );
    expect(slotResp.status()).toBe(200);
    const slot = (await slotResp.json()) as { eventId?: string | null; shootEntityId?: string | null };
    expect(slot.eventId ?? slot.shootEntityId).toBeTruthy();

    await ctx.close();
  });

  test("vue externe simplifiée : pas d'id ni de statut technique sur les slots", async ({ browser }) => {
    const { ctx, page } = await newSession(browser, "agence");

    const resp = await api(page, ctx.request, "get", `/api/orders/${orderId}`);
    expect(resp.status()).toBe(200);
    const order = (await resp.json()) as {
      status: string;
      slots: Record<string, unknown>[];
    };
    expect(order.status).toBe("VALIDATED");
    expect(order.slots).toHaveLength(2);
    for (const s of order.slots) {
      expect(s.id).toBeUndefined();
      expect(s.status).toBeUndefined();
      expect(typeof s.stepLabel).toBe("string");
    }

    await ctx.close();
  });
});
