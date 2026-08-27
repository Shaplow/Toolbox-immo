import puppeteer, { type Browser } from "puppeteer";
import { existsSync } from "fs";

// Sur ARM64 (Hetzner), Puppeteer télécharge un Chrome x86 incompatible.
// Priorité : variable d'env PUPPETEER_EXECUTABLE_PATH, puis chemins connus.
function getChromiumPath(): string | undefined {
  // 1. Env var explicite (le plus fiable en prod)
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    console.log(`[renderPNG] Using Chromium from env: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  // 2. Chemins connus (xtradeb PPA + fallbacks)
  const candidates = [
    "/usr/lib/chromium/chromium",
    "/usr/lib/chromium-browser/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/snap/chromium/current/usr/lib/chromium-browser/chromium-browser",
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      console.log(`[renderPNG] Using Chromium: ${p}`);
      return p;
    }
  }
  console.error("[renderPNG] No system Chromium found — will fail on ARM64. Set PUPPETEER_EXECUTABLE_PATH in .env.local");
  return undefined;
}

// --- Concurrence globale ----------------------------------------------------
// Prod = 1 seul process Node (PM2 instances:1, max_memory_restart 2048M).
// Chaque page Chromium consomme du CPU (rasterisation) + de la RAM. Sans
// plafond, une rafale (plusieurs packs cover affichés d'un coup, un render vidéo
// multi-états, plusieurs onglets) affame l'event loop et fait sauter la limite
// mémoire → OOM-restart PM2 (le « freeze/crash » perçu). On borne donc le nombre
// de rendus simultanés, TOUS appelants confondus : overlay cover, cover finale et
// render vidéo partagent ce même moteur. Ajustable via PUPPETEER_MAX_CONCURRENCY.
const MAX_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.PUPPETEER_MAX_CONCURRENCY ?? "", 10) || 2,
);

let inFlight = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENCY) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  const next = waiters.shift();
  if (next) next(); // passe le créneau au prochain en attente (inFlight inchangé)
  else inFlight--;
}

// --- Browser Chromium partagé et gardé chaud -------------------------------
// Un seul browser réutilisé pour tous les rendus (une page par rendu, fermée
// après). Évite le coût launch/close (~plusieurs centaines de ms + pic RAM) à
// chaque appel. Stocké sur globalThis pour survivre au HMR en dev, comme le
// client Prisma. Recréé automatiquement si Chromium se déconnecte / crash.
const globalForRenderer = globalThis as unknown as {
  __rendererBrowser?: Promise<Browser> | null;
};

function launchBrowser(): Promise<Browser> {
  const executablePath = getChromiumPath();
  const promise = puppeteer.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
  const forget = () => {
    if (globalForRenderer.__rendererBrowser === promise) {
      globalForRenderer.__rendererBrowser = null;
    }
  };
  promise.then((browser) => browser.on("disconnected", forget)).catch(forget);
  return promise;
}

async function getBrowser(): Promise<Browser> {
  let promise = globalForRenderer.__rendererBrowser;
  if (!promise) {
    promise = launchBrowser();
    globalForRenderer.__rendererBrowser = promise;
  }
  try {
    const browser = await promise;
    if (!browser.connected) {
      if (globalForRenderer.__rendererBrowser === promise) globalForRenderer.__rendererBrowser = null;
      return getBrowser();
    }
    return browser;
  } catch (err) {
    if (globalForRenderer.__rendererBrowser === promise) globalForRenderer.__rendererBrowser = null;
    throw err;
  }
}

/**
 * Rend un HTML en PNG.
 * deviceScaleFactor=3 simule ~300 DPI pour le print.
 * transparent=true : fond transparent (pour overlay vidéo FFmpeg).
 *
 * Passe par un browser Chromium partagé (une page par appel) et un sémaphore
 * global (MAX_CONCURRENCY) : quel que soit le nombre de flux lancés, on ne
 * rastérise jamais plus de N pages en parallèle sur le process unique.
 */
/**
 * Erreurs qui signalent un Chromium mort ou déconnecté plutôt qu'un vrai problème
 * de rendu. Le browser partagé peut disparaître entre le check `connected` de
 * getBrowser() et le `newPage()` qui suit — typiquement sur un OOM-restart du VPS.
 */
function isBrowserGoneError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Target closed|Session closed|Protocol error|has disconnected|Connection closed|Target crashed/i.test(message);
}

async function renderOnce(
  html: string,
  width: number,
  height: number,
  scaleFactor: number,
  transparent: boolean,
): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height, deviceScaleFactor: scaleFactor });
    // domcontentloaded au lieu de networkidle0 — les fonts sont embedées en base64,
    // networkidle0 peut boucler indéfiniment si une ressource externe ne répond pas.
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 60_000 });
    // Wait for all fonts to be applied (ils sont en base64 donc instantané)
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => (window as Window & { __templateReady?: boolean }).__templateReady === true, { timeout: 5000 }).catch(() => undefined);

    const buffer = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width, height },
      omitBackground: transparent,
    });

    return Buffer.from(buffer);
  } finally {
    await page.close().catch(() => undefined);
  }
}

export async function renderPNG(
  html: string,
  width: number,
  height: number,
  scaleFactor = 3,
  transparent = false
): Promise<Buffer> {
  await acquire();
  try {
    try {
      return await renderOnce(html, width, height, scaleFactor, transparent);
    } catch (err) {
      if (!isBrowserGoneError(err)) throw err;
      // Une seule reprise : on invalide le browser en cache et on relance sur un
      // Chromium neuf. Sans ça, le premier appel après un crash échouait toujours
      // et l'utilisateur devait relancer à la main (« je spamme jusqu'à ce que ça
      // marche »).
      console.warn("[renderPNG] Chromium partagé perdu — nouvelle tentative sur un browser neuf :", err);
      globalForRenderer.__rendererBrowser = null;
      return await renderOnce(html, width, height, scaleFactor, transparent);
    }
  } finally {
    release();
  }
}
