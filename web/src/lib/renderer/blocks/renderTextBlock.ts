import type { SchemaField, TextBlock } from "@/types/template";
import type { ListingData } from "@/types/listing";
import { formatPrice } from "@/types/listing";
import { compileTextTemplate, resolveTextTemplate } from "@/lib/textTemplate";
import { formatConfiguredNumber, toFlexibleNumber } from "@/lib/numberFormatting";
import { getPerLineTextSideBridgeMetrics, PER_LINE_TEXT_GOO_FILTER_ID } from "@/lib/perLineTextBackground";
import { getTextBackgroundBorderRadius, getTextBackgroundMode, getTextBackgroundPadding, getTextBackgroundSize, getTextContentPadding, isTextBackgroundEnabled } from "@/lib/textBackground";
import { blockBaseStyle, buildTextShadowValue } from "../styleUtils";

export function renderTextBlock(
  block: TextBlock,
  listing: ListingData,
  schema?: SchemaField[],
  _options?: { autoLayout?: boolean }
): string {
  void _options;
  let text = "";
  const resolvedContent = block.content ?? (block.contentSegments ? compileTextTemplate(block.contentSegments) : undefined);

  if (resolvedContent !== undefined) {
    text = resolveTextTemplate(resolvedContent, listing, schema);
  } else if (block.binding) {
    // Backward compat: single binding
    const raw = listing[block.binding];
    const numericValue = toFlexibleNumber(raw);
    if (block.binding === "price_eur" && numericValue !== null) {
      text = formatPrice(numericValue);
    } else if (numericValue !== null) {
      const field = schema?.find((item) => item.key === block.binding);
      text = field?.type === "number"
        ? (formatConfiguredNumber(raw, {
            formatThousands: field.formatThousands,
            decimalSeparator: field.decimalSeparator,
          }) ?? String(raw))
        : String(raw);
    } else {
      text = String(raw ?? "");
    }
  } else {
    text = block.staticText ?? "";
  }

  const { rules, style } = block;
  const vAlign = style.verticalAlign ?? "top";
  const justifyContent =
    vAlign === "middle" ? "center" : vAlign === "bottom" ? "flex-end" : "flex-start";
  const backgroundEnabled = isTextBackgroundEnabled(style);
  const backgroundMode = getTextBackgroundMode(style);
  const backgroundSize = getTextBackgroundSize(style, block.w, block.h);
  const contentPadding = getTextContentPadding(style);
  const backgroundPadding = getTextBackgroundPadding(style);
  const backgroundRadius = getTextBackgroundBorderRadius(style);

  // Outer div: handles position and vertical placement inside the text block.
  const outerParts: string[] = [
    blockBaseStyle(block),
    `display:flex;flex-direction:column;justify-content:${justifyContent}`,
  ];
  const outerStyle = outerParts.join(";");

  // Inner div: handles typography, padding, line-clamp.
  const innerParts: string[] = [];
  if (style.fontFamily)  innerParts.push(`font-family:'${style.fontFamily}',sans-serif`);
  if (style.fontSize)    innerParts.push(`font-size:${style.fontSize}pt`);
  if (style.fontWeight)  innerParts.push(`font-weight:${style.fontWeight}`);
  if (style.color)       innerParts.push(`color:${style.color}`);
  if (style.letterSpacing !== undefined) innerParts.push(`letter-spacing:${style.letterSpacing}px`);
  const textShadow = buildTextShadowValue(style);
  if (textShadow)        innerParts.push(`text-shadow:${textShadow}`);
  if (style.textAlign)   innerParts.push(`text-align:${style.textAlign}`);
  if (contentPadding.top === contentPadding.right && contentPadding.top === contentPadding.bottom && contentPadding.top === contentPadding.left) {
    if (contentPadding.top > 0) innerParts.push(`padding:${contentPadding.top}px`);
  } else {
    if (contentPadding.top > 0) innerParts.push(`padding-top:${contentPadding.top}px`);
    if (contentPadding.right > 0) innerParts.push(`padding-right:${contentPadding.right}px`);
    if (contentPadding.bottom > 0) innerParts.push(`padding-bottom:${contentPadding.bottom}px`);
    if (contentPadding.left > 0) innerParts.push(`padding-left:${contentPadding.left}px`);
  }

  if (rules.maxLines) {
    innerParts.push(
      `display:-webkit-box;-webkit-line-clamp:${rules.maxLines};-webkit-box-orient:vertical;overflow:hidden`
    );
  }
  if (rules.uppercase) innerParts.push("text-transform:uppercase");
  innerParts.push("line-height:normal");
  innerParts.push("white-space:pre-wrap");
  innerParts.push("box-sizing:border-box");
  if (backgroundEnabled && backgroundMode === "fixed") innerParts.push("width:100%");

  const innerStyle = innerParts.join(";");

  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // ── No background ──────────────────────────────────────────────────────────
  if (!backgroundEnabled) {
    const plainStyle = style.opacity !== undefined ? `opacity:${style.opacity}` : "";
    return `<div class="block block-text" data-text-background-mode="none" data-shrink-to-fit="${rules.shrinkToFit && rules.minFontSize ? "true" : "false"}" data-min-font-size="${rules.minFontSize ?? ""}" style="${outerStyle}"><div style="${plainStyle}"><div class="block-text-content" style="${innerStyle}">${escaped}</div></div></div>`;
  }

  // Background box is always horizontally centered in the block frame.
  // Text alignment within the box is controlled separately via innerStyle (text-align).
  const alignStyle = `width:100%;display:flex;justify-content:center`;

  // ── Per-line mode ──────────────────────────────────────────────────────────
  if (backgroundMode === "per-line") {
    const spanParts: string[] = [];
    const textAlign = style.textAlign ?? "left";
    const backgroundColor = style.backgroundColor ?? "#FFFFFF";
    const bridgeMetrics = textAlign === "left"
      ? getPerLineTextSideBridgeMetrics(backgroundRadius, backgroundPadding.left)
      : textAlign === "right"
        ? getPerLineTextSideBridgeMetrics(backgroundRadius, backgroundPadding.right)
        : { inset: 0, width: 0 };
    if (style.fontFamily) spanParts.push(`font-family:'${style.fontFamily}',sans-serif`);
    if (style.fontSize) spanParts.push(`font-size:${style.fontSize}pt`);
    if (style.fontWeight) spanParts.push(`font-weight:${style.fontWeight}`);
    if (style.color) spanParts.push(`color:${style.color}`);
    if (style.letterSpacing !== undefined) spanParts.push(`letter-spacing:${style.letterSpacing}px`);
    const textShadowPL = buildTextShadowValue(style);
    if (textShadowPL) spanParts.push(`text-shadow:${textShadowPL}`);
    if (style.textAlign) spanParts.push(`text-align:${style.textAlign}`);
    if (rules.uppercase) spanParts.push("text-transform:uppercase");
    spanParts.push(`background-color:${backgroundColor}`);
    spanParts.push("display:inline");
    spanParts.push("box-decoration-break:clone");
    spanParts.push("-webkit-box-decoration-break:clone");
    spanParts.push("white-space:pre-wrap");
    spanParts.push("box-sizing:border-box");
    if (backgroundRadius > 0) spanParts.push(`border-radius:${backgroundRadius}px`);
    if (style.opacity !== undefined) spanParts.push(`opacity:${style.opacity}`);

    const vPad = backgroundPadding.top + backgroundPadding.bottom;
    if (vPad > 0) spanParts.push(`line-height:calc(1em + ${vPad}px)`);
    if (backgroundPadding.top === backgroundPadding.right && backgroundPadding.top === backgroundPadding.bottom && backgroundPadding.top === backgroundPadding.left) {
      if (backgroundPadding.top > 0) spanParts.push(`padding:${backgroundPadding.top}px`);
    } else {
      if (backgroundPadding.top > 0) spanParts.push(`padding-top:${backgroundPadding.top}px`);
      if (backgroundPadding.right > 0) spanParts.push(`padding-right:${backgroundPadding.right}px`);
      if (backgroundPadding.bottom > 0) spanParts.push(`padding-bottom:${backgroundPadding.bottom}px`);
      if (backgroundPadding.left > 0) spanParts.push(`padding-left:${backgroundPadding.left}px`);
    }

    const spanStyle = spanParts.join(";");
    const textStyle = "position:relative";
    const wrapperStyle = `width:100%;position:relative;text-align:${textAlign};filter:url(#${PER_LINE_TEXT_GOO_FILTER_ID});overflow:visible`;
    const bridgeStyle = bridgeMetrics.width > 0
      ? [
          "position:absolute",
          `top:${bridgeMetrics.inset}px`,
          `bottom:${bridgeMetrics.inset}px`,
          `width:${bridgeMetrics.width}px`,
          `background-color:${backgroundColor}`,
          textAlign === "left" ? "left:0" : "right:0",
        ].join(";")
      : "";

    return `<div class="block block-text block-text-per-line" data-text-background-mode="per-line" data-shrink-to-fit="${rules.shrinkToFit && rules.minFontSize ? "true" : "false"}" data-min-font-size="${rules.minFontSize ?? ""}" style="${outerStyle}"><div class="block-text-align" style="${wrapperStyle}">${bridgeStyle ? `<span aria-hidden="true" style="${bridgeStyle}"></span>` : ""}<span class="block-text-background block-text-content text-bg-per-line" style="${spanStyle}"><span style="${textStyle}">${escaped}</span></span></div></div>`;
  }

  // ── Fit / Fixed modes ──────────────────────────────────────────────────────
  const backgroundParts: string[] = [
    `background-color:${style.backgroundColor ?? "#FFFFFF"}`,
    `display:${backgroundMode === "fixed" ? "flex" : "inline-flex"}`,
    "flex-direction:column",
    "max-width:100%",
    "max-height:100%",
    "overflow:hidden",
  ];
  if (backgroundRadius > 0) backgroundParts.push(`border-radius:${backgroundRadius}px`);
  if (style.opacity !== undefined) backgroundParts.push(`opacity:${style.opacity}`);
  backgroundParts.push("box-sizing:border-box");

  if (backgroundMode === "fixed") {
    backgroundParts.push(`justify-content:${justifyContent}`);
    backgroundParts.push(`width:${backgroundSize.width}px`);
    backgroundParts.push(`height:${backgroundSize.height}px`);
  } else {
    backgroundParts.push("width:fit-content");
  }
  if (backgroundPadding.top === backgroundPadding.right && backgroundPadding.top === backgroundPadding.bottom && backgroundPadding.top === backgroundPadding.left) {
    if (backgroundPadding.top > 0) backgroundParts.push(`padding:${backgroundPadding.top}px`);
  } else {
    if (backgroundPadding.top > 0) backgroundParts.push(`padding-top:${backgroundPadding.top}px`);
    if (backgroundPadding.right > 0) backgroundParts.push(`padding-right:${backgroundPadding.right}px`);
    if (backgroundPadding.bottom > 0) backgroundParts.push(`padding-bottom:${backgroundPadding.bottom}px`);
    if (backgroundPadding.left > 0) backgroundParts.push(`padding-left:${backgroundPadding.left}px`);
  }

  const backgroundStyle = backgroundParts.join(";");

  return `<div class="block block-text" data-text-background-mode="${backgroundMode}" data-shrink-to-fit="${rules.shrinkToFit && rules.minFontSize ? "true" : "false"}" data-min-font-size="${rules.minFontSize ?? ""}" style="${outerStyle}"><div class="block-text-align" style="${alignStyle}"><div class="block-text-background" style="${backgroundStyle}"><div class="block-text-content" style="${innerStyle}">${escaped}</div></div></div></div>`;
}
