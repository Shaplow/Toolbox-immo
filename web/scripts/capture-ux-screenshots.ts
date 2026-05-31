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

// Flags CLI :
//   --headed   → lance Chromium visible (utile pour observer ce que le script fait)
//   --slow     → ralentit chaque action (~500ms) pour suivre à l'œil
//   --only=<X> → ne capture que les surfaces ou scenarios dont le nom matche
const HEADLESS = !process.argv.includes("--headed");
const SLOW_MO = process.argv.includes("--slow") ? 500 : 0;
const ONLY_FILTER = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

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
  | { type: "wait"; ms: number }
  /** Upload un fichier dans l'input[type=file] désigné (la dropzone l'a en hidden). */
  | { type: "upload"; selector: string; filePath: string }
  /** POST direct sur une route API (avec session cookie courante). */
  | { type: "api"; method: "POST" | "PATCH"; path: string; body?: unknown };

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

// Chemin vers les fixtures vidéo réutilisées par le workflow complet.
const FIXTURE_RUSH = resolve(webDir, "e2e/fixtures/test-rush.mp4");
const FIXTURE_VERSION = resolve(webDir, "e2e/fixtures/test-version.mp4");

const SCENARIOS: Scenario[] = [
  {
    name: "full-manual-workflow",
    description:
      "Workflow user complet sur un slot manual_rushes (status reset à PLANNED par resetSlotState) : upload rush → upload version → promote → captions manuel → description manuelle → cover → marquer publié. Tente chaque étape réellement. Si une étape pète, l'audit révèle le vrai point de blocage du workflow.",
    steps: [
      {
        label: "01-fiche-initial-vide",
        action: { type: "goto", path: "/publications/test-slot-v8-manual" },
        settleMs: 800,
      },
      // ── Étape 1 : Upload du rush ─────────────────────────────────────────
      {
        label: "02-upload-rush",
        action: {
          type: "upload",
          selector: 'input[type="file"]',
          filePath: FIXTURE_RUSH,
        },
        settleMs: 4000,
      },
      {
        label: "03-apres-upload-rush",
        action: { type: "wait", ms: 800 },
      },
      // ── Étape 2 : Captions manuel ────────────────────────────────────────
      // Note : l'upload de version est skip — le reset recrée déjà la version
      // par défaut + promote (équivalent au seed). Ajouter un vrai scenario
      // "upload-version" demandera de cibler le bon input file dans la
      // VersionsSection (pas trivial vu que la dropzone rushes vole le 1er
      // input). À traiter dans un scenario séparé si besoin.
      {
        label: "04-fiche-apres-rush",
        action: { type: "goto", path: "/publications/test-slot-v8-manual" },
        settleMs: 800,
      },
      {
        label: "05-click-ecrire-sous-titres",
        action: {
          type: "click",
          selector: 'a:has-text("Écrire les sous-titres")',
        },
        settleMs: 800,
      },
      {
        label: "06-fill-caption-block",
        action: {
          type: "fill",
          selector: 'textarea[placeholder*="texte affiché"]',
          value: "Bienvenue dans cet appartement",
        },
        settleMs: 200,
      },
      {
        label: "07-save-captions",
        action: { type: "click", selector: 'button:has-text("Enregistrer")' },
        settleMs: 1500,
      },
      // ── Étape 3 : Description manuelle ───────────────────────────────────
      {
        label: "08-fiche-apres-captions",
        action: { type: "goto", path: "/publications/test-slot-v8-manual" },
        settleMs: 800,
      },
      {
        label: "09-fill-description",
        action: {
          type: "fill",
          selector: 'textarea[placeholder*="légende"], textarea[placeholder*="Rédigez"]',
          value: "Magnifique appartement parisien, 50m² rénové, lumineux, proche métro.",
        },
        settleMs: 300,
      },
      {
        label: "10-save-description",
        action: {
          type: "click",
          selector: 'button:has-text("Enregistrer la légende"), button:has-text("Enregistrer")',
        },
        settleMs: 1000,
      },
      // ── Étape 4 : Cover (via API pour skip l'extraction RunPod) ──────────
      {
        label: "11-api-cover-select",
        action: {
          type: "api",
          method: "POST",
          path: "/api/publications/test-slot-v8-manual/cover/manual-select",
          body: {
            frameUrl: "https://example.com/cover-test-full-workflow.png",
            timestamp: 2.5,
          },
        },
        settleMs: 500,
      },
      {
        label: "12-fiche-avant-publication",
        action: { type: "goto", path: "/publications/test-slot-v8-manual" },
        settleMs: 800,
      },
      // ── Étape 5 : Coller URL Instagram + Marquer publié ──────────────────
      {
        label: "13-fill-instagram-url",
        action: {
          type: "fill",
          selector: 'input[placeholder*="instagram.com"], input[name="publishedUrl"]',
          value: "https://www.instagram.com/p/test-e2e-full-workflow/",
        },
        settleMs: 300,
      },
      {
        label: "14-click-marquer-publie",
        action: {
          type: "click",
          selector: 'button:has-text("Marquer publié"):not(:disabled)',
        },
        settleMs: 2000,
      },
    ],
  },
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
    case "upload":
      await page.locator(action.selector).first().setInputFiles(action.filePath);
      break;
    case "api": {
      const res = await page.request.fetch(`${BASE_URL}${action.path}`, {
        method: action.method,
        data: action.body as object | undefined,
      });
      if (!res.ok()) {
        throw new Error(
          `API ${action.method} ${action.path} → ${res.status()} ${await res.text().catch(() => "")}`,
        );
      }
      break;
    }
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
  // Reset complet des slots de fixture pour qu'un audit visuel parte d'un
  // état initial reproductible. Sans ça, les jobs résiduels (E2E précédents,
  // audits précédents, version déjà promue par le seed, etc.) faussent la
  // ProductionChain et empêchent de simuler un workflow user "from scratch".
  const TEST_SLOTS = ["test-slot-v8-manual", "test-slot-1"];
  const prisma = new PrismaClient({
    datasources: { db: { url: TEST_DB_URL } },
  });
  try {
    for (const slotId of TEST_SLOTS) {
      // 1. Détache tous les pointeurs "active*" + revient à PLANNED + dé-promote
      //    la version. Conserve `description` à `null` pour repartir vide.
      //    Pas de .catch() — on veut savoir si l'update échoue (un field mort
      //    silencerait tout le reset, masquant les bugs des audits).
      await prisma.publicationSlot.update({
        where: { id: slotId },
        data: {
          activeCaptionJobId: null,
          activeCoverPackId: null,
          activeTranscriptionJobId: null,
          currentVersionId: null,
          status: "PLANNED",
          description: null,
          publishedAt: null,
          publishedUrl: null,
        },
      });

      // 2. Delete les jobs liés au slot.
      await prisma.captionJob.deleteMany({ where: { slotId } });
      await prisma.transcriptionJob.deleteMany({ where: { slotId } });
      await prisma.descriptionJob.deleteMany({ where: { slotId } });

      // 3. Delete les cover packs liés (via render ou version).
      const slot = await prisma.publicationSlot.findUnique({
        where: { id: slotId },
        select: { render: { select: { id: true } } },
      });
      if (slot?.render?.id) {
        await prisma.coverFramePack.deleteMany({ where: { renderId: slot.render.id } });
      }
      // Toutes les versions du slot (cleanup propre)
      const versions = await prisma.publicationVersion.findMany({
        where: { slotId },
        select: { id: true },
      });
      for (const v of versions) {
        await prisma.coverFramePack.deleteMany({ where: { publicationVersionId: v.id } });
      }

      // 4. Delete les rushs + versions uploadées (pour repartir vraiment vide).
      await prisma.publicationRush.deleteMany({ where: { slotId } });
      await prisma.publicationVersion.deleteMany({ where: { slotId } });

      // 5. Pour le slot V8 manual : recrée la version par défaut + promote.
      //    Permet aux scenarios qui vont jusqu'à cover/publier de fonctionner
      //    sans devoir uploader une version (l'upload via setInputFiles cible
      //    mal entre la dropzone rushes et la section versions). Si tu veux
      //    tester l'upload de version dans un futur scenario, ne pas appeler
      //    cette branche.
      if (slotId === "test-slot-v8-manual") {
        const monteur = await prisma.user.findUnique({
          where: { email: "monteur@test.local" },
          select: { id: true },
        });
        if (monteur) {
          const version = await prisma.publicationVersion.create({
            data: {
              slotId,
              versionNumber: 1,
              r2Key: `publications/${slotId}/versions/1.mp4`,
              fileUrl: "https://example.com/test-version.mp4",
              fileName: "test-version.mp4",
              mimeType: "video/mp4",
              uploadedByUserId: monteur.id,
            },
          });
          await prisma.publicationSlot.update({
            where: { id: slotId },
            data: { currentVersionId: version.id, status: "EDIT_APPROVED" },
          });
        }
      }
    }
    console.log(`  ↳ DB reset : ${TEST_SLOTS.length} slots — état initial restauré`);
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
    browser = await chromium.launch({ headless: HEADLESS, slowMo: SLOW_MO });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    await login(context);

    const matchesFilter = (name: string) =>
      !ONLY_FILTER || name.includes(ONLY_FILTER);

    // SURFACES
    const surfacesToRun = SURFACES.filter((s) => matchesFilter(s.name));
    console.log(`\n▶ Surfaces isolées (${surfacesToRun.length}/${SURFACES.length})`);
    let surfaceOk = 0;
    for (const surface of surfacesToRun) {
      try {
        await captureSurface(context, surface);
        console.log(`  ✓ ${surface.name}`);
        surfaceOk++;
      } catch (err) {
        console.error(`  ✗ ${surface.name} : ${String(err).split("\n")[0]}`);
      }
    }

    // SCENARIOS
    const scenariosToRun = SCENARIOS.filter((s) => matchesFilter(s.name));
    console.log(`\n▶ Scenarios (${scenariosToRun.length}/${SCENARIOS.length})`);
    let totalSteps = 0;
    let totalOk = 0;
    for (const scenario of scenariosToRun) {
      console.log(`  ▸ ${scenario.name} — ${scenario.steps.length} étapes`);
      const { ok, failed } = await captureScenario(context, scenario);
      totalSteps += ok + failed;
      totalOk += ok;
      console.log(`    ${ok}/${ok + failed} captures`);
    }

    console.log(`\n✅ Surfaces : ${surfaceOk}/${surfacesToRun.length}`);
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
