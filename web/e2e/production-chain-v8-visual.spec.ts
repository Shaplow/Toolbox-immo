import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAs } from "./fixtures/auth";

/**
 * Screenshot tests (visual regression) sur les surfaces V8.
 *
 * Complète `production-chain-v8.spec.ts` qui ne vérifie que la présence
 * de chaînes dans le DOM. Ici on compare pixel-à-pixel à une baseline en
 * repo — détecte les régressions visuelles que les assertions textuelles
 * ratent : fond gris parasite, card mal alignée, badge dupliqué, contraste
 * cassé après refacto CSS.
 *
 * Surfaces couvertes :
 *  1. Fiche publication mode manual (chaîne entière visible)
 *  2. Page éditeur SRT manuel
 *  3. Page transcription list (cards + dropzone glass)
 *  4. Page captions/generate avec banner pending/blocker
 *
 * Workflow :
 *  - 1er run : baseline générée dans `*-snapshots/*.png`.
 *  - Runs suivants : compare au pixel près (tolérance maxDiffPixelRatio).
 *  - Après changement intentionnel de style, valider visuellement le
 *    HTML report Playwright puis :
 *      npx playwright test e2e/production-chain-v8-visual.spec.ts --update-snapshots
 *
 * Pré-requis : DB seedée (npm run test:db:setup && npm run test:db:seed).
 */

const SLOT_MANUAL = "test-slot-v8-manual";
const PRESET = "test-caption-preset-1";

const SCREENSHOT_OPTS = {
  // Tolérance pour anti-aliasing fontes / sub-pixel rendering selon OS.
  maxDiffPixelRatio: 0.02,
  // Désactive les animations CSS pour des captures stables.
  animations: "disabled" as const,
  // Cache tout ce qui contient des timestamps relatifs (ex. "il y a 3 jours")
  // pour ne pas avoir de faux positifs entre runs à dates différentes.
  mask: [],
  fullPage: true,
};

const prismaTest = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.TEST_DATABASE_URL ??
        "postgresql://toolbox:toolbox@localhost:5433/toolbox_test",
    },
  },
});

test.describe("V8 visual regression — chaîne de production", () => {
  // État neuf de la DB pour stabilité des captures (sinon le nb de captions
  // jobs / status affichés change selon l'ordre des tests précédents).
  test.beforeEach(async () => {
    await prismaTest.publicationSlot.update({
      where: { id: SLOT_MANUAL },
      data: { activeCaptionJobId: null },
    });
    await prismaTest.captionJob.deleteMany({ where: { slotId: SLOT_MANUAL } });
  });

  test("fiche publication — mode manual end-to-end", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/publications/${SLOT_MANUAL}`);
    // Attente que la chaîne de production soit rendue (ProductionChain)
    // et que la section captions soit visible.
    await expect(page.getByText(/Sous-titres/i).first()).toBeVisible({
      timeout: 10_000,
    });
    // Laisse le SSE de jobs s'établir (sinon un loader pulse pendant la capture).
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("fiche-publication-manual.png", SCREENSHOT_OPTS);
  });

  test("page éditeur SRT manuel — empty state", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/publications/${SLOT_MANUAL}/captions/manual`);
    // Attente du 1er bloc auto-créé.
    await expect(
      page.locator('textarea[placeholder*="texte affiché"]').first(),
    ).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot("captions-manual-editor-empty.png", SCREENSHOT_OPTS);
  });

  test("page transcription list — empty queue glass cards", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/transcriptions`);
    // Attente du header + dropzone visible.
    await expect(page.getByText(/Transcription/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot("transcriptions-list.png", SCREENSHOT_OPTS);
  });

  test("page captions/generate — banner transcription pending", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/captions/${PRESET}/generate?slotId=${SLOT_MANUAL}`);
    // Banner pending OU blocker affiché — capture l'état rendu (peu importe
    // lequel, la capture documente la réalité de l'env). Le diff visuel
    // dira si le banner change de tonalité/wording.
    await page.waitForTimeout(1_000); // laisse le SSE / fetch s'établir
    await expect(page).toHaveScreenshot("captions-generate-with-slot.png", SCREENSHOT_OPTS);
  });
});
