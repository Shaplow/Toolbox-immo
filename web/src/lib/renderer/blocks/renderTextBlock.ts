import type { SchemaField, TextBlock } from "@/types/template";
import type { ListingData } from "@/types/listing";
import { formatPrice } from "@/types/listing";
import { compileTextTemplate, resolveTextTemplate } from "@/lib/textTemplate";
import { formatConfiguredNumber, toFlexibleNumber } from "@/lib/numberFormatting";
import { getHorizontalAlignment, getTextBackgroundBorderRadius, getTextBackgroundMode, getTextBackgroundPadding, getTextBackgroundSize, getTextContentPadding, isTextBackgroundEnabled } from "@/lib/textBackground";
import { blockBaseStyle, buildTextShadowValue } from "../styleUtils";

export function renderTextBlock(
  block: TextBlock,
  listing: ListingData,
  schema?: SchemaField[],
  options?: { autoLayout?: boolean }
): string {
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
  const horizontalAlignment = getHorizontalAlignment(style.textAlign);
  const autoLayout = options?.autoLayout ?? false;

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

  if (!backgroundEnabled) {
    const plainStyle = style.opacity !== undefined ? `opacity:${style.opacity}` : "";
    return `<div class="block block-text" data-shrink-to-fit="${rules.shrinkToFit && rules.minFontSize ? "true" : "false"}" data-min-font-size="${rules.minFontSize ?? ""}" style="${outerStyle}"><div style="${plainStyle}"><div class="block-text-content" style="${innerStyle}">${escaped}</div></div></div>`;
  }

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
  const alignStyle = `width:100%;display:flex;justify-content:${horizontalAlignment}`;

  return `<div class="block block-text" data-shrink-to-fit="${rules.shrinkToFit && rules.minFontSize ? "true" : "false"}" data-min-font-size="${rules.minFontSize ?? ""}" style="${outerStyle}"><div class="block-text-align" style="${alignStyle}"><div class="block-text-background" style="${backgroundStyle}"><div class="block-text-content" style="${innerStyle}">${escaped}</div></div></div></div>`;
}
