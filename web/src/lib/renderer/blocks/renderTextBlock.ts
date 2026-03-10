import type { TextBlock } from "@/types/template";
import type { ListingData } from "@/types/listing";
import { formatPrice } from "@/types/listing";
import { blockBaseStyle } from "../styleUtils";

export function renderTextBlock(block: TextBlock, listing: ListingData): string {
  let text = "";

  if (block.content !== undefined) {
    // 1. Blocs conditionnels : {{#if champ == valeur}}...{{/if}}
    text = block.content.replace(
      /\{\{#if\s+(\w+)\s*==\s*"?([^"\}\s]+)"?\s*\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (_: string, field: string, value: string, inner: string) => {
        const actual = String((listing as Record<string, unknown>)[field] ?? "");
        return actual === value ? inner : "";
      }
    );
    // 2. Interpolation {{variable}}
    text = text.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => {
      const raw = (listing as Record<string, unknown>)[key];
      if (key === "price_eur" && typeof raw === "number") return formatPrice(raw);
      return String(raw ?? "");
    });
    // 3. Cleanup separator artifacts: "text -  - text" or "text - " or " - text"
    //    Split on " - ", trim each part, drop empty parts, rejoin
    text = text.split(" - ").map((s) => s.trim()).filter(Boolean).join(" - ");
  } else if (block.binding) {
    // Backward compat: single binding
    const raw = listing[block.binding];
    if (block.binding === "price_eur" && typeof raw === "number") {
      text = formatPrice(raw);
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

  // Outer div: handles position, size, background, flex vertical alignment
  const outerParts: string[] = [
    blockBaseStyle(block),
    `display:flex;flex-direction:column;justify-content:${justifyContent}`,
  ];
  if (style.backgroundColor) outerParts.push(`background-color:${style.backgroundColor}`);
  if (style.borderRadius)    outerParts.push(`border-radius:${style.borderRadius}px`);
  if (style.opacity !== undefined) outerParts.push(`opacity:${style.opacity}`);
  const outerStyle = outerParts.join(";");

  // Inner div: handles typography, padding, line-clamp
  const innerParts: string[] = [];
  if (style.fontFamily)  innerParts.push(`font-family:'${style.fontFamily}',sans-serif`);
  if (style.fontSize)    innerParts.push(`font-size:${style.fontSize}pt`);
  if (style.fontWeight)  innerParts.push(`font-weight:${style.fontWeight}`);
  if (style.color)       innerParts.push(`color:${style.color}`);
  if (style.textAlign)   innerParts.push(`text-align:${style.textAlign}`);
  if (style.padding !== undefined) {
    innerParts.push(`padding:${style.padding}px`);
  } else {
    if (style.paddingTop    !== undefined) innerParts.push(`padding-top:${style.paddingTop}px`);
    if (style.paddingRight  !== undefined) innerParts.push(`padding-right:${style.paddingRight}px`);
    if (style.paddingBottom !== undefined) innerParts.push(`padding-bottom:${style.paddingBottom}px`);
    if (style.paddingLeft   !== undefined) innerParts.push(`padding-left:${style.paddingLeft}px`);
  }

  if (rules.maxLines) {
    innerParts.push(
      `display:-webkit-box;-webkit-line-clamp:${rules.maxLines};-webkit-box-orient:vertical;overflow:hidden`
    );
  }
  if (rules.shrinkToFit && rules.minFontSize) {
    innerParts.push(
      `font-size:clamp(${rules.minFontSize}pt,${style.fontSize ?? 16}pt,${style.fontSize ?? 16}pt)`
    );
  }
  if (rules.uppercase) innerParts.push("text-transform:uppercase");

  const innerStyle = innerParts.join(";");

  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<div class="block block-text" style="${outerStyle}"><div style="${innerStyle}">${escaped}</div></div>`;
}
