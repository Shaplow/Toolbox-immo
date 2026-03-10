import puppeteer from "puppeteer";
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

/**
 * Rend un HTML en PNG.
 * deviceScaleFactor=3 simule ~300 DPI pour le print.
 * transparent=true : fond transparent (pour overlay vidéo FFmpeg).
 */
export async function renderPNG(
  html: string,
  width: number,
  height: number,
  scaleFactor = 3,
  transparent = false
): Promise<Buffer> {
  const executablePath = getChromiumPath();
  const browser = await puppeteer.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: scaleFactor });
    // domcontentloaded au lieu de networkidle0 — les fonts sont embedées en base64,
    // networkidle0 peut boucler indéfiniment si une ressource externe ne répond pas.
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    // Wait for all fonts to be applied (ils sont en base64 donc instantané)
    await page.evaluate(() => document.fonts.ready);

    const buffer = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width, height },
      omitBackground: transparent,
    });

    return Buffer.from(buffer);
  } finally {
    await browser.close();
  }
}
