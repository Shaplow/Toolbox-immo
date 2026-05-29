/**
 * Prend un screenshot d'une page applicative en réutilisant le state
 * d'auth sauvé par `screenshot-login.ts`.
 *
 * Usage :
 *   cd web
 *   npx tsx scripts/screenshot.ts <chemin_url> <output.png> [viewport]
 *
 * Exemples :
 *   npx tsx scripts/screenshot.ts /home /tmp/home.png
 *   npx tsx scripts/screenshot.ts /publications/abc123 /tmp/fiche.png
 *   npx tsx scripts/screenshot.ts /calendar /tmp/cal.png 1440x900
 *
 * Si `.playwright-auth.json` n'existe pas, lance d'abord screenshot-login.
 */

import { chromium } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3000";
const AUTH_FILE = path.resolve(import.meta.dirname, "..", ".playwright-auth.json");

const [urlPath, outputPath, viewportArg] = process.argv.slice(2);

if (!urlPath || !outputPath) {
  console.error("Usage : npx tsx scripts/screenshot.ts <url_path> <output.png> [WxH]");
  process.exit(1);
}

if (!fs.existsSync(AUTH_FILE)) {
  console.error(`Auth state introuvable (${AUTH_FILE}).`);
  console.error("Lance d'abord : npx tsx scripts/screenshot-login.ts");
  process.exit(1);
}

const [vw, vh] = viewportArg
  ? viewportArg.split("x").map((v) => parseInt(v, 10))
  : [1440, 900];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: AUTH_FILE,
    viewport: { width: vw, height: vh },
    deviceScaleFactor: 2, // Retina-ish pour des screenshots nets
  });
  const page = await context.newPage();

  const fullUrl = `${BASE_URL}${urlPath.startsWith("/") ? urlPath : `/${urlPath}`}`;
  console.log(`Navigation vers ${fullUrl}`);
  await page.goto(fullUrl, { waitUntil: "networkidle" });

  // Petit délai pour laisser les transitions / hydration finir
  await page.waitForTimeout(800);

  const fullPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });

  await page.screenshot({ path: fullPath, fullPage: true });
  console.log(`Screenshot sauvé : ${fullPath}`);

  await browser.close();
}

main().catch((err) => {
  console.error("Erreur :", err);
  process.exit(1);
});
