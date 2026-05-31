#!/usr/bin/env tsx
/**
 * Capture les surfaces UX clés de Toolbox Immo pour audit visuel.
 *
 * Deux modes coexistent :
 *
 *  1. SURFACES — pages isolées (snapshot d'état) → pour vérifier
 *     la qualité visuelle individuelle.
 *
 *  2. SCENARIOS — workflow user complet enchaînant goto/click/fill
 *     avec capture après chaque étape → pour vérifier la cohérence
 *     d'ensemble (transitions, breadcrumbs, langage, états).
 *
 * Output : `.claude/ux-audit/<YYYY-MM-DD_HH-mm>/`
 *  - `surfaces/<name>.png`
 *  - `scenarios/<scenario-name>/<NN>-<step-name>.png`
 *
 * Workflow :
 *   1. cd web && npm run test:db:setup && npm run test:db:seed
 *   2. npm run ux:capture
 *   3. Claude lit les PNG via le Read tool et rapporte.
 *
 * Tu peux aussi déclencher via /audit-ux dans le chat.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { execSync, spawn, type ChildProcess } from "child_process";
import { mkdirSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

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

const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
const OUTPUT_DIR = resolve(repoRoot, ".claude", "ux-audit", ts);

// ─── SURFACES isolées ───────────────────────────────────────────────────────
// Capture pure d'une page (snapshot d'état). Pour audit qualité visuelle.

interface Surface {
  name: string;
  path: string;
  wait?: number;
  desc: string;
}

const SURFACES: Surface[] = [
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

// ─── SCENARIOS (workflows multi-pages) ──────────────────────────────────────
// Enchaîne des étapes pour tester la cohérence d'un parcours user complet.

type StepAction =
  | { type: "goto"; path: string }
  | { type: "click"; selector: string }
  | { type: "fill"; selector: string; value: string }
  | { type: "wait"; ms: number };

interface Step {
  /** Préfixe du fichier output (numéroté pour l'ordre). */
  label: string;
  action: StepAction;
  /** Capture après cette étape (default true sauf actions de transition rapide). */
  capture?: boolean;
  /** Temps à attendre après l'action avant capture (ms). Default 400. */
  settleMs?: number;
}

interface Scenario {
  name: string;
  description: string;
  steps: Step[];
}

const SCENARIOS: Scenario[] = [
  {
    name: "captions-manual-workflow",
    description:
      "Admin écrit des sous-titres en mode manuel : fiche → éditeur → save → retour fiche. Vérifier cohérence des breadcrumbs, copy, états entre les 3 surfaces.",
    steps: [
      {
        label: "01-fiche-avant-ecriture",
        action: { type: "goto", path: "/publications/test-slot-v8-manual" },
        settleMs: 800,
      },
      {
        label: "02-clic-ecrire-sous-titres",
        action: {
          type: "click",
          selector: 'a:has-text("Écrire les sous-titres"), a:has-text("Modifier les sous-titres")',
        },
        settleMs: 800,
      },
      {
        label: "03-editeur-empty-state",
        action: { type: "wait", ms: 200 },
      },
      {
        label: "04-rempli-1er-bloc",
        action: {
          type: "fill",
          selector: 'textarea[placeholder*="texte affiché"]',
          value: "Premier sous-titre — workflow audit UX",
        },
        settleMs: 200,
      },
      {
        label: "05-clic-enregistrer",
        action: { type: "click", selector: 'button:has-text("Enregistrer")' },
        settleMs: 1500,
      },
      {
        label: "06-fiche-apres-save",
        action: { type: "wait", ms: 500 },
      },
    ],
  },
  {
    name: "captions-auto-from-fiche",
    description:
      "Admin lance les captions auto depuis la fiche : fiche slot auto → click 'Lancer captions' → atterrit sur /captions/.../generate avec banner transcription pending. Vérifier que la transition est claire et que le banner explique le pourquoi.",
    steps: [
      {
        label: "01-fiche-auto-template",
        action: { type: "goto", path: "/publications/test-slot-1" },
        settleMs: 800,
      },
      {
        label: "02-captions-generate-page",
        action: {
          type: "goto",
          path: "/captions/test-caption-preset-1/generate?slotId=test-slot-1",
        },
        settleMs: 1500,
      },
    ],
  },
  {
    name: "calendar-to-fiche",
    description:
      "Admin part du calendrier et ouvre une fiche : vérifier que la nav est fluide, que le slot card est lisible, que le retour est cohérent.",
    steps: [
      {
        label: "01-calendar-vue-hebdo",
        action: { type: "goto", path: "/calendar" },
        settleMs: 800,
      },
      {
        label: "02-fiche-depuis-calendar",
        action: { type: "goto", path: "/publications/test-slot-v8-manual" },
        settleMs: 800,
      },
    ],
  },
];

// ─── Login helper ────────────────────────────────────────────────────────────

async function login(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[name="username"], input[type="text"]', ADMIN_USERNAME);
  await page.fill('input[name="password"], input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/home/, { timeout: 10_000 });
  await page.close();
}

// ─── Capture helpers ─────────────────────────────────────────────────────────

async function captureSurface(
  context: BrowserContext,
  surface: Surface,
): Promise<string> {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE_URL}${surface.path}`);
  if (surface.wait) await page.waitForTimeout(surface.wait);
  const outPath = resolve(OUTPUT_DIR, "surfaces", `${surface.name}.png`);
  mkdirSync(dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath, fullPage: true, animations: "disabled" });
  await page.close();
  return outPath;
}

async function runStep(page: Page, step: Step): Promise<void> {
  const { action } = step;
  switch (action.type) {
    case "goto":
      await page.goto(`${BASE_URL}${action.path}`);
      break;
    case "click":
      await page.locator(action.selector).first().click({ timeout: 10_000 });
      break;
    case "fill":
      await page.locator(action.selector).first().fill(action.value);
      break;
    case "wait":
      await page.waitForTimeout(action.ms);
      break;
  }
  await page.waitForTimeout(step.settleMs ?? 400);
}

async function captureScenario(
  context: BrowserContext,
  scenario: Scenario,
): Promise<{ ok: number; failed: number }> {
  const dir = resolve(OUTPUT_DIR, "scenarios", scenario.name);
  mkdirSync(dir, { recursive: true });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  // Login déjà partagé via context cookies — pas besoin de re-login.

  let ok = 0;
  let failed = 0;
  for (const step of scenario.steps) {
    try {
      await runStep(page, step);
      if (step.capture !== false) {
        const outPath = resolve(dir, `${step.label}.png`);
        await page.screenshot({
          path: outPath,
          fullPage: true,
          animations: "disabled",
        });
      }
      ok++;
    } catch (err) {
      console.error(`    ✗ step ${step.label} : ${String(err).split("\n")[0]}`);
      failed++;
      // Continue le scenario même si une étape échoue — la capture suivante
      // documentera l'état réel (utile pour debug).
    }
  }
  await page.close();
  return { ok, failed };
}

// ─── Server lifecycle ────────────────────────────────────────────────────────

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
  const proc = spawn("next", ["dev", "-p", String(TEST_PORT)], {
    cwd: webDir,
    env: {
      ...process.env,
      DATABASE_URL: TEST_DB_URL,
      NEXTAUTH_URL: BASE_URL,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((res, rej) => {
    const timer = setTimeout(() => rej(new Error("server start timeout")), 60_000);
    const handler = (data: Buffer) => {
      const s = data.toString();
      if (s.includes("Ready") || s.includes("Local:")) {
        clearTimeout(timer);
        res();
      }
    };
    proc.stdout?.on("data", handler);
    proc.stderr?.on("data", handler);
  });
  await new Promise((r) => setTimeout(r, 1500));
  return proc;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function resetSlotState(): Promise<void> {
  // Purge les artefacts laissés par les runs précédents (E2E ou audits) sur
  // les slots de fixture. Sans ça, la ProductionChain affiche "Cover : Fait"
  // ou "Sous-titres : Fait" sur la base de jobs résiduels, faussant
  // l'analyse visuelle d'un état "fresh".
  const TEST_SLOTS = ["test-slot-v8-manual", "test-slot-1"];
  const prisma = new PrismaClient({
    datasources: { db: { url: TEST_DB_URL } },
  });
  try {
    for (const slotId of TEST_SLOTS) {
      await prisma.publicationSlot.update({
        where: { id: slotId },
        data: { activeCaptionJobId: null, activeCoverPackId: null },
      }).catch(() => {});
      await prisma.captionJob.deleteMany({ where: { slotId } });
      // CoverFramePacks : rattachés au render OU à la version courante.
      const slot = await prisma.publicationSlot.findUnique({
        where: { id: slotId },
        select: { currentVersionId: true, render: { select: { id: true } } },
      });
      if (slot?.render?.id) {
        await prisma.coverFramePack.deleteMany({ where: { renderId: slot.render.id } });
      }
      if (slot?.currentVersionId) {
        await prisma.coverFramePack.deleteMany({
          where: { publicationVersionId: slot.currentVersionId },
        });
      }
    }
    console.log(`  ↳ DB reset : caption + cover purgés pour ${TEST_SLOTS.length} slots`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  console.log(`▶ Audit UX — capture surfaces + scenarios`);
  console.log(`  Output : ${OUTPUT_DIR}`);
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Reset des artefacts résiduels sur les slots de test pour avoir une
  // capture reproductible (sinon les E2E précédents biaisent la chaîne).
  await resetSlotState();

  let ownsServer: ChildProcess | null = null;
  if (!(await isServerUp())) {
    ownsServer = await startServer();
  } else {
    console.log(`  ↳ Serveur déjà UP sur ${BASE_URL}, réutilisation.`);
  }

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    await login(context);

    // SURFACES
    console.log(`\n▶ Surfaces isolées (${SURFACES.length})`);
    let surfaceOk = 0;
    for (const surface of SURFACES) {
      try {
        await captureSurface(context, surface);
        console.log(`  ✓ ${surface.name}`);
        surfaceOk++;
      } catch (err) {
        console.error(`  ✗ ${surface.name} : ${String(err).split("\n")[0]}`);
      }
    }

    // SCENARIOS
    console.log(`\n▶ Scenarios (${SCENARIOS.length})`);
    let totalSteps = 0;
    let totalOk = 0;
    for (const scenario of SCENARIOS) {
      console.log(`  ▸ ${scenario.name} — ${scenario.steps.length} étapes`);
      const { ok, failed } = await captureScenario(context, scenario);
      totalSteps += ok + failed;
      totalOk += ok;
      console.log(`    ${ok}/${ok + failed} captures`);
    }

    console.log(`\n✅ Surfaces : ${surfaceOk}/${SURFACES.length}`);
    console.log(`✅ Scenarios : ${totalOk}/${totalSteps} étapes capturées`);
    console.log(`\n📁 ${OUTPUT_DIR}`);
    console.log(`\n   Demande à Claude :`);
    console.log(`     /audit-ux        # rapport classé surface par surface + scenario par scenario`);
    console.log(`     /audit-ux captions-manual-workflow   # focus sur 1 scenario`);
  } finally {
    if (browser) await browser.close();
    if (ownsServer) {
      ownsServer.kill();
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
