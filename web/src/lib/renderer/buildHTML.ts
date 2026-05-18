import type { TemplateJSON } from "@/types/template";
import type { ListingData } from "@/types/listing";
import { listFontAssetsByFamilies } from "@/lib/fontAssets";
import { isAutoLayoutGroup, normalizeGroupLayout } from "@/lib/groupLayout";
import {
  PER_LINE_TEXT_GOO_ALPHA_INTERCEPT,
  PER_LINE_TEXT_GOO_ALPHA_SLOPE,
  PER_LINE_TEXT_GOO_COLOR_INTERPOLATION,
  PER_LINE_TEXT_GOO_COLOR_MATRIX,
  PER_LINE_TEXT_GOO_FILTER_REGION,
  getPerLineTextGooFilterBlur,
  getPerLineTextGooFilterId,
  shouldApplyPerLineTextGoo,
} from "@/lib/perLineTextBackground";
import { getEffectiveTextAnchorPadding, getTextBackgroundBorderRadius, getTextBackgroundMode, isTextBackgroundEnabled } from "@/lib/textBackground";
import { isBlockVisibleForListing, resolveBlockForListing } from "@/lib/templateConditions";
import { getVisibleFieldKeys } from "@/lib/formSections";
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
  layoutDebug?: boolean;
  /**
   * IDs des blocs à masquer dans cet overlay (pour le rendu d'un segment temporel).
   * Utilisé en mode multi-overlay pour masquer visuellement les blocs inactifs à un instant donné,
   * tout en les gardant mesurables dans le DOM afin de préserver l'auto-layout des groupes.
   * Absent = tous les blocs sont rendus (comportement par défaut).
   */
  hiddenBlockIds?: string[];
}

function addRootAttributes(html: string, attributes: string[]): string {
  if (attributes.length === 0) return html;
  return html.replace(/^<div\b/, `<div ${attributes.join(" ")}`);
}

export async function buildHTML(
  template: TemplateJSON,
  listing: ListingData,
  opts?: BuildHTMLOptions
): Promise<string> {
  const { canvas, blocks } = template;
  const overlayMode = opts?.overlayMode ?? false;
  const hiddenBlockIdSet = new Set(opts?.hiddenBlockIds ?? []);
  const groupMap = new Map((template.groups ?? []).map((group) => [group.id, group]));
  const declaredFieldKeys = new Set((template.schema ?? []).map((field) => field.key));
  const visibleFieldKeys = getVisibleFieldKeys(template.schema ?? [], template.formSections ?? [], listing);
  const autoLayoutGroups = (template.groups ?? [])
    .filter((group) => isAutoLayoutGroup(group))
    .map((group) => ({ id: group.id, ...normalizeGroupLayout(group.layout) }));

  // Sort blocks by z-index
  const sorted = [...blocks].sort((a, b) => a.z - b.z);

  // Render each block to HTML
  const blockHtmlParts: string[] = await Promise.all(
    sorted.map(async (block) => {
      const isTimingHidden = hiddenBlockIdSet.has(block.id);

      if (
        (block.type === "image" || block.type === "video") &&
        block.binding &&
        declaredFieldKeys.has(block.binding) &&
        !visibleFieldKeys.has(block.binding)
      ) {
        return "";
      }

      const group = block.groupId ? groupMap.get(block.groupId) : undefined;
      if (!isBlockVisibleForListing(block, listing, group)) return "";

      const resolvedBlock = resolveBlockForListing(block, listing, group);
      const isAutoLayout = isAutoLayoutGroup(group);
      const withRenderMetadata = (html: string) => {
        const rootAttributes: string[] = [];
        if (isTimingHidden) {
          rootAttributes.push('data-timing-hidden="true"');
          rootAttributes.push('aria-hidden="true"');
        }
        if (!isAutoLayout) return addRootAttributes(html, rootAttributes);

        const anchorPadding = resolvedBlock.type === "text"
          ? getEffectiveTextAnchorPadding(resolvedBlock.style)
          : null;
        rootAttributes.push(
          `data-layout-group-id="${group?.id}"`,
          `data-layout-block-id="${resolvedBlock.id}"`,
          `data-layout-source-x="${resolvedBlock.x}"`,
          `data-layout-source-y="${resolvedBlock.y}"`,
          `data-layout-source-z="${resolvedBlock.z}"`,
          `data-layout-block-type="${resolvedBlock.type}"`
        );
        if (resolvedBlock.type === "text") {
          rootAttributes.push(
            `data-layout-text-align="${resolvedBlock.style.textAlign ?? "left"}"`,
            `data-layout-vertical-align="${resolvedBlock.style.verticalAlign ?? "top"}"`
          );
        }
        if (anchorPadding) {
          rootAttributes.push(
            `data-layout-padding-top="${anchorPadding.top}"`,
            `data-layout-padding-right="${anchorPadding.right}"`,
            `data-layout-padding-bottom="${anchorPadding.bottom}"`,
            `data-layout-padding-left="${anchorPadding.left}"`
          );
        }
        return addRootAttributes(html, rootAttributes);
      };

      switch (resolvedBlock.type) {
        case "text":    return withRenderMetadata(renderTextBlock(resolvedBlock as TextBlock, listing, template.schema, { autoLayout: isAutoLayout }));
        case "image":   return withRenderMetadata(await renderImageBlock(resolvedBlock as ImageBlock, listing));
        case "shape":   return withRenderMetadata(renderShapeBlock(resolvedBlock as ShapeBlock));
        case "dpe":     return withRenderMetadata(await renderDPEBlock(resolvedBlock as DPEBlock, listing));
        case "video":   return withRenderMetadata(renderVideoBlockPlaceholder(resolvedBlock, overlayMode));
        default:        return "";
      }
    })
  );

  const css = buildCSS(template, overlayMode);
  const fontHtml = await buildFontHtml(template, opts?.publicBase);
  const behaviorScript = buildBehaviorScript(autoLayoutGroups, opts?.layoutDebug ?? false);
  const perLineTextFilter = buildPerLineTextGooFilterMarkup(template);

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
  ${perLineTextFilter}
  <div id="canvas" style="width:${canvas.width}px;height:${canvas.height}px;background:${overlayMode ? "transparent" : canvas.backgroundColor};position:relative;overflow:hidden;">
    ${blockHtmlParts.join("\n")}
  </div>
  ${behaviorScript}
</body>
</html>`;
}

function buildBehaviorScript(autoLayoutGroups: Array<{ id: string; mode?: "free" | "row" | "column"; width?: number; height?: number; gap?: number; justify?: "start" | "center" | "end"; align?: "top" | "middle" | "bottom"; order?: string[]; anchorBlockId?: string }>, layoutDebug = false): string {
  return `<script>
    window.__templateReady = false;
    window.__layoutDebugSnapshot = null;
    (function () {
      const autoLayoutGroups = ${JSON.stringify(autoLayoutGroups)};
      const layoutDebug = ${layoutDebug ? "true" : "false"};

      function roundDebugValue(value) {
        const numeric = Number(value || 0);
        if (!Number.isFinite(numeric)) return 0;
        return Math.round(numeric * 100) / 100;
      }

      function fitTextBlock(block) {
        if (!(block instanceof HTMLElement)) return;
        if (block.dataset.shrinkToFit !== 'true') return;

        const content = block.querySelector('.block-text-content');
        if (!(content instanceof HTMLElement)) return;

        const backgroundMode = block.dataset.textBackgroundMode || 'none';
        const measured = block.querySelector('.block-text-background');
        const fitContainer = backgroundMode === 'fixed' && measured instanceof HTMLElement ? measured : block;
        const fitStyle = window.getComputedStyle(fitContainer);
        let availableWidth = Math.max(
          0,
          fitContainer.clientWidth
            - Number.parseFloat(fitStyle.paddingLeft || '0')
            - Number.parseFloat(fitStyle.paddingRight || '0')
        );
        let availableHeight = Math.max(
          0,
          fitContainer.clientHeight
            - Number.parseFloat(fitStyle.paddingTop || '0')
            - Number.parseFloat(fitStyle.paddingBottom || '0')
        );

        if (backgroundMode !== 'fixed' && measured instanceof HTMLElement) {
          const measuredStyle = window.getComputedStyle(measured);
          const paddingLeft = Number.parseFloat(measuredStyle.paddingLeft || '0');
          const paddingRight = Number.parseFloat(measuredStyle.paddingRight || '0');
          const paddingTop = Number.parseFloat(measuredStyle.paddingTop || '0');
          const paddingBottom = Number.parseFloat(measuredStyle.paddingBottom || '0');
          availableWidth = Math.max(0, availableWidth - paddingLeft - paddingRight);
          availableHeight = Math.max(0, availableHeight - paddingTop - paddingBottom);
        }

        const minFontSizePt = Number(block.dataset.minFontSize || '0');
        if (!Number.isFinite(minFontSizePt) || minFontSizePt <= 0) return;

        const initialFontSizePx = Number.parseFloat(window.getComputedStyle(content).fontSize);
        if (!Number.isFinite(initialFontSizePx) || initialFontSizePx <= 0) return;

        const minFontSizePx = minFontSizePt * (4 / 3);
        const step = 0.5;
        let nextFontSize = initialFontSizePx;

        content.style.fontSize = initialFontSizePx + 'px';
        while (nextFontSize > minFontSizePx) {
          const overflowsHeight = content.scrollHeight - 0.5 > availableHeight;
          const overflowsWidth = content.scrollWidth - 0.5 > availableWidth;
          if (!overflowsHeight && !overflowsWidth) break;

          nextFontSize = Math.max(minFontSizePx, nextFontSize - step);
          content.style.fontSize = nextFontSize + 'px';
        }
      }

      function getEffectiveSize(block) {
        if (!(block instanceof HTMLElement)) return { width: block.offsetWidth, height: block.offsetHeight };
        const measured = block.querySelector('.block-text-background') || block;
        const rect = measured instanceof HTMLElement ? measured.getBoundingClientRect() : null;
        const fallbackRect = block.getBoundingClientRect();
        return {
          width: rect?.width || fallbackRect.width || block.offsetWidth,
          height: rect?.height || fallbackRect.height || block.offsetHeight,
        };
      }

      function getAnchorOffset(block) {
        const size = getEffectiveSize(block);
        const frameWidth = block.offsetWidth;
        const frameHeight = block.offsetHeight;
        const hasBackground = Boolean(block.querySelector('.block-text-background'));
        let boxOffsetX = 0;
        let boxOffsetY = 0;
        if (hasBackground) {
          const textAlign = block.dataset.layoutTextAlign || 'left';
          const verticalAlign = block.dataset.layoutVerticalAlign || 'top';
          if (textAlign === 'center') boxOffsetX = Math.round((frameWidth - size.width) / 2);
          else if (textAlign === 'right') boxOffsetX = Math.round(frameWidth - size.width);
          if (verticalAlign === 'middle') boxOffsetY = Math.round((frameHeight - size.height) / 2);
          else if (verticalAlign === 'bottom') boxOffsetY = Math.round(frameHeight - size.height);
        }
        if (block.dataset.layoutBlockType !== 'text') {
          return {
            x: boxOffsetX + Math.round(size.width / 2),
            y: boxOffsetY + Math.round(size.height / 2),
          };
        }

        const paddingTop = Number(block.dataset.layoutPaddingTop || '0');
        const paddingRight = Number(block.dataset.layoutPaddingRight || '0');
        const paddingBottom = Number(block.dataset.layoutPaddingBottom || '0');
        const paddingLeft = Number(block.dataset.layoutPaddingLeft || '0');
        const textAlign = block.dataset.layoutTextAlign || 'left';
        const verticalAlign = block.dataset.layoutVerticalAlign || 'top';

        let x = size.width / 2;
        if (textAlign === 'left') x = paddingLeft;
        else if (textAlign === 'right') x = size.width - paddingRight;

        let y = size.height / 2;
        if (verticalAlign === 'top') y = paddingTop;
        else if (verticalAlign === 'bottom') y = size.height - paddingBottom;

        return {
          x: boxOffsetX + Math.max(0, Math.min(Math.round(x), Math.round(size.width))),
          y: boxOffsetY + Math.max(0, Math.min(Math.round(y), Math.round(size.height))),
        };
      }

      function getEffectiveBoxOffset(block) {
        const size = getEffectiveSize(block);
        const frameWidth = block.offsetWidth;
        const frameHeight = block.offsetHeight;
        const hasBackground = Boolean(block.querySelector('.block-text-background'));
        if (!hasBackground || block.dataset.layoutBlockType !== 'text') {
          return { x: 0, y: 0, size };
        }

        const textAlign = block.dataset.layoutTextAlign || 'left';
        const verticalAlign = block.dataset.layoutVerticalAlign || 'top';
        let x = 0;
        let y = 0;
        if (textAlign === 'center') x = Math.round((frameWidth - size.width) / 2);
        else if (textAlign === 'right') x = Math.round(frameWidth - size.width);
        if (verticalAlign === 'middle') y = Math.round((frameHeight - size.height) / 2);
        else if (verticalAlign === 'bottom') y = Math.round(frameHeight - size.height);
        return { x: Math.max(0, x), y: Math.max(0, y), size };
      }

      function layoutAutoGroups() {
        for (const groupLayout of autoLayoutGroups) {
          const nodes = [...document.querySelectorAll('[data-layout-group-id="' + groupLayout.id + '"]')].filter((node) => node instanceof HTMLElement);
          if (nodes.length === 0) continue;
          const mode = groupLayout.mode === 'column' ? 'column' : 'row';

          const blocks = nodes
            .map((node) => ({
              node,
              blockId: String(node.dataset.layoutBlockId || ''),
              sourceX: Number(node.dataset.layoutSourceX || '0'),
              sourceY: Number(node.dataset.layoutSourceY || '0'),
              sourceZ: Number(node.dataset.layoutSourceZ || '0'),
              left: Number.parseFloat(node.style.left || '0'),
              top: Number.parseFloat(node.style.top || '0'),
              frameWidth: node.getBoundingClientRect().width || node.offsetWidth,
              frameHeight: node.getBoundingClientRect().height || node.offsetHeight,
              size: getEffectiveSize(node),
            }))
            .sort((left, right) => {
              const order = Array.isArray(groupLayout.order) ? groupLayout.order : [];
              const leftIndex = order.indexOf(left.blockId);
              const rightIndex = order.indexOf(right.blockId);
              if (leftIndex !== -1 || rightIndex !== -1) {
                if (leftIndex === -1) return 1;
                if (rightIndex === -1) return -1;
                if (leftIndex !== rightIndex) return leftIndex - rightIndex;
              }
              if (mode === 'column') {
                return left.sourceY - right.sourceY || left.sourceX - right.sourceX || left.sourceZ - right.sourceZ;
              }
              return left.sourceX - right.sourceX || left.sourceY - right.sourceY || left.sourceZ - right.sourceZ;
            });

          const minX = Math.min(...blocks.map((item) => item.left));
          const minY = Math.min(...blocks.map((item) => item.top));
          const maxX = Math.max(...blocks.map((item) => item.left + item.frameWidth));
          const maxY = Math.max(...blocks.map((item) => item.top + item.frameHeight));
          const frameWidth = Math.max(1, Number(groupLayout.width || Math.round(maxX - minX)));
          const frameHeight = Math.max(1, Number(groupLayout.height || Math.round(maxY - minY)));
          const gap = Math.max(0, Number(groupLayout.gap || 16));
          if (mode === 'column') {
            const anchorIndex = groupLayout.justify === 'center' && groupLayout.anchorBlockId
              ? blocks.findIndex((item) => item.blockId === groupLayout.anchorBlockId)
              : -1;
            if (anchorIndex >= 0) {
              const anchorOffset = getAnchorOffset(blocks[anchorIndex].node);
              const anchorStartY = minY + Math.round(frameHeight / 2 - anchorOffset.y);
              let topCursor = anchorStartY - gap;
              let bottomCursor = anchorStartY + blocks[anchorIndex].size.height + gap;

              for (let index = 0; index < blocks.length; index += 1) {
                const item = blocks[index];
                const boxOffset = getEffectiveBoxOffset(item.node);
                let nextX = minX;
                if (groupLayout.align === 'middle') {
                  nextX += Math.round((frameWidth - item.size.width) / 2);
                } else if (groupLayout.align === 'bottom') {
                  nextX += Math.round(frameWidth - item.size.width);
                }

                if (index === anchorIndex) {
                  item.node.style.left = Math.round(nextX - boxOffset.x) + 'px';
                  item.node.style.top = Math.round(anchorStartY - boxOffset.y) + 'px';
                  continue;
                }

                if (index < anchorIndex) {
                  const nextY = topCursor - item.size.height;
                  item.node.style.left = Math.round(nextX - boxOffset.x) + 'px';
                  item.node.style.top = Math.round(nextY - boxOffset.y) + 'px';
                  topCursor = nextY - gap;
                  continue;
                }

                item.node.style.left = Math.round(nextX - boxOffset.x) + 'px';
                item.node.style.top = Math.round(bottomCursor - boxOffset.y) + 'px';
                bottomCursor += item.size.height + gap;
              }

              continue;
            }

            const totalHeight = blocks.reduce((sum, item) => sum + item.size.height, 0) + Math.max(0, blocks.length - 1) * gap;
            let cursorY = minY;
            if (groupLayout.justify === 'center') {
              cursorY += Math.round((frameHeight - totalHeight) / 2);
            } else if (groupLayout.justify === 'end') {
              cursorY += Math.round(frameHeight - totalHeight);
            }

            for (const item of blocks) {
              const boxOffset = getEffectiveBoxOffset(item.node);
              let nextX = minX;
              if (groupLayout.align === 'middle') {
                nextX += Math.round((frameWidth - item.size.width) / 2);
              } else if (groupLayout.align === 'bottom') {
                nextX += Math.round(frameWidth - item.size.width);
              }

              item.node.style.left = Math.round(nextX - boxOffset.x) + 'px';
              item.node.style.top = Math.round(cursorY - boxOffset.y) + 'px';
              cursorY += item.size.height + gap;
            }

            continue;
          }

          const anchorIndex = groupLayout.justify === 'center' && groupLayout.anchorBlockId
            ? blocks.findIndex((item) => item.blockId === groupLayout.anchorBlockId)
            : -1;
          if (anchorIndex >= 0) {
            const anchorOffset = getAnchorOffset(blocks[anchorIndex].node);
            const anchorStartX = minX + Math.round(frameWidth / 2 - anchorOffset.x);
            let leftCursor = anchorStartX - gap;
            let rightCursor = anchorStartX + blocks[anchorIndex].size.width + gap;

            for (let index = 0; index < blocks.length; index += 1) {
              const item = blocks[index];
              const boxOffset = getEffectiveBoxOffset(item.node);
              let nextY = minY;
              if (groupLayout.align === 'middle') {
                nextY += Math.round((frameHeight - item.size.height) / 2);
              } else if (groupLayout.align === 'bottom') {
                nextY += Math.round(frameHeight - item.size.height);
              }

              if (index === anchorIndex) {
                item.node.style.left = Math.round(anchorStartX - boxOffset.x) + 'px';
                item.node.style.top = Math.round(nextY - boxOffset.y) + 'px';
                continue;
              }

              if (index < anchorIndex) {
                const nextX = leftCursor - item.size.width;
                item.node.style.left = Math.round(nextX - boxOffset.x) + 'px';
                item.node.style.top = Math.round(nextY - boxOffset.y) + 'px';
                leftCursor = nextX - gap;
                continue;
              }

              item.node.style.left = Math.round(rightCursor - boxOffset.x) + 'px';
              item.node.style.top = Math.round(nextY - boxOffset.y) + 'px';
              rightCursor += item.size.width + gap;
            }

            continue;
          }

          const totalWidth = blocks.reduce((sum, item) => sum + item.size.width, 0) + Math.max(0, blocks.length - 1) * gap;

          let cursorX = minX;
          if (groupLayout.justify === 'center') {
            cursorX += Math.round((frameWidth - totalWidth) / 2);
          } else if (groupLayout.justify === 'end') {
            cursorX += Math.round(frameWidth - totalWidth);
          }

          for (const item of blocks) {
            const boxOffset = getEffectiveBoxOffset(item.node);
            let nextY = minY;
            if (groupLayout.align === 'middle') {
              nextY += Math.round((frameHeight - item.size.height) / 2);
            } else if (groupLayout.align === 'bottom') {
              nextY += Math.round(frameHeight - item.size.height);
            }

            item.node.style.left = Math.round(cursorX - boxOffset.x) + 'px';
            item.node.style.top = Math.round(nextY - boxOffset.y) + 'px';
            cursorX += item.size.width + gap;
          }
        }
      }

      function buildDebugSnapshot() {
        const nodes = [...document.querySelectorAll('[data-layout-group-id]')].filter((node) => node instanceof HTMLElement);
        const blocks = nodes.map((node) => {
          const size = getEffectiveSize(node);
          const boxOffset = getEffectiveBoxOffset(node);
          const anchorOffset = getAnchorOffset(node);
          const rect = node.getBoundingClientRect();

          return {
            blockId: String(node.dataset.layoutBlockId || ''),
            groupId: String(node.dataset.layoutGroupId || ''),
            sourceX: roundDebugValue(node.dataset.layoutSourceX || 0),
            sourceY: roundDebugValue(node.dataset.layoutSourceY || 0),
            sourceZ: roundDebugValue(node.dataset.layoutSourceZ || 0),
            finalLeft: roundDebugValue(Number.parseFloat(node.style.left || '0')),
            finalTop: roundDebugValue(Number.parseFloat(node.style.top || '0')),
            frameWidth: roundDebugValue(rect.width || node.offsetWidth),
            frameHeight: roundDebugValue(rect.height || node.offsetHeight),
            visibleWidth: roundDebugValue(size.width),
            visibleHeight: roundDebugValue(size.height),
            boxOffsetX: roundDebugValue(boxOffset.x),
            boxOffsetY: roundDebugValue(boxOffset.y),
            anchorOffsetX: roundDebugValue(anchorOffset.x),
            anchorOffsetY: roundDebugValue(anchorOffset.y),
          };
        });

        const groups = autoLayoutGroups
          .map((groupLayout) => {
            const members = blocks.filter((block) => block.groupId === groupLayout.id);
            if (members.length === 0) return null;

            const minX = Math.min(...members.map((item) => item.finalLeft));
            const minY = Math.min(...members.map((item) => item.finalTop));
            const maxX = Math.max(...members.map((item) => item.finalLeft + item.frameWidth));
            const maxY = Math.max(...members.map((item) => item.finalTop + item.frameHeight));

            return {
              groupId: groupLayout.id,
              mode: groupLayout.mode === 'column' ? 'column' : 'row',
              justify: groupLayout.justify || 'center',
              align: groupLayout.align || 'top',
              gap: roundDebugValue(groupLayout.gap || 16),
              width: roundDebugValue(Number(groupLayout.width || Math.max(1, maxX - minX))),
              height: roundDebugValue(Number(groupLayout.height || Math.max(1, maxY - minY))),
              minX: roundDebugValue(minX),
              minY: roundDebugValue(minY),
              maxX: roundDebugValue(maxX),
              maxY: roundDebugValue(maxY),
              anchorBlockId: groupLayout.anchorBlockId || undefined,
              order: Array.isArray(groupLayout.order) ? groupLayout.order : [],
              memberIds: members.map((member) => member.blockId),
            };
          })
          .filter(Boolean);

        return {
          source: 'preview',
          capturedAt: new Date().toISOString(),
          blocks,
          groups,
        };
      }

      function publishDebugSnapshot(snapshot) {
        if (!layoutDebug) return;
        window.__layoutDebugSnapshot = snapshot;
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'template-layout-debug', snapshot }, '*');
          }
        } catch {}
      }

      async function run() {
        try {
          if (document.fonts && document.fonts.ready) {
            await document.fonts.ready;
          }
          document.querySelectorAll('.block-text').forEach(fitTextBlock);
          layoutAutoGroups();
          if (layoutDebug) {
            publishDebugSnapshot(buildDebugSnapshot());
          }
        } finally {
          window.__templateReady = true;
        }
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { void run(); }, { once: true });
      } else {
        void run();
      }
    })();
  </script>`;
}

/**
 * Build @font-face style tags with fonts fully embedded as base64 data URIs.
 * This makes the HTML self-contained so Puppeteer needs zero external network requests
 * for fonts (avoids race conditions with Google Fonts CDN).
 *
 * - Local/global fonts: read from disk or fetch remote URL
 * - Google Fonts (no url): fetch CSS from Google APIs, then fetch each .woff2 file
 */
async function buildFontHtml(template: TemplateJSON, publicBase?: string): Promise<string> {
  const requestedFamilies = new Set<string>();

  for (const cf of template.theme.customFonts ?? []) {
    requestedFamilies.add(cf.family);
  }
  for (const block of template.blocks) {
    const fam = (block as { style?: { fontFamily?: string } }).style?.fontFamily;
    if (fam) requestedFamilies.add(fam);
  }
  const hf = template.theme.fonts.heading;
  const bf = template.theme.fonts.body;
  requestedFamilies.add(hf.family);
  requestedFamilies.add(bf.family);

  const requestedFamilyMap = new Map(
    [...requestedFamilies].map((family) => [family.trim().toLowerCase(), family])
  );

  const globalFonts = await listFontAssetsByFamilies([...requestedFamilies]);
  // Map<family, FontEntry[]> for local files; null means Google Font (no local file)
  type FontEntry = { url: string; weight: number; fontStyle: string };
  const collected = new Map<string, FontEntry[] | null>();

  for (const font of globalFonts) {
    const requestedFamily = requestedFamilyMap.get(font.family.trim().toLowerCase()) ?? font.family;
    const entries = collected.get(requestedFamily) ?? [];
    entries.push({ url: font.url, weight: font.weight, fontStyle: font.fontStyle ?? "normal" });
    collected.set(requestedFamily, entries);
  }
  for (const cf of template.theme.customFonts ?? []) {
    if (!collected.has(cf.family)) {
      collected.set(cf.family, cf.url ? [{ url: cf.url, weight: 400, fontStyle: "normal" }] : null);
    }
  }
  if (!collected.has(hf.family)) collected.set(hf.family, hf.url ? [{ url: hf.url, weight: 400, fontStyle: "normal" }] : null);
  if (!collected.has(bf.family)) collected.set(bf.family, bf.url ? [{ url: bf.url, weight: 400, fontStyle: "normal" }] : null);
  for (const family of requestedFamilies) {
    if (!collected.has(family)) collected.set(family, null);
  }

  const styleParts: string[] = [];
  console.log(`[buildFontHtml] Collected fonts:`, [...collected.entries()].map(([f, e]) => `${f} → ${e ? e.map((x) => `${x.weight}w`).join(",") : "(google)"}`));

  const mimeMap: Record<string, string> = {
    woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf",
  };
  const formatMap: Record<string, string> = {
    woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype",
  };

  for (const [family, entries] of collected) {
    if (entries && entries.length > 0) {
      for (const { url, weight, fontStyle } of entries) {
        try {
          const buf = await loadFontBuffer(url, publicBase);
          const b64 = buf.toString("base64");
          const ext = url.split(".").pop()?.toLowerCase() ?? "woff2";
          const mime = mimeMap[ext] ?? "font/woff2";
          const fmt = formatMap[ext] ?? "woff2";
          styleParts.push(
            `@font-face{font-family:'${family}';src:url('data:${mime};base64,${b64}') format('${fmt}');font-weight:${weight};font-style:${fontStyle};}`
          );
          console.log(`[buildFontHtml] Embedded font "${family}" weight ${weight} style ${fontStyle} from ${url} (${Math.round(buf.length / 1024)} KB)`);
        } catch (e) {
          console.warn(`[buildFontHtml] Could not embed font "${family}" weight ${weight} style ${fontStyle} (${url}):`, e);
        }
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

async function loadFontBuffer(url: string, publicBase?: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(url)) {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  const { readFile } = await import("fs/promises");
  const { join } = await import("path");

  if (url.startsWith("file://")) {
    return readFile(url.replace("file://", ""));
  }

  if (publicBase?.startsWith("file://") && !url.startsWith("/")) {
    return readFile(url);
  }

  const relative = url.startsWith("/") ? url.slice(1) : url;
  return readFile(join(process.cwd(), "public", relative));
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
    [data-timing-hidden="true"] {
      visibility: hidden !important;
      pointer-events: none !important;
    }
    .block-text {
      overflow: hidden;
      word-break: break-word;
    }
    /* Per-line background mode: allow blur to expand beyond block bounds */
    .block-text-per-line {
      overflow: visible;
    }
    .block-image img {
      width: 100%;
      height: 100%;
      display: block;
      image-rendering: high-quality;
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

function buildPerLineTextGooFilterMarkup(template: TemplateJSON): string {
  const radiiByFilterId = new Map<string, number>();

  for (const block of template.blocks) {
    if (block.type !== "text") continue;
    if (!isTextBackgroundEnabled(block.style)) continue;
    if (getTextBackgroundMode(block.style) !== "per-line") continue;

    const backgroundRadius = getTextBackgroundBorderRadius(block.style);
    if (!shouldApplyPerLineTextGoo(backgroundRadius)) continue;

    const filterId = getPerLineTextGooFilterId(backgroundRadius);
    if (!radiiByFilterId.has(filterId)) {
      radiiByFilterId.set(filterId, backgroundRadius);
    }
  }

  const filters = [...radiiByFilterId.entries()]
    .map(([filterId, backgroundRadius]) => `<filter id="${filterId}" color-interpolation-filters="${PER_LINE_TEXT_GOO_COLOR_INTERPOLATION}" x="${PER_LINE_TEXT_GOO_FILTER_REGION.x}" y="${PER_LINE_TEXT_GOO_FILTER_REGION.y}" width="${PER_LINE_TEXT_GOO_FILTER_REGION.width}" height="${PER_LINE_TEXT_GOO_FILTER_REGION.height}"><feGaussianBlur in="SourceGraphic" stdDeviation="${getPerLineTextGooFilterBlur(backgroundRadius)}" result="blur"/><feColorMatrix in="blur" type="matrix" values="${PER_LINE_TEXT_GOO_COLOR_MATRIX}" result="goo"/><feComponentTransfer in="goo" result="gooSolid"><feFuncA type="linear" slope="${PER_LINE_TEXT_GOO_ALPHA_SLOPE}" intercept="${PER_LINE_TEXT_GOO_ALPHA_INTERCEPT}"/></feComponentTransfer><feComposite in="SourceGraphic" in2="gooSolid" operator="atop"/></filter>`)
    .join("");

  return `<svg width="0" height="0" style="position:absolute;overflow:hidden" aria-hidden="true"><defs>${filters}</defs></svg>`;
}
