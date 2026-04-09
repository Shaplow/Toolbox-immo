import puppeteer, { type PaperFormat } from "puppeteer";
import type { CanvasFormat } from "@/types/template";

// Correspondence format → Puppeteer PDF format
const PDF_FORMATS: Record<string, PaperFormat | { width: string; height: string }> = {
  A4_PORTRAIT:  "A4",
  A3_LANDSCAPE: "A3",
  IG_1080x1350: { width: "1080px", height: "1350px" },
  IG_1080x1920: { width: "1080px", height: "1920px" },
};

const LANDSCAPE_FORMATS: CanvasFormat[] = ["A3_LANDSCAPE"];

export async function renderPDF(
  html: string,
  canvasFormat: CanvasFormat,
  width: number,
  height: number
): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    // Wait for all fonts (@font-face + Google Fonts) to be fully loaded and applied
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => (window as Window & { __templateReady?: boolean }).__templateReady === true, { timeout: 5000 }).catch(() => undefined);

    const isLandscape = canvasFormat === "CUSTOM"
      ? width >= height
      : LANDSCAPE_FORMATS.includes(canvasFormat);
    const pdfFormat = PDF_FORMATS[canvasFormat] ?? { width: `${width}px`, height: `${height}px` };

    const buffer = await page.pdf({
      ...(typeof pdfFormat === "string"
        ? { format: pdfFormat as PaperFormat }
        : pdfFormat),
      landscape: isLandscape,
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    return Buffer.from(buffer);
  } finally {
    await browser.close();
  }
}
