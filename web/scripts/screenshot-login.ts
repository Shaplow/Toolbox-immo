/**
 * Script one-shot : ouvre un navigateur Chromium headed, tu te logges
 * manuellement sur localhost:3000, et le state d'auth est sauvé dans
 * `web/.playwright-auth.json`. Le script `screenshot.ts` réutilise ce
 * state pour les screenshots ultérieurs sans demander de relogin.
 *
 * Usage :
 *   cd web
 *   npm run dev        # dans un autre terminal
 *   npx tsx scripts/screenshot-login.ts
 *
 * Puis dans le browser qui s'ouvre :
 * 1. Login normalement sur /login
 * 2. Une fois sur la home/calendar, retourne dans le terminal et tape Enter
 * 3. Le state est sauvé.
 */

import { chromium } from "playwright";
import * as readline from "node:readline";
import * as path from "node:path";

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3000";
const AUTH_FILE = path.resolve(import.meta.dirname, "..", ".playwright-auth.json");

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`);

  console.log(`\nNavigateur ouvert sur ${BASE_URL}/login`);
  console.log("→ Connecte-toi normalement.");
  console.log("→ Une fois loggé (home/calendar visible), reviens ici et tape Entrée.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await new Promise<void>((resolve) => rl.question("Prêt ? Entrée pour sauver le state. ", () => {
    rl.close();
    resolve();
  }));

  await context.storageState({ path: AUTH_FILE });
  console.log(`\nState sauvé dans ${AUTH_FILE}`);
  console.log("Tu peux maintenant utiliser `npx tsx scripts/screenshot.ts <url> <output.png>`");

  await browser.close();
}

main().catch((err) => {
  console.error("Erreur :", err);
  process.exit(1);
});
