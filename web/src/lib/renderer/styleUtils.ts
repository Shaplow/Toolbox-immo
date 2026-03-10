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
  if (style.color)          parts.push(`color:${style.color}`);
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
