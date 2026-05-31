#!/usr/bin/env tsx
/**
 * Capture les surfaces UX clés de Toolbox Immo pour audit visuel.
 *
 * Différent du spec visual regression (`production-chain-v8-visual.spec.ts`) :
 *  - Pas de baseline ni diff — capture pure pour analyse one-shot
 *  - Output timestampé dans `.claude/ux-audit/<YYYY-MM-DD_HH-mm>/<page>.png`
 *  - Liste de surfaces extensible (édite SURFACES ci-dessous)
 *
 * Workflow :
 *   1. Assure-toi que la DB de test est seedée :
 *      cd web && npm run test:db:setup && npm run test:db:seed
 *   2. Lance le serveur de test (port 3100) en arrière-plan OU laisse le
 *      script le démarrer lui-même.
 *   3. Lance :
 *      cd web && npm run ux:capture
 *   4. Les screenshots sortent dans .claude/ux-audit/<timestamp>/
 *   5. Demande à Claude d'analyser les images.
 *
 * Usage en mode "audit" :
 *   /audit-ux            # déclenche le workflow complet
 */

import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { execSync, spawn, type ChildProcess } from "child_process";
import { mkdirSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { config as loadEnv } from "dotenv";

const scriptDir = dirname(new URL(import.meta.url).pathname);
const webDir = resolve(scriptDir, "..");
const repoRoot = resolve(webDir, "..");
const envFile = existsSync(resolve(webDir, ".env.test"))
  ? resolve(webDir, ".env.test")
  : resolve(webDir, ".env.local");
loadEnv({ path: envFile, override: true });

const TEST_PORT = 3100;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://toolbox:toolbox@localhost:5433/toolbox_test";

const ADMIN_USERNAME = "test_admin";
const ADMIN_PASSWORD = "testpass";

// Output : .claude/ux-audit/<timestamp>/<surface>.png
const ts = new Date()
  .toISOString()
  .replace(/[:T]/g, "-")
  .slice(0, 16);
const OUTPUT_DIR = resolve(repoRoot, ".claude", "ux-audit", ts);

// ─── Surfaces à capturer ────────────────────────────────────────────────────
// Édite cette liste pour étendre l'audit à d'autres pages.

interface Surface {
  name: string;
  path: string;
  /** Optional setup fn called before capture (login déjà fait, page navigated). */
  wait?: number; // ms à attendre après navigation
  desc: string;
}

const SURFACES: Surface[] = [
  // V8 — chaîne de production (mode manual)
  {
    name: "01-fiche-publication-manual",
    path: "/publications/test-slot-v8-manual",
    wait: 800,
    desc: "Fiche publication complète : ProductionChain + sections par rôle",
  },
  {
    name: "02-captions-manual-editor",
    path: "/publications/test-slot-v8-manual/captions/manual",
    wait: 500,
    desc: "Éditeur SRT manuel — empty state (1 bloc auto)",
  },
  {
    name: "03-transcriptions-list",
    path: "/transcriptions",
    wait: 500,
    desc: "Liste des transcriptions — empty queue",
  },
  {
    name: "04-captions-generate-with-slot",
    path: "/captions/test-caption-preset-1/generate?slotId=test-slot-v8-manual",
    wait: 1500,
    desc: "Page generate avec banner transcription (pending OU blocker)",
  },
  // Surfaces parents — pour vérifier la cohérence globale
  {
    name: "05-home-admin",
    path: "/home",
    wait: 500,
    desc: "HomeAdmin dashboard",
  },
  {
    name: "06-calendar",
    path: "/calendar",
    wait: 800,
    desc: "Vue calendrier hebdo des slots",
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

async function login(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[name="username"], input[type="text"]', ADMIN_USERNAME);
  await page.fill('input[name="password"], input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/home/, { timeout: 10_000 });
  await page.close();
}

async function captureSurface(
  context: BrowserContext,
  surface: Surface,
): Promise<string> {
  const page = await context.newPage();
  // Viewport fixe pour reproductibilité (mêmes dimensions que le spec regression).
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE_URL}${surface.path}`);
  if (surface.wait) await page.waitForTimeout(surface.wait);
  const outPath = resolve(OUTPUT_DIR, `${surface.name}.png`);
  await page.screenshot({
    path: outPath,
    fullPage: true,
    animations: "disabled",
  });
  await page.close();
  return outPath;
}

async function isServerUp(): Promise<boolean> {
  try {
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(2_000) });
    return res.status > 0;
  } catch {
    return false;
  }
}

async function startServer(): Promise<ChildProcess> {
  console.log(`▶ Démarre next dev sur le port ${TEST_PORT}…`);
  const proc = spawn(
    "next",
    ["dev", "-p", String(TEST_PORT)],
    {
      cwd: webDir,
      env: {
        ...process.env,
        DATABASE_URL: TEST_DB_URL,
        NEXTAUTH_URL: BASE_URL,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  // Attente de "Ready in" dans les logs
  await new Promise<void>((res, rej) => {
    const timer = setTimeout(() => rej(new Error("server start timeout")), 60_000);
    proc.stdout?.on("data", (data: Buffer) => {
      const s = data.toString();
      if (s.includes("Ready") || s.includes("Local:")) {
        clearTimeout(timer);
        res();
      }
    });
    proc.stderr?.on("data", (data: Buffer) => {
      // Next écrit ses logs sur stderr aussi
      const s = data.toString();
      if (s.includes("Ready") || s.includes("Local:")) {
        clearTimeout(timer);
        res();
      }
    });
  });
  // Petite latence pour que les routes soient prêtes
  await new Promise((r) => setTimeout(r, 1500));
  return proc;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`▶ Audit UX — capture des surfaces clés`);
  console.log(`  Output : ${OUTPUT_DIR}`);
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // 1. Démarre le serveur si pas déjà up
  let ownsServer: ChildProcess | null = null;
  if (!(await isServerUp())) {
    ownsServer = await startServer();
  } else {
    console.log(`  ↳ Serveur déjà UP sur ${BASE_URL}, réutilisation.`);
  }

  // 2. Lance Chromium + login admin
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    await login(context);

    // 3. Capture chaque surface
    let n = 0;
    for (const surface of SURFACES) {
      try {
        const out = await captureSurface(context, surface);
        n++;
        console.log(`  ✓ ${surface.name} → ${out}`);
      } catch (err) {
        console.error(`  ✗ ${surface.name} : ${String(err)}`);
      }
    }

    console.log(`\n✅ ${n}/${SURFACES.length} captures dans ${OUTPUT_DIR}`);
    console.log(`\n   Demande à Claude :`);
    console.log(`     "Audit visuel des screenshots dans ${OUTPUT_DIR}"`);

    // Liste les fichiers pour copier-coller facile
    console.log(`\n   Fichiers :`);
    for (const surface of SURFACES) {
      console.log(`     - ${OUTPUT_DIR}/${surface.name}.png — ${surface.desc}`);
    }
  } finally {
    if (browser) await browser.close();
    if (ownsServer) {
      ownsServer.kill();
      // Évite "child process didn't exit"
      execSync(`lsof -ti:${TEST_PORT} | xargs kill -9 2>/dev/null || true`, {
        stdio: "ignore",
      });
    }
  }
}

main().catch((err) => {
  console.error("❌ Capture UX échouée :", err);
  process.exit(1);
});
