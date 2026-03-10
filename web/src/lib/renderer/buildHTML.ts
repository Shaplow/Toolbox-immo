import type { TemplateJSON } from "@/types/template";
import type { ListingData } from "@/types/listing";
import { renderTextBlock } from "./blocks/renderTextBlock";
import { renderImageBlock } from "./blocks/renderImageBlock";
import { renderDPEBlock } from "./blocks/renderDPEBlock";
import { renderShapeBlock } from "./blocks/renderShapeBlock";
import type {
  AnyBlock, TextBlock, ImageBlock, ShapeBlock, DPEBlock,
} from "@/types/template";

export interface BuildHTMLOptions {
  publicBase?: string;
  /**
   * overlayMode=true : utilisé pour le rendu vidéo.
   * - Canvas background = transparent (pour composite FFmpeg)
   * - Blocs "video" = div transparent (trou dans l'overlay)
   */
  overlayMode?: boolean;
}

export async function buildHTML(
  template: TemplateJSON,
  listing: ListingData,
  opts?: BuildHTMLOptions
): Promise<string> {
  const { canvas, theme, blocks } = template;
  const overlayMode = opts?.overlayMode ?? false;

  // Sort blocks by z-index
  const sorted = [...blocks].sort((a, b) => a.z - b.z);

  // Render each block to HTML
  const blockHtmlParts: string[] = await Promise.all(
    sorted.map(async (block) => {
      // Visibilité conditionnelle : masquer si la condition n'est pas remplie
      if (block.showIf) {
        const { field, equals } = block.showIf;
        const actual = String((listing as Record<string, unknown>)[field] ?? "");
        if (actual !== equals) return "";
      }
      switch (block.type) {
        case "text":    return renderTextBlock(block as TextBlock, listing);
        case "image":   return await renderImageBlock(block as ImageBlock, listing);
        case "shape":   return renderShapeBlock(block as ShapeBlock);
        case "dpe":     return await renderDPEBlock(block as DPEBlock, listing);
        case "video":   return renderVideoBlockPlaceholder(block, overlayMode);
        default:        return "";
      }
    })
  );

  const css = buildCSS(template, overlayMode);
  const fontHtml = await buildFontHtml(template, opts?.publicBase);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${canvas.width}" />
  <title>Rendu vitrine</title>
  ${fontHtml}
  <style>${css}</style>
</head>
<body>
  <div id="canvas" style="width:${canvas.width}px;height:${canvas.height}px;background:${overlayMode ? "transparent" : canvas.backgroundColor};position:relative;overflow:hidden;">
    ${blockHtmlParts.join("\n")}
  </div>
</body>
</html>`;
}

/**
 * Build @font-face style tags with fonts fully embedded as base64 data URIs.
 * This makes the HTML self-contained so Puppeteer needs zero external network requests
 * for fonts (avoids race conditions with Google Fonts CDN).
 *
 * - Local fonts (url in customFonts): read from disk via publicBase or direct path
 * - Google Fonts (no url): fetch CSS from Google APIs, then fetch each .woff2 file
 */
async function buildFontHtml(template: TemplateJSON, publicBase?: string): Promise<string> {
  const collected = new Map<string, string | undefined>(); // family → url | undefined

  // 1. All user-defined fonts
  for (const cf of template.theme.customFonts ?? []) {
    if (!collected.has(cf.family)) collected.set(cf.family, cf.url);
  }
  // 2. Any fontFamily used on blocks not already listed
  for (const block of template.blocks) {
    const fam = (block as { style?: { fontFamily?: string } }).style?.fontFamily;
    if (fam && !collected.has(fam)) collected.set(fam, undefined);
  }
  // 3. Fallback: heading + body
  const hf = template.theme.fonts.heading;
  const bf = template.theme.fonts.body;
  if (!collected.has(hf.family)) collected.set(hf.family, hf.url);
  if (!collected.has(bf.family)) collected.set(bf.family, bf.url);

  const styleParts: string[] = [];
  console.log(`[buildFontHtml] Collected fonts:`, [...collected.entries()].map(([f, u]) => `${f} → ${u ?? "(google)"}`));

  for (const [family, url] of collected) {
    if (url) {
      // Local font — read directly from disk (Node.js context, no need for publicBase)
      try {
        const { readFile } = await import("fs/promises");
        const { join } = await import("path");
        // url is like "/fonts/MyFont.ttf" — always resolve from public/
        const relative = url.startsWith("/") ? url.slice(1) : url;
        const filePath = join(process.cwd(), "public", relative);
        const buf = await readFile(filePath);
        const b64 = buf.toString("base64");
        const ext = url.split(".").pop()?.toLowerCase() ?? "woff2";
        const mimeMap: Record<string, string> = {
          woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf",
        };
        // Correct format names for @font-face src
        const formatMap: Record<string, string> = {
          woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype",
        };
        const mime = mimeMap[ext] ?? "font/woff2";
        const fmt = formatMap[ext] ?? "woff2";
        // font-weight: 100 900 covers all weights from a single font file
        styleParts.push(
          `@font-face{font-family:'${family}';src:url('data:${mime};base64,${b64}') format('${fmt}');font-weight:100 900;font-style:normal;}`
        );
        console.log(`[buildFontHtml] Embedded local font "${family}" from ${filePath} (${Math.round(buf.length / 1024)} KB)`);
      } catch (e) {
        console.warn(`[buildFontHtml] Could not embed local font "${family}" (${url}):`, e);
      }
    } else {
      // Google Font — fetch CSS then embed each woff2 as base64
      try {
        const weights = "300;400;500;600;700";
        const apiUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weights}&display=swap`;
        const cssRes = await fetch(apiUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; Puppeteer)" },
          signal: AbortSignal.timeout(5000),
        });
        if (!cssRes.ok) throw new Error(`HTTP ${cssRes.status}`);
        let css = await cssRes.text();

        // Replace each url(...) font file reference with a base64 data URI
        const woff2Regex = /url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/g;
        const matches = [...css.matchAll(woff2Regex)];
        await Promise.all(
          matches.map(async (m) => {
            try {
              const fontRes = await fetch(m[1], { signal: AbortSignal.timeout(5000) });
              if (!fontRes.ok) return;
              const buf = Buffer.from(await fontRes.arrayBuffer());
              const b64 = buf.toString("base64");
              css = css.replace(m[0], `url('data:font/woff2;base64,${b64}')`);
            } catch { /* skip individual font variant */ }
          })
        );
        styleParts.push(css);
      } catch (e) {
        console.warn(`[buildFontHtml] Could not embed Google Font "${family}":`, e);
        // Fallback: sans font externe — Puppeteer utilisera la police système
        styleParts.push(`@font-face{font-family:'${family}';src:local('${family}'),local('sans-serif');}`);
      }
    }
  }

  if (styleParts.length === 0) return "";
  return `<style>\n${styleParts.join("\n")}\n</style>`;
}

/** Bloc vidéo : en mode normal = fond sombre, en overlayMode = transparent (trou pour FFmpeg). */
function renderVideoBlockPlaceholder(block: AnyBlock, overlayMode: boolean): string {
  const bg = overlayMode ? "transparent" : "#111827";
  return `<div class="block" style="left:${block.x}px;top:${block.y}px;width:${block.w}px;height:${block.h}px;z-index:${block.z};background:${bg};overflow:hidden;"></div>`;
}

function buildCSS(template: TemplateJSON, overlayMode = false): string {
  const { theme, canvas } = template;
  const bgColor = overlayMode ? "transparent" : canvas.backgroundColor;

  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: ${canvas.width}px;
      height: ${canvas.height}px;
      overflow: hidden;
      background: ${bgColor};
    }
    #canvas {
      position: relative;
      font-family: '${theme.fonts.body.family}', ${theme.fonts.body.fallback};
      color: ${theme.palette.text};
    }
    .block {
      position: absolute;
    }
    .block-text {
      overflow: hidden;
      word-break: break-word;
    }
    .block-image img {
      width: 100%;
      height: 100%;
      display: block;
    }
    .block-image-cover img  { object-fit: cover; }
    .block-image-contain img { object-fit: contain; }
    .dpe-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }
    .dpe-letter {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 22px;
      color: white;
      font-weight: 700;
      font-size: 13px;
      border-radius: 2px;
    }
    .legal-text {
      font-size: 7px;
      line-height: 1.4;
      color: #9B9B9B;
    }
  `;
}
