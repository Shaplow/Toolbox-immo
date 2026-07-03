import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAs } from "./fixtures/auth";
import { getCookieHeader } from "./helpers/rotation-e2e";

/**
 * E2E — Flux « Missions ».
 *
 * Une mission = PublicationSlot piloté par une recette GLOBALE (PatternTemplate,
 * obligatoire) avec un compte Instagram OPTIONNEL. Sans compte = production stock.
 *
 * Couvre :
 *   1. Création API sans compte → slot accountId=null + patternTemplateId + fieldSchema hérité.
 *   2. Recette obligatoire (400 sans patternTemplateId).
 *   3. Gating outil : un rôle sans l'outil `mission` → 403.
 *   4. Garde mark-published : mission sans compte → 400 (compte requis pour publier).
 *   5. UI /missions/new rendue (heading + copy compte optionnel).
 *
 * Pré-requis : `npm run test:db:setup && npm run test:db:seed`.
 */

const prismaTest = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.TEST_DATABASE_URL ??
        "postgresql://toolbox:toolbox@localhost:5433/toolbox_test",
    },
  },
});

const RECIPE_ID = "e2e-mission-recipe";
const RECIPE_FIELDS = ["adresse", "prix"];
const createdSlotIds: string[] = [];

// Fixtures pour le cas « mission avec compte hérite du binding ».
let bindingId: string | null = null;
let seededAccountId: string | null = null;
let seededMonteurId: string | null = null;

// Fixture « bien partagé ».
const PROPERTY_ID = "e2e-property";
const PROPERTY_FIELDS = { adresse: "12 rue des Lilas", prix: "350 000 €" };

test.beforeAll(async () => {
  // Bien partagé (fiche référencée par des missions).
  await prismaTest.property.upsert({
    where: { id: PROPERTY_ID },
    update: { isArchived: false, fields: JSON.stringify(PROPERTY_FIELDS) },
    create: {
      id: PROPERTY_ID,
      label: "E2E Bien",
      fields: JSON.stringify(PROPERTY_FIELDS),
      fieldSchema: JSON.stringify(["adresse", "prix"]),
      isArchived: false,
    },
  });

  // Recette globale minimale (sans compte, sans overrides bloquants).
  await prismaTest.patternTemplate.upsert({
    where: { id: RECIPE_ID },
    update: {
      isArchived: false,
      fieldSchema: JSON.stringify(RECIPE_FIELDS),
    },
    create: {
      id: RECIPE_ID,
      label: "E2E Mission Recipe",
      source: "auto_template",
      templateId: null,
      coverMode: "none",
      coverConfig: undefined,
      needsCaptions: false,
      needsCaptionsMode: "none",
      needsDescription: "none",
      needsAdminValidation: false,
      needsClientValidation: false,
      allowsClientRevision: false,
      needsBrief: false,
      fieldSchema: JSON.stringify(RECIPE_FIELDS),
      isArchived: false,
    },
  });

  // Binding (recette appliquée à un compte) avec un monteur par défaut — pour
  // vérifier qu'une mission avec compte en hérite.
  const [monteur, account] = await Promise.all([
    prismaTest.user.findFirst({ where: { role: "MONTEUR" }, select: { id: true } }),
    prismaTest.instagramAccount.findFirst({ select: { id: true } }),
  ]);
  seededMonteurId = monteur?.id ?? null;
  seededAccountId = account?.id ?? null;
  if (seededAccountId && seededMonteurId) {
    const binding = await prismaTest.patternBinding.create({
      data: {
        accountId: seededAccountId,
        patternTemplateId: RECIPE_ID,
        dayOfWeek: [],
        publishTime: "09:00",
        isActive: true,
        defaultAssigneeMonteurId: seededMonteurId,
      },
      select: { id: true },
    });
    bindingId = binding.id;
  }
});

test.afterAll(async () => {
  // Teardown tolérant : slots créés, puis binding, puis la recette fixture
  // (le binding référence le template avec onDelete=Restrict → avant la recette).
  if (createdSlotIds.length) {
    await prismaTest.publicationSlot
      .deleteMany({ where: { id: { in: createdSlotIds } } })
      .catch(() => {});
  }
  await prismaTest.publicationSlot
    .deleteMany({ where: { patternTemplateId: RECIPE_ID } })
    .catch(() => {});
  if (bindingId) {
    await prismaTest.publicationSlot
      .deleteMany({ where: { patternBindingId: bindingId } })
      .catch(() => {});
    await prismaTest.patternBinding.delete({ where: { id: bindingId } }).catch(() => {});
  }
  await prismaTest.publicationSlot
    .deleteMany({ where: { propertyId: PROPERTY_ID } })
    .catch(() => {});
  await prismaTest.patternTemplate.delete({ where: { id: RECIPE_ID } }).catch(() => {});
  await prismaTest.property.delete({ where: { id: PROPERTY_ID } }).catch(() => {});
  await prismaTest.$disconnect();
});

test.describe("Missions — création API", () => {
  test("admin crée une mission SANS compte → slot accountId=null + recette + fieldSchema hérité", async ({
    page,
    request,
  }) => {
    await loginAs(page, "admin");
    const Cookie = await getCookieHeader(page);

    const res = await request.post("/api/missions", {
      headers: { "Content-Type": "application/json", Cookie },
      data: { patternTemplateId: RECIPE_ID },
    });
    expect(res.ok()).toBeTruthy();

    const slot = await res.json();
    createdSlotIds.push(slot.id);

    expect(slot.accountId).toBeNull();
    expect(slot.patternTemplateId).toBe(RECIPE_ID);
    // Titre par défaut = label de la recette.
    expect(slot.title).toBe("E2E Mission Recipe");
    // fieldSchema hérité de la recette (non fourni dans le body).
    expect(slot.fieldSchema).toEqual(RECIPE_FIELDS);

    // Vérification DB : le slot existe bien sans compte.
    const dbSlot = await prismaTest.publicationSlot.findUnique({
      where: { id: slot.id },
      select: { accountId: true, patternTemplateId: true },
    });
    expect(dbSlot?.accountId).toBeNull();
    expect(dbSlot?.patternTemplateId).toBe(RECIPE_ID);
  });

  test("champs personnalisés ponctuels transmis → mergés au slot", async ({
    page,
    request,
  }) => {
    await loginAs(page, "admin");
    const Cookie = await getCookieHeader(page);

    const res = await request.post("/api/missions", {
      headers: { "Content-Type": "application/json", Cookie },
      data: {
        patternTemplateId: RECIPE_ID,
        fields: { adresse: "12 rue des Lilas", prix: "350 000 €" },
        fieldSchema: ["adresse", "prix"],
      },
    });
    expect(res.ok()).toBeTruthy();
    const slot = await res.json();
    createdSlotIds.push(slot.id);
    expect(slot.fields).toMatchObject({ adresse: "12 rue des Lilas", prix: "350 000 €" });
  });

  test("mission avec compte lié à la recette → hérite du monteur par défaut du binding", async ({
    page,
    request,
  }) => {
    test.skip(
      !bindingId || !seededAccountId || !seededMonteurId,
      "fixtures compte/monteur/binding absentes du seed",
    );
    await loginAs(page, "admin");
    const Cookie = await getCookieHeader(page);

    const res = await request.post("/api/missions", {
      headers: { "Content-Type": "application/json", Cookie },
      data: { patternTemplateId: RECIPE_ID, accountId: seededAccountId },
    });
    expect(res.ok()).toBeTruthy();
    const slot = await res.json();
    createdSlotIds.push(slot.id);

    // Le binding (compte, recette) est résolu → assigné par défaut reporté.
    expect(slot.assigneeMonteurId).toBe(seededMonteurId);
    expect(slot.patternBindingId).toBe(bindingId);
  });

  test("recette obligatoire : POST sans patternTemplateId → 400", async ({
    page,
    request,
  }) => {
    await loginAs(page, "admin");
    const Cookie = await getCookieHeader(page);

    const res = await request.post("/api/missions", {
      headers: { "Content-Type": "application/json", Cookie },
      data: { accountId: null },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("Missions — bien partagé", () => {
  test("mission avec propertyId → référence le bien", async ({ page, request }) => {
    await loginAs(page, "admin");
    const Cookie = await getCookieHeader(page);

    const res = await request.post("/api/missions", {
      headers: { "Content-Type": "application/json", Cookie },
      data: { patternTemplateId: RECIPE_ID, propertyId: PROPERTY_ID },
    });
    expect(res.ok()).toBeTruthy();
    const slot = await res.json();
    createdSlotIds.push(slot.id);
    expect(slot.propertyId).toBe(PROPERTY_ID);

    const dbSlot = await prismaTest.publicationSlot.findUnique({
      where: { id: slot.id },
      select: { propertyId: true },
    });
    expect(dbSlot?.propertyId).toBe(PROPERTY_ID);
  });

  test("batch : POST /api/properties/[id]/missions crée N missions rattachées au bien", async ({
    page,
    request,
  }) => {
    await loginAs(page, "admin");
    const Cookie = await getCookieHeader(page);

    const res = await request.post(`/api/properties/${PROPERTY_ID}/missions`, {
      headers: { "Content-Type": "application/json", Cookie },
      data: { recipeIds: [RECIPE_ID], accountId: null },
    });
    expect(res.ok()).toBeTruthy();
    const { count, createdIds } = await res.json();
    expect(count).toBe(1);
    (createdIds as string[]).forEach((id) => createdSlotIds.push(id));

    const dbSlot = await prismaTest.publicationSlot.findUnique({
      where: { id: createdIds[0] },
      select: { propertyId: true, patternTemplateId: true },
    });
    expect(dbSlot?.propertyId).toBe(PROPERTY_ID);
    expect(dbSlot?.patternTemplateId).toBe(RECIPE_ID);
  });

  test("batch : recette manquante → 400", async ({ page, request }) => {
    await loginAs(page, "admin");
    const Cookie = await getCookieHeader(page);
    const res = await request.post(`/api/properties/${PROPERTY_ID}/missions`, {
      headers: { "Content-Type": "application/json", Cookie },
      data: { recipeIds: [] },
    });
    expect(res.status()).toBe(400);
  });

  test("rattacher/changer le bien d'une mission EXISTANTE via PATCH", async ({
    page,
    request,
  }) => {
    await loginAs(page, "admin");
    const Cookie = await getCookieHeader(page);

    // Mission sans bien.
    const createRes = await request.post("/api/missions", {
      headers: { "Content-Type": "application/json", Cookie },
      data: { patternTemplateId: RECIPE_ID },
    });
    expect(createRes.ok()).toBeTruthy();
    const slot = await createRes.json();
    createdSlotIds.push(slot.id);
    expect(slot.propertyId).toBeNull();

    // Rattache le bien via PATCH (champ propertyId whitelisté ADMIN).
    const patchRes = await request.patch(`/api/calendar/slots/${slot.id}`, {
      headers: { "Content-Type": "application/json", Cookie },
      data: { propertyId: PROPERTY_ID },
    });
    expect(patchRes.ok()).toBeTruthy();

    const dbSlot = await prismaTest.publicationSlot.findUnique({
      where: { id: slot.id },
      select: { propertyId: true },
    });
    expect(dbSlot?.propertyId).toBe(PROPERTY_ID);

    // Détache (null).
    const detachRes = await request.patch(`/api/calendar/slots/${slot.id}`, {
      headers: { "Content-Type": "application/json", Cookie },
      data: { propertyId: null },
    });
    expect(detachRes.ok()).toBeTruthy();
    const dbSlot2 = await prismaTest.publicationSlot.findUnique({
      where: { id: slot.id },
      select: { propertyId: true },
    });
    expect(dbSlot2?.propertyId).toBeNull();
  });
});

test.describe("Missions — gating outil", () => {
  test("rôle sans l'outil `mission` → 403", async ({ page, request }) => {
    // MONTEUR n'a pas l'outil `mission` (ni admin, ni perm individuelle).
    await loginAs(page, "monteur");
    const Cookie = await getCookieHeader(page);

    const res = await request.post("/api/missions", {
      headers: { "Content-Type": "application/json", Cookie },
      data: { patternTemplateId: RECIPE_ID },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe("Missions — garde publication", () => {
  test("mission sans compte : mark-published → 400 (compte requis)", async ({
    page,
    request,
  }) => {
    await loginAs(page, "admin");
    const Cookie = await getCookieHeader(page);

    // Crée une mission sans compte.
    const createRes = await request.post("/api/missions", {
      headers: { "Content-Type": "application/json", Cookie },
      data: { patternTemplateId: RECIPE_ID },
    });
    expect(createRes.ok()).toBeTruthy();
    const slot = await createRes.json();
    createdSlotIds.push(slot.id);

    // Tente de marquer publié → doit être refusé (pas de compte Instagram).
    const publishRes = await request.post(`/api/publications/${slot.id}/mark-published`, {
      headers: { "Content-Type": "application/json", Cookie },
      data: { url: "https://www.instagram.com/p/ABC123/" },
    });
    expect(publishRes.status()).toBe(400);
    const body = await publishRes.json();
    expect(body.error).toMatch(/compte Instagram/i);
  });
});

test.describe("Missions — UI /missions/new", () => {
  test("la page de création rend le formulaire (recette + compte optionnel)", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto("/missions/new");

    await expect(page.getByRole("heading", { name: /Nouvelle mission/i })).toBeVisible();
    // Copy clé : le compte est optionnel (production stock).
    await expect(page.getByText(/production stock/i).first()).toBeVisible();
    // Le bouton de création est présent.
    await expect(page.getByRole("button", { name: /Créer la mission/i })).toBeVisible();
  });
});
