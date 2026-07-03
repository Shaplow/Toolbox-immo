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
  // ── Nouvelles surfaces 2026-06-04 (Phase 5 + length validation + validate fix) ──
  {
    name: "07-admin-cursors-empty",
    path: "/admin/cursors",
    wait: 800,
    desc: "Page /admin/cursors (Phase 5) — selector lib vide, état initial",
  },
  {
    name: "08-admin-libraries-hub",
    path: "/admin/libraries",
    wait: 600,
    desc: "Hub Ressources — entrée centrale Media / Data / Fonts / Prompts",
  },
  {
    name: "09-admin-libraries-data",
    path: "/admin/libraries/data",
    wait: 800,
    desc: "Liste DataLibrary — vérifier bulk-edit access disponible sur une lib",
  },
  {
    name: "10-validate-token-invalid",
    path: "/validate/invalid-token-test-12345",
    wait: 600,
    desc: "Page validation client avec token invalide — vérifier not-found dédié (commit 11f5866)",
  },
  {
    name: "11-missions-new",
    path: "/missions/new",
    wait: 800,
    desc: "Création de mission — recette (catalogue global) + compte optionnel + champs perso",
  },
  {
    name: "12-biens-list",
    path: "/biens",
    wait: 700,
    desc: "Liste des biens (fiches de données partagées) — recherche + création",
  },
  {
    name: "13-bien-editor",
    path: "/biens/ux-bien-demo",
    wait: 700,
    desc: "Éditeur d'un bien — label + champs partagés + Lancer des missions",
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
  // ── V8.13 — Scenarios admin critiques ────────────────────────────────────
  {
    name: "medialib-admin-tour",
    description:
      "Admin parcourt la médiathèque : hub Ressources → liste libraries → détail vidéo → toggle vues grid / grouped / rotation (simulation). Vérifier que chaque vue est lisible, que les usages s'affichent, et que la rotation simule correctement.",
    steps: [
      {
        label: "01-hub-ressources",
        action: { type: "goto", path: "/admin/libraries" },
        settleMs: 600,
      },
      {
        label: "02-liste-libraries-video",
        action: { type: "goto", path: "/admin/libraries/media" },
        settleMs: 600,
      },
      {
        label: "03-detail-library-vue-grouped-default",
        action: { type: "goto", path: "/admin/libraries/media/test-media-lib-video" },
        settleMs: 800,
      },
      {
        label: "04-toggle-avance",
        action: {
          type: "click",
          selector: '[data-testid="medialib-advanced-toggle"]',
        },
        settleMs: 500,
      },
      {
        label: "05-vue-grid",
        action: {
          type: "click",
          selector: '[data-testid="medialib-view-grid"]',
        },
        settleMs: 500,
      },
      {
        label: "06-vue-rotation",
        action: {
          type: "click",
          selector: '[data-testid="medialib-view-rotation"]',
        },
        settleMs: 800,
      },
    ],
  },
  {
    name: "account-pattern-edit-all",
    description:
      "Admin édite tous les settings d'un pattern : ouverture drawer + parcours des onglets Identité / Production / Workflow / Équipe. Vérifier que chaque onglet est rendu, validation cross-field affichée, save fonctionne.",
    steps: [
      {
        label: "01-liste-comptes-instagram",
        action: { type: "goto", path: "/admin/accounts" },
        settleMs: 600,
      },
      {
        label: "02-fiche-compte",
        action: {
          type: "click",
          // Lien "Voir les patterns" sur la card du compte (1er lien
          // /admin/accounts/<id> qui n'est pas la racine).
          selector: 'a[href*="/admin/accounts/"]:not([href$="/admin/accounts"])',
        },
        settleMs: 800,
      },
      {
        label: "03-ouvrir-pattern-edit",
        action: {
          type: "click",
          selector: '[data-testid="pattern-edit-button"]',
        },
        settleMs: 700,
      },
      {
        label: "04-drawer-onglet-identite",
        action: { type: "wait", ms: 300 },
      },
      {
        label: "05-drawer-onglet-production",
        action: {
          type: "click",
          selector: '[role="tab"]:has-text("Production")',
        },
        settleMs: 400,
      },
      {
        label: "06-drawer-onglet-workflow",
        action: {
          type: "click",
          selector: '[role="tab"]:has-text("Workflow")',
        },
        settleMs: 400,
      },
      {
        label: "07-drawer-onglet-equipe",
        action: {
          type: "click",
          selector: '[role="tab"]:has-text("Équipe")',
        },
        settleMs: 400,
      },
    ],
  },
  {
    name: "data-library-admin",
    description:
      "Admin parcourt et gère une DataLibrary : hub → liste data libraries → détail spreadsheet inline → ajout d'une entry. Vérifier que les champs s'affichent, l'édition fonctionne, persistance OK.",
    steps: [
      {
        label: "01-hub-ressources",
        action: { type: "goto", path: "/admin/libraries" },
        settleMs: 500,
      },
      {
        label: "02-liste-data-libraries",
        action: { type: "goto", path: "/admin/libraries/data" },
        settleMs: 600,
      },
      {
        label: "03-detail-data-library",
        action: { type: "goto", path: "/admin/libraries/data/test-data-lib" },
        settleMs: 2200,
      },
    ],
  },
  // Scenario rotation-simulation retiré (V8.14) : la vue Rotation est déjà
  // capturée par medialib-admin-tour step 06, et useAdvancedMode persiste
  // dans localStorage entre scenarios — relancer le toggle ici inversait
  // l'état au lieu de le garantir activé.
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

      // 5. Recrée une version par défaut + promote sur les 2 slots de test.
      //    Permet aux scenarios qui vont jusqu'à cover/publier OU qui veulent
      //    tester l'auto-launch transcription d'avoir une cible vidéo réelle
      //    (fileUrl pointant vers une vraie URL locale fetchable).
      const monteur = await prisma.user.findUnique({
        where: { email: "monteur@test.local" },
        select: { id: true },
      });
      if (monteur) {
        // V8 manual : status = EDIT_APPROVED (version validée prête à publier)
        // test-slot-1 (auto_template + captions auto) : status = EDIT_APPROVED
        //   → triggerAutoTranscriptionForVersion peut lancer le pipeline auto.
        const fileUrl =
          slotId === "test-slot-v8-manual"
            ? "https://example.com/test-version.mp4"
            // Pour test-slot-1, on pointe vers le fixture local servi par
            // Next.js (accessible depuis le helper transcribe local).
            : `${BASE_URL}/test-fixtures/sample-audio.mp3`;
        const version = await prisma.publicationVersion.create({
          data: {
            slotId,
            versionNumber: 1,
            r2Key: `publications/${slotId}/versions/1.mp4`,
            fileUrl,
            fileName:
              slotId === "test-slot-v8-manual" ? "test-version.mp4" : "sample.mp3",
            mimeType: slotId === "test-slot-v8-manual" ? "video/mp4" : "audio/mpeg",
            uploadedByUserId: monteur.id,
          },
        });
        await prisma.publicationSlot.update({
          where: { id: slotId },
          data: { currentVersionId: version.id, status: "EDIT_APPROVED" },
        });
      }
    }
    console.log(`  ↳ DB reset : ${TEST_SLOTS.length} slots — état initial restauré`);
  } finally {
    await prisma.$disconnect();
  }
}

// ─── Patterns canoniques (fixtures pour audit visuel) ───────────────────────
// Alignés sur `pattern-coherence.test.ts`. Pour chaque pattern, on seed un
// slot dans un état "représentatif" qui montre la spécificité du pattern.

interface PatternFixture {
  /** Slug pour l'URL slot + nom du PNG output. */
  slug: string;
  /** Texte court qui sert de titre slot + description du PNG. */
  label: string;
  /** Config du pattern à seeder. */
  patternData: {
    source: "auto_template" | "manual_rushes" | "external_upload";
    coverMode: "none" | "manualSelect" | "autoPack" | "monteurUpload";
    needsCaptions?: boolean;
    needsCaptionsMode?: "none" | "auto" | "manual";
    needsDescription: "none" | "preFilled" | "autoGenerate" | "manualWrite";
    needsClientValidation?: boolean;
    allowsClientRevision?: boolean;
    needsAdminValidation?: boolean;
    needsRushes?: boolean;
    needsBrief?: boolean;
  };
  /** État slot à reproduire. */
  slot: {
    status: string;
    description?: string | null;
    /** Crée + promote une PublicationVersion (équivalent V1 livrée). */
    withVersion?: boolean;
    /** Nombre de PublicationRush uploadés. */
    rushesCount?: number;
    /** Si défini : crée un CaptionJob du statut donné, promu si COMPLETED. */
    captionJobStatus?: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
    /** Si défini : crée un CoverFramePack du statut donné, promu si SELECTED. */
    coverPackStatus?: "QUEUED" | "PROCESSING" | "READY" | "SELECTED" | "FAILED";
  };
}

const PATTERN_FIXTURES: PatternFixture[] = [
  {
    slug: "p01-auto-fluide",
    label: "P1 — auto_template fluide (captions+desc+cover auto)",
    patternData: {
      source: "auto_template",
      coverMode: "autoPack",
      needsCaptionsMode: "auto",
      needsCaptions: true,
      needsDescription: "autoGenerate",
    },
    slot: { status: "PLANNED" },
  },
  {
    slug: "p02-auto-validation-pingpong",
    label: "P2 — auto + validation client + ping-pong",
    patternData: {
      source: "auto_template",
      coverMode: "autoPack",
      needsCaptionsMode: "auto",
      needsCaptions: true,
      needsDescription: "autoGenerate",
      needsClientValidation: true,
      allowsClientRevision: true,
    },
    slot: { status: "AWAITING_CLIENT", withVersion: true, captionJobStatus: "COMPLETED", coverPackStatus: "SELECTED" },
  },
  {
    slug: "p03-auto-minimal",
    label: "P3 — auto minimal (juste le render)",
    patternData: {
      source: "auto_template",
      coverMode: "none",
      needsCaptionsMode: "none",
      needsDescription: "none",
    },
    slot: { status: "PLANNED" },
  },
  {
    slug: "p04-manual-classique",
    label: "P4 — manual_rushes classique (full pipeline)",
    patternData: {
      source: "manual_rushes",
      coverMode: "autoPack",
      needsCaptionsMode: "auto",
      needsCaptions: true,
      needsDescription: "autoGenerate",
      needsRushes: true,
      needsBrief: true,
    },
    slot: { status: "RUSHES_RECEIVED", rushesCount: 2 },
  },
  {
    slug: "p05-manual-tout-manuel",
    label: "P5 — manual tout-manuel (captions+desc+cover à la main)",
    patternData: {
      source: "manual_rushes",
      coverMode: "manualSelect",
      needsCaptionsMode: "manual",
      needsDescription: "manualWrite",
      needsRushes: true,
    },
    slot: { status: "EDIT_APPROVED", withVersion: true, rushesCount: 1 },
  },
  {
    slug: "p06-cover-monteur",
    label: "P6 — manual_rushes + cover monteur upload",
    patternData: {
      source: "manual_rushes",
      coverMode: "monteurUpload",
      needsCaptionsMode: "auto",
      needsCaptions: true,
      needsDescription: "manualWrite",
      needsRushes: true,
    },
    slot: { status: "RUSHES_RECEIVED", rushesCount: 1 },
  },
  {
    slug: "p07-validation-admin",
    label: "P7 — manual + validation admin avant client",
    patternData: {
      source: "manual_rushes",
      coverMode: "autoPack",
      needsCaptionsMode: "auto",
      needsCaptions: true,
      needsDescription: "autoGenerate",
      needsAdminValidation: true,
      needsClientValidation: true,
      needsRushes: true,
    },
    slot: { status: "EDIT_REVIEW", rushesCount: 1, captionJobStatus: "COMPLETED" },
  },
  {
    slug: "p08-pingpong-revision",
    label: "P8 — ping-pong validation client (CLIENT_REVISION)",
    patternData: {
      source: "manual_rushes",
      coverMode: "autoPack",
      needsCaptionsMode: "auto",
      needsCaptions: true,
      needsDescription: "autoGenerate",
      needsClientValidation: true,
      allowsClientRevision: true,
      needsRushes: true,
    },
    slot: {
      status: "CLIENT_REVISION",
      description: "Texte légende validé V1",
      withVersion: true,
      rushesCount: 1,
      captionJobStatus: "COMPLETED",
      coverPackStatus: "SELECTED",
    },
  },
  {
    slug: "p09-manual-sans-rushes",
    label: "P9 — manual_rushes sans phase shoot (livraison directe)",
    patternData: {
      source: "manual_rushes",
      coverMode: "manualSelect",
      needsCaptionsMode: "manual",
      needsDescription: "manualWrite",
      needsRushes: false,
    },
    slot: { status: "EDIT_APPROVED", withVersion: true },
  },
  {
    slug: "p10-external-upload",
    label: "P10 — external_upload (le client uploade)",
    patternData: {
      source: "external_upload",
      coverMode: "manualSelect",
      needsCaptionsMode: "none",
      needsDescription: "manualWrite",
    },
    slot: { status: "PLANNED", withVersion: true },
  },
];

/**
 * Seed des fixtures pour les scenarios admin (médiathèque, rotation, etc.).
 * Idempotent. Appelé après resetSlotState.
 */
async function seedAdminFixtures(): Promise<void> {
  const prisma = new PrismaClient({
    datasources: { db: { url: TEST_DB_URL } },
  });
  try {
    // Récupère les fixtures du seed de base.
    const [admin, account, secondAccount] = await Promise.all([
      prisma.user.findUnique({ where: { email: "admin@test.local" } }),
      prisma.instagramAccount.findFirst({ where: { handle: "test_account" } }),
      // 2e compte pour montrer l'isolation rotation per_account.
      prisma.instagramAccount.upsert({
        where: { handle: "test_account_2" },
        update: {},
        create: {
          name: "Test Account 2 (rotation isolation)",
          handle: "test_account_2",
          client: { connect: { id: "test-client-1" } },
        },
      }),
    ]);
    if (!admin || !account) {
      throw new Error("Fixtures de base manquantes — npm run test:db:seed d'abord.");
    }

    // ── Library vidéo enrichie : ajouter quelques MediaAssetUsage pour
    //    montrer la simulation de rotation (per_account isolation).
    // Le seed standard crée déjà test-media-asset-video-0/1/2.
    // On simule des usages sur le compte principal pour 2 assets sur 3.
    await prisma.mediaAssetUsage.upsert({
      where: {
        assetId_accountId: {
          assetId: "test-media-asset-video-0",
          accountId: account.id,
        },
      },
      update: { usageCount: 2, lastUsedAt: new Date() },
      create: {
        assetId: "test-media-asset-video-0",
        accountId: account.id,
        usageCount: 2,
        lastUsedAt: new Date(),
      },
    });
    await prisma.mediaAssetUsage.upsert({
      where: {
        assetId_accountId: {
          assetId: "test-media-asset-video-1",
          accountId: account.id,
        },
      },
      update: { usageCount: 1, lastUsedAt: new Date(Date.now() - 86400000) },
      create: {
        assetId: "test-media-asset-video-1",
        accountId: account.id,
        usageCount: 1,
        lastUsedAt: new Date(Date.now() - 86400000),
      },
    });
    // 2e compte n'a aucun usage → isolation visible

    // ── DataLibrary fixture pour scenario data-library-admin
    await prisma.dataLibrary.upsert({
      where: { id: "test-data-lib" },
      update: {},
      create: {
        id: "test-data-lib",
        name: "Test Data Library (E2E)",
        templateType: "RPI",
        description: "Quartiers parisiens — prix au m²",
        rotationMode: "auto",
        rotationScope: "shared",
        fieldsSchema: JSON.stringify([
          { key: "quartier", label: "Quartier", type: "text" },
          { key: "prix_m2", label: "Prix/m²", type: "text" },
        ]),
      },
    });
    // 1 campagne active + 3 DataEntry liés
    const campaign = await prisma.dataCampaign.upsert({
      where: { id: "test-data-campaign" },
      update: {},
      create: {
        id: "test-data-campaign",
        libraryId: "test-data-lib",
        name: "RPI 2026 (E2E)",
        isActive: true,
      },
    });
    for (const [i, spec] of [
      { quartier: "Marais", prix: "12 500 €" },
      { quartier: "Belleville", prix: "8 900 €" },
      { quartier: "Montparnasse", prix: "11 200 €" },
    ].entries()) {
      await prisma.dataEntry.upsert({
        where: { id: `test-data-entry-${i}` },
        update: {},
        create: {
          id: `test-data-entry-${i}`,
          campaignId: campaign.id,
          fields: JSON.stringify({
            quartier: spec.quartier,
            prix_m2: spec.prix,
          }),
          usageCount: i, // varier pour visuel rotation
        },
      });
    }
    // Access fixtures pour audit visuel colonne Accès :
    //  - Marais : restreint au compte principal (1 avatar)
    //  - Belleville : restreint au compte principal + 2e compte (2 avatars)
    //  - Montparnasse : global (no DataEntryAccess row → icône globe)
    await prisma.dataEntryAccess.deleteMany({
      where: { entryId: { in: ["test-data-entry-0", "test-data-entry-1"] } },
    });
    await prisma.dataEntryAccess.createMany({
      data: [
        { entryId: "test-data-entry-0", accountId: account.id },
        { entryId: "test-data-entry-1", accountId: account.id },
        { entryId: "test-data-entry-1", accountId: secondAccount.id },
      ],
      skipDuplicates: true,
    });
    console.log(`  ↳ Admin fixtures : medialib usages + data lib seedés (+ 2e compte ${secondAccount.id.slice(0, 8)}…)`);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Seed les 10 patterns canoniques + leurs slots. Idempotent (upsert).
 * Appelé après resetSlotState pour avoir les fixtures fraîches.
 */
async function seedPatternFixtures(): Promise<void> {
  const prisma = new PrismaClient({
    datasources: { db: { url: TEST_DB_URL } },
  });
  try {
    // Trouve les users de test (réutilisés comme actors).
    const [admin, monteur, videaste] = await Promise.all([
      prisma.user.findUnique({ where: { email: "admin@test.local" } }),
      prisma.user.findUnique({ where: { email: "monteur@test.local" } }),
      prisma.user.findUnique({ where: { email: "videaste@test.local" } }),
    ]);
    if (!admin || !monteur || !videaste) {
      throw new Error("Seed users manquants (admin/monteur/videaste). Lance npm run test:db:seed d'abord.");
    }

    // Utilise le compte IG seed (test_account) pour rattacher les patterns.
    const account = await prisma.instagramAccount.findFirst({
      where: { handle: "test_account" },
      select: { id: true },
    });
    if (!account) throw new Error("Compte IG test_account manquant (seed).");

    for (const fx of PATTERN_FIXTURES) {
      const patternId = `fixture-${fx.slug}-pattern`;
      const slotId = `fixture-${fx.slug}-slot`;

      // 1. Purge artefacts d'un run précédent pour ce slot.
      await prisma.publicationSlot.update({
        where: { id: slotId },
        data: {
          activeCaptionJobId: null,
          activeCoverPackId: null,
          activeTranscriptionJobId: null,
          currentVersionId: null,
        },
      }).catch(() => {});
      await prisma.captionJob.deleteMany({ where: { slotId } });
      await prisma.transcriptionJob.deleteMany({ where: { slotId } });
      await prisma.descriptionJob.deleteMany({ where: { slotId } });
      const oldVersions = await prisma.publicationVersion.findMany({
        where: { slotId },
        select: { id: true },
      });
      for (const v of oldVersions) {
        await prisma.coverFramePack.deleteMany({ where: { publicationVersionId: v.id } });
      }
      await prisma.publicationRush.deleteMany({ where: { slotId } }).catch(() => {});
      await prisma.publicationVersion.deleteMany({ where: { slotId } });

      // 2. Upsert AccountPattern.
      const p = fx.patternData;
      await prisma.accountPattern.upsert({
        where: { id: patternId },
        update: {
          label: fx.label,
          source: p.source,
          coverMode: p.coverMode,
          needsDescription: p.needsDescription,
          needsCaptions: p.needsCaptions ?? false,
          needsCaptionsMode: p.needsCaptionsMode ?? "none",
          needsAdminValidation: p.needsAdminValidation ?? false,
          needsClientValidation: p.needsClientValidation ?? false,
          allowsClientRevision: p.allowsClientRevision ?? false,
          needsRushes: p.needsRushes ?? false,
          needsBrief: p.needsBrief ?? false,
        },
        create: {
          id: patternId,
          accountId: account.id,
          label: fx.label,
          source: p.source,
          coverMode: p.coverMode,
          needsDescription: p.needsDescription,
          needsCaptions: p.needsCaptions ?? false,
          needsCaptionsMode: p.needsCaptionsMode ?? "none",
          needsAdminValidation: p.needsAdminValidation ?? false,
          needsClientValidation: p.needsClientValidation ?? false,
          allowsClientRevision: p.allowsClientRevision ?? false,
          needsRushes: p.needsRushes ?? false,
          needsBrief: p.needsBrief ?? false,
          dayOfWeek: [1],
          publishTime: "09:00",
          defaultAssigneeMonteurId: monteur.id,
          defaultAssigneeCmId: admin.id,
          defaultAssigneeVideasteId: videaste.id,
        },
      });

      // 3. Upsert PublicationSlot.
      const scheduledAt = new Date();
      scheduledAt.setDate(scheduledAt.getDate() + 7);
      await prisma.publicationSlot.upsert({
        where: { id: slotId },
        update: {
          patternId,
          status: fx.slot.status,
          description: fx.slot.description ?? null,
          assigneeMonteurId: monteur.id,
          assigneeCmId: admin.id,
          assigneeVideasteId: videaste.id,
        },
        create: {
          id: slotId,
          accountId: account.id,
          patternId,
          scheduledAt,
          status: fx.slot.status,
          title: fx.label,
          description: fx.slot.description ?? null,
          assigneeMonteurId: monteur.id,
          assigneeCmId: admin.id,
          assigneeVideasteId: videaste.id,
          isAuto: false,
        },
      });

      // 4. Seed rushes si demandé.
      for (let i = 0; i < (fx.slot.rushesCount ?? 0); i++) {
        await prisma.publicationRush.create({
          data: {
            slotId,
            uploadedByUserId: videaste.id,
            r2Key: `fixtures/${slotId}/rushes/${i}.mp4`,
            fileName: `rush-${i}.mp4`,
            mimeType: "video/mp4",
            sizeBytes: 30000,
          },
        });
      }

      // 5. Seed version + promote si demandé.
      let versionId: string | null = null;
      if (fx.slot.withVersion) {
        const v = await prisma.publicationVersion.create({
          data: {
            slotId,
            versionNumber: 1,
            r2Key: `fixtures/${slotId}/versions/1.mp4`,
            fileUrl: "https://example.com/test-version.mp4",
            fileName: "version-1.mp4",
            mimeType: "video/mp4",
            uploadedByUserId: monteur.id,
          },
        });
        versionId = v.id;
        await prisma.publicationSlot.update({
          where: { id: slotId },
          data: { currentVersionId: versionId },
        });
      }

      // 6. Seed CaptionJob si demandé.
      if (fx.slot.captionJobStatus) {
        const job = await prisma.captionJob.create({
          data: {
            userId: admin.id,
            slotId,
            status: fx.slot.captionJobStatus,
            srtContent: fx.slot.captionJobStatus === "COMPLETED" ? "1\n00:00:00,000 --> 00:00:03,000\nFixture caption\n" : null,
            config: JSON.stringify({ fixture: true }),
          },
        });
        if (fx.slot.captionJobStatus === "COMPLETED") {
          await prisma.publicationSlot.update({
            where: { id: slotId },
            data: { activeCaptionJobId: job.id },
          });
        }
      }

      // 7. Seed CoverFramePack si demandé (rattaché à la version ou render).
      if (fx.slot.coverPackStatus && versionId) {
        const pack = await prisma.coverFramePack.create({
          data: {
            userId: admin.id,
            publicationVersionId: versionId,
            status: fx.slot.coverPackStatus,
            finalCoverUrl:
              fx.slot.coverPackStatus === "SELECTED"
                ? "https://example.com/test-cover.png"
                : null,
            config: JSON.stringify({ fixture: true }),
            overlayGroupIds: JSON.stringify([]),
            frameCount: fx.slot.coverPackStatus === "READY" || fx.slot.coverPackStatus === "SELECTED" ? 4 : 0,
          },
        });
        if (fx.slot.coverPackStatus === "SELECTED") {
          await prisma.publicationSlot.update({
            where: { id: slotId },
            data: { activeCoverPackId: pack.id },
          });
        }
      }
    }
    console.log(`  ↳ Pattern fixtures : ${PATTERN_FIXTURES.length} slots seedés`);
  } finally {
    await prisma.$disconnect();
  }
}

async function capturePatternFixture(
  context: BrowserContext,
  fx: PatternFixture,
): Promise<string> {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE_URL}/publications/fixture-${fx.slug}-slot`);
  await page.waitForTimeout(900);
  const outPath = resolve(OUTPUT_DIR, "surfaces", "patterns", `${fx.slug}.png`);
  mkdirSync(dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath, fullPage: true, animations: "disabled" });
  await page.close();
  return outPath;
}

async function main() {
  console.log(`▶ Audit UX — capture surfaces + scenarios + 10 patterns canoniques`);
  console.log(`  Output : ${OUTPUT_DIR}`);
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Reset des artefacts résiduels sur les slots de test pour avoir une
  // capture reproductible (sinon les E2E précédents biaisent la chaîne).
  await resetSlotState();
  // Seed des 10 patterns canoniques pour l'audit visuel — couvre les configs
  // alignées sur pattern-coherence.test.ts.
  await seedPatternFixtures();
  // Seed fixtures admin (médiathèque usages, data library, 2e compte).
  await seedAdminFixtures();

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

    // PATTERN FIXTURES (fiche par pattern canonique)
    const patternsToRun = PATTERN_FIXTURES.filter((p) => matchesFilter(p.slug));
    console.log(`\n▶ Patterns canoniques (${patternsToRun.length}/${PATTERN_FIXTURES.length})`);
    let patternOk = 0;
    for (const fx of patternsToRun) {
      try {
        await capturePatternFixture(context, fx);
        console.log(`  ✓ ${fx.slug} — ${fx.label}`);
        patternOk++;
      } catch (err) {
        console.error(`  ✗ ${fx.slug} : ${String(err).split("\n")[0]}`);
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
    console.log(`✅ Patterns : ${patternOk}/${patternsToRun.length}`);
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
