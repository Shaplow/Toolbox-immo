import type { ShapeBlock, ShapeKind } from "@/types/template";
import { blockBaseStyle } from "../styleUtils";

const CLIP_PATHS: Record<ShapeKind, string> = {
  rectangle: "",
  circle:    "",
  triangle:  "polygon(50% 0%, 0% 100%, 100% 100%)",
  diamond:   "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
};

export function renderShapeBlock(block: ShapeBlock): string {
  const base = blockBaseStyle(block);
  const clip = CLIP_PATHS[block.shape];

  const borderRadius =
    block.shape === "circle"
      ? "50%"
      : `${block.borderRadius ?? 0}px`;

  const border =
    block.borderWidth && block.borderColor
      ? `border:${block.borderWidth}px solid ${block.borderColor};box-sizing:border-box;`
      : "";

  const clipStyle = clip ? `clip-path:${clip};` : "";
  const opacity   = block.opacity !== undefined ? `opacity:${block.opacity};` : "";

  return `<div class="block" style="${base}background:${block.fillColor};border-radius:${borderRadius};${border}${clipStyle}${opacity}"></div>`;
}
