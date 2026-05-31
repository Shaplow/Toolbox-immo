import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAs } from "./fixtures/auth";

// Connexion directe à la DB de test pour purger les artefacts entre tests
// (les tests Playwright partagent un même process Node + DB, donc l'état
// d'un test influence le suivant si on ne cleanup pas).
const prismaTest = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.TEST_DATABASE_URL ??
        "postgresql://toolbox:toolbox@localhost:5433/toolbox_test",
    },
  },
});

/**
 * E2E — Chaîne de production V8 (captions manual + cover manualSelect +
 * auto-launch transcription depuis captions).
 *
 * Fixtures attendues (cf. scripts/seed-test-db.ts) :
 *   - slot `test-slot-1` (pattern auto_template, needsCaptions auto)
 *   - slot `test-slot-v8-manual` (pattern manual_rushes, needsCaptionsMode=manual,
 *     coverMode=manualSelect, status=EDIT_APPROVED)
 *   - preset `test-caption-preset-1`
 *
 * Pré-requis : `npm run test:db:setup && npm run test:db:seed` après tout
 * changement de schema.
 */

const SLOT_MANUAL = "test-slot-v8-manual";
const PRESET = "test-caption-preset-1";

test.describe("V8.2 — Captions mode manuel", () => {
  // Purge les CaptionJobs du slot avant chaque test pour partir d'un état neuf
  // (sinon le test "voir bouton Écrire" fail si le test "sauvegarde" est déjà
  // passé une fois — bouton devient "Modifier" après le 1er save).
  test.beforeEach(async () => {
    await prismaTest.publicationSlot.update({
      where: { id: SLOT_MANUAL },
      data: { activeCaptionJobId: null },
    });
    await prismaTest.captionJob.deleteMany({ where: { slotId: SLOT_MANUAL } });
  });

  test("admin voit la section captions en mode manuel + bouton 'Écrire'", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/publications/${SLOT_MANUAL}`);

    // Badge "Mode manuel" visible dans la section captions
    await expect(page.getByText("Mode manuel").first()).toBeVisible();
    // CTA dédié au mode manuel (pas le CTA pipeline auto)
    await expect(
      page.getByRole("link", { name: /Écrire les sous-titres/i }),
    ).toBeVisible();
  });

  test("clic 'Écrire' ouvre l'éditeur SRT puis sauvegarde", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/publications/${SLOT_MANUAL}`);

    await page.getByRole("link", { name: /Écrire les sous-titres/i }).click();
    await expect(page).toHaveURL(new RegExp(`/publications/${SLOT_MANUAL}/captions/manual`));

    // Premier bloc auto-créé : texte vide → on remplit
    const firstText = page
      .locator('textarea[placeholder*="texte affiché"]')
      .first();
    await firstText.fill("Premier sous-titre test E2E");

    // Sauvegarder
    await page.getByRole("button", { name: /Enregistrer/ }).click();

    // Redirect retour fiche + toast success
    await page.waitForURL(new RegExp(`/publications/${SLOT_MANUAL}$`), { timeout: 10_000 });

    // La section captions doit maintenant montrer "saisis à la main" + bouton "Modifier"
    await expect(page.getByText(/Sous-titres saisis à la main/i)).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Modifier les sous-titres/i }),
    ).toBeVisible();
  });

  test("rechargement de l'éditeur pré-remplit le SRT sauvegardé", async ({ page }) => {
    // Setup explicite : crée un CaptionJob COMPLETED avec un SRT connu
    // (beforeEach a purgé, donc on doit créer la précondition ici).
    const admin = await prismaTest.user.findUnique({ where: { email: "admin@test.local" } });
    if (!admin) throw new Error("Seed admin manquant");
    const job = await prismaTest.captionJob.create({
      data: {
        userId: admin.id,
        slotId: SLOT_MANUAL,
        status: "COMPLETED",
        srtContent:
          "1\n00:00:00,000 --> 00:00:03,000\nSous-titre pré-chargé E2E\n",
        config: JSON.stringify({ mode: "manual" }),
      },
    });
    await prismaTest.publicationSlot.update({
      where: { id: SLOT_MANUAL },
      data: { activeCaptionJobId: job.id },
    });

    await loginAs(page, "admin");
    await page.goto(`/publications/${SLOT_MANUAL}/captions/manual`);

    const firstText = page
      .locator('textarea[placeholder*="texte affiché"]')
      .first();
    await expect(firstText).toHaveValue(/Sous-titre pré-chargé E2E/);
  });

  test("URL captions/manual sur slot mode auto → redirige vers la fiche", async ({ page }) => {
    await loginAs(page, "admin");
    // test-slot-1 a pattern auto_template + needsCaptions auto (pas manual)
    await page.goto(`/publications/test-slot-1/captions/manual`);
    // La page server redirige vers /publications/[id] si mode != "manual"
    await page.waitForURL(/\/publications\/test-slot-1$/, { timeout: 5_000 });
  });
});

test.describe("V8.1 — Cover manualSelect", () => {
  test("admin voit le badge 'Mode manuel · extraction libre' dans la section cover", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/publications/${SLOT_MANUAL}`);

    // Wording exact unique à CoverSection (V8.1.3). Le badge est rendu 2x
    // (desktop + variant responsive selon le viewport), on prend le premier.
    await expect(
      page.getByText(/Mode manuel · extraction libre/i).first(),
    ).toBeVisible();
  });

  test("POST /api/.../cover/manual-select promote la frame comme cover finale", async ({ page }) => {
    await loginAs(page, "admin");
    // Cookie d'auth est attaché à la page context — request hérite via storageState.
    // En l'absence de storageState explicite, on rejoue le login dans le request context.
    // Solution : faire la requête depuis page.evaluate ou via page.request.
    const res = await page.request.post(
      `/api/publications/${SLOT_MANUAL}/cover/manual-select`,
      {
        data: {
          frameUrl: "https://example.com/test-frame.png",
          timestamp: 2.5,
        },
      },
    );

    expect(res.ok()).toBe(true);
    const body = await res.json() as { ok: boolean; packId: string; finalCoverUrl: string };
    expect(body.ok).toBe(true);
    expect(body.finalCoverUrl).toBe("https://example.com/test-frame.png");
    expect(body.packId).toBeTruthy();
  });
});

test.describe("V8.3 — Auto-launch transcription depuis captions", () => {
  test("captions/generate sans transcription affiche banner pending OU blocker", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/captions/${PRESET}/generate?slotId=${SLOT_MANUAL}`);

    // Deux issues légitimes selon l'état env :
    //  - RunPod + R2 configurés en test → banner pending sky
    //  - RunPod off (cas le plus probable en CI) → banner blocker rose
    // On vérifie qu'un des deux est rendu, pas un formulaire vide.
    const pendingBanner = page.locator("text=/Transcription en cours/");
    const blockerBanner = page.locator("text=/Impossible de pré-charger une transcription/");

    await expect(pendingBanner.or(blockerBanner)).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("ProductionChain — visibilité par rôle", () => {
  test("monteur voit la chaîne sur son slot assigné", async ({ page }) => {
    await loginAs(page, "monteur");
    await page.goto(`/publications/${SLOT_MANUAL}`);

    // ProductionChain rend les étapes ; au moins "Sous-titres" doit être visible
    // (mode manual → captions actif, donc step visible). On ne teste pas
    // "Cover" car son visibility dépend du rôle (CM/ADMIN only par défaut).
    await expect(page.getByText(/Sous-titres/i).first()).toBeVisible();
  });

  test("CM voit la chaîne sur son slot assigné", async ({ page }) => {
    await loginAs(page, "cm");
    await page.goto(`/publications/${SLOT_MANUAL}`);
    await expect(page.getByText(/Sous-titres/i).first()).toBeVisible();
  });
});
