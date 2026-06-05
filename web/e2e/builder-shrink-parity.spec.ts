/**
 * W5.19 — Spec E2E de parité shrinkToFit entre Canvas builder et HTML preview.
 *
 * Fige le contrat post-W1 : la fontSize fittée doit converger à < 1px entre
 * les deux couches. Avant W1, Canvas utilisait getClientRects union mais
 * buildHTML utilisait scrollHeight/scrollWidth + ne reset pas maxLines —
 * deux algorithmes distincts qui pouvaient diverger silencieusement.
 *
 * Run :
 *   cd web
 *   npm run test:db:seed
 *   npm run test:e2e -- builder-shrink-parity
 *
 * Note : ce spec nécessite un template seedé avec un TextBlock configuré
 * pour shrinkToFit (rules.shrinkToFit=true + rules.minFontSize=12 +
 * rules.maxLines=3 + text long forçant overflow). Si le seed ne le fournit
 * pas, le test skip avec un message explicite.
 */

import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth";

test.describe("Parité shrinkToFit Canvas ↔ HTML preview (W5.19)", () => {
  test("la fontSize fittée converge à < 1px entre Canvas et buildHTML", async ({ page }) => {
    await loginAs(page, "admin");

    // Charge la liste des templates et ouvre celui avec un TextBlock shrinkToFit.
    // Le seed de test doit fournir un template "shrink-fixture" (voir
    // scripts/seed-test-db.ts si manquant). Sans ça on skip avec un message.
    await page.goto("/templates");
    const fixtureLink = page.locator('a[href*="/builder/"]').filter({ hasText: /shrink-fixture/i }).first();
    const hasFixture = await fixtureLink.count() > 0;
    test.skip(!hasFixture, "Template fixture 'shrink-fixture' absent du seed — voir scripts/seed-test-db.ts pour l'ajouter");

    // 1. Builder Canvas : mesure la fontSize fittée du bloc data-shrink-to-fit
    await fixtureLink.click();
    await page.waitForLoadState("networkidle");

    const canvasFontSize = await page.evaluate(() => {
      const block = document.querySelector('[data-shrink-to-fit="true"]') as HTMLElement | null;
      if (!block) return null;
      const content = block.querySelector(".block-text-content") as HTMLElement | null;
      if (!content) return null;
      return Number.parseFloat(window.getComputedStyle(content).fontSize);
    });
    expect(canvasFontSize, "Canvas fontSize doit être mesurable").not.toBeNull();

    // 2. HTML preview : charger /api/preview/[templateId] (le template ID est
    //    extractible de l'URL builder)
    const url = page.url();
    const templateIdMatch = url.match(/builder\/([^/]+)/);
    expect(templateIdMatch, "templateId extractible depuis l'URL builder").not.toBeNull();
    const templateId = templateIdMatch![1];

    await page.goto(`/api/preview/${templateId}`);
    await page.waitForLoadState("networkidle");
    // Le HTML preview attend que window.__templateReady passe à true (cf. buildHTML behaviorScript).
    await page.waitForFunction(() => (window as unknown as { __templateReady?: boolean }).__templateReady === true, { timeout: 10_000 });

    const previewFontSize = await page.evaluate(() => {
      const block = document.querySelector('[data-shrink-to-fit="true"]') as HTMLElement | null;
      if (!block) return null;
      const content = block.querySelector(".block-text-content") as HTMLElement | null;
      if (!content) return null;
      return Number.parseFloat(window.getComputedStyle(content).fontSize);
    });
    expect(previewFontSize, "Preview fontSize doit être mesurable").not.toBeNull();

    // 3. Assertion : les deux fontSizes doivent diverger de < 1px (les deux
    //    couches utilisent désormais getClientRects union + reset maxLines/
    //    webkitLineClamp avant mesure).
    const delta = Math.abs((canvasFontSize as number) - (previewFontSize as number));
    expect(delta, `Canvas (${canvasFontSize}px) et Preview (${previewFontSize}px) divergent — règles shrink Canvas/buildHTML désalignées`).toBeLessThan(1);
  });
});
