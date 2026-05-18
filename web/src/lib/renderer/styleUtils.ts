import type { BaseBlock, BlockStyle } from "@/types/template";

export function blockBaseStyle(block: BaseBlock): string {
  const rotate = block.rotation ? `transform:rotate(${block.rotation}deg);transform-origin:center center;` : "";
  return `left:${block.x}px;top:${block.y}px;width:${block.w}px;height:${block.h}px;z-index:${block.z};${rotate}`;
}

export function blockStyleToCSS(style: BlockStyle): string {
  const parts: string[] = [];
  if (style.fontFamily)     parts.push(`font-family:'${style.fontFamily}',sans-serif`);
  if (style.fontSize)       parts.push(`font-size:${style.fontSize}pt`);
  if (style.fontWeight)     parts.push(`font-weight:${style.fontWeight}`);
  if (style.fontStyle)      parts.push(`font-style:${style.fontStyle}`);
  if (style.color)          parts.push(`color:${style.color}`);
  if (style.letterSpacing !== undefined) parts.push(`letter-spacing:${style.letterSpacing}px`);
  const textShadow = buildTextShadowValue(style);
  if (textShadow)           parts.push(`text-shadow:${textShadow}`);
  if (style.backgroundColor) parts.push(`background-color:${style.backgroundColor}`);
  if (style.borderRadius)   parts.push(`border-radius:${style.borderRadius}px`);
  if (style.textAlign)      parts.push(`text-align:${style.textAlign}`);
  if (style.opacity !== undefined) parts.push(`opacity:${style.opacity}`);

  // Padding
  if (style.padding !== undefined) {
    parts.push(`padding:${style.padding}px`);
  } else {
    if (style.paddingTop    !== undefined) parts.push(`padding-top:${style.paddingTop}px`);
    if (style.paddingRight  !== undefined) parts.push(`padding-right:${style.paddingRight}px`);
    if (style.paddingBottom !== undefined) parts.push(`padding-bottom:${style.paddingBottom}px`);
    if (style.paddingLeft   !== undefined) parts.push(`padding-left:${style.paddingLeft}px`);
  }

  return parts.join(";");
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "").trim();
  const safeAlpha = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;

  if (normalized.length !== 3 && normalized.length !== 6) {
    return `rgba(0,0,0,${safeAlpha})`;
  }

  const full = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized;

  const red = parseInt(full.slice(0, 2), 16);
  const green = parseInt(full.slice(2, 4), 16);
  const blue = parseInt(full.slice(4, 6), 16);

  if ([red, green, blue].some((value) => Number.isNaN(value))) {
    return `rgba(0,0,0,${safeAlpha})`;
  }

  return `rgba(${red},${green},${blue},${safeAlpha})`;
}

export function buildTextShadowValue(style: BlockStyle, scale = 1): string | undefined {
  if (!style.textShadowEnabled) return undefined;

  const color = style.textShadowColor ?? "#000000";
  const opacity = style.textShadowOpacity ?? 0.35;
  const safeScale = Number.isFinite(scale) ? Math.max(0, scale) : 1;
  const blur = Math.max(0, style.textShadowBlur ?? 0) * safeScale;
  const distance = Math.max(0, style.textShadowDistance ?? 0) * safeScale;
  const angle = style.textShadowAngle ?? 90;
  const normalizedAngle = ((angle % 360) + 360) % 360;

  let offsetX = 0;
  let offsetY = 0;
  if (distance > 0 && normalizedAngle !== 0) {
    const radians = angle * (Math.PI / 180);
    offsetX = Math.cos(radians) * distance;
    offsetY = Math.sin(radians) * distance;
  }

  return `${offsetX.toFixed(2)}px ${offsetY.toFixed(2)}px ${blur.toFixed(2)}px ${hexToRgba(color, opacity)}`;
}
