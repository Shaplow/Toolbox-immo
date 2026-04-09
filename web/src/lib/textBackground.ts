import type { BlockStyle } from "@/types/template";

export interface BoxPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function normalizePadding(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value ?? 0);
}

function buildPadding(
  uniform: number | undefined,
  top: number | undefined,
  right: number | undefined,
  bottom: number | undefined,
  left: number | undefined,
): BoxPadding {
  if (uniform !== undefined) {
    const resolved = normalizePadding(uniform);
    return { top: resolved, right: resolved, bottom: resolved, left: resolved };
  }

  return {
    top: normalizePadding(top),
    right: normalizePadding(right),
    bottom: normalizePadding(bottom),
    left: normalizePadding(left),
  };
}

export function getTextContentPadding(style: BlockStyle): BoxPadding {
  return buildPadding(style.padding, style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft);
}

export function getTextBackgroundPadding(style: BlockStyle): BoxPadding {
  const hasBackgroundPadding =
    style.textBackgroundPadding !== undefined ||
    style.textBackgroundPaddingTop !== undefined ||
    style.textBackgroundPaddingRight !== undefined ||
    style.textBackgroundPaddingBottom !== undefined ||
    style.textBackgroundPaddingLeft !== undefined;

  if (!hasBackgroundPadding) return getTextContentPadding(style);

  return buildPadding(
    style.textBackgroundPadding,
    style.textBackgroundPaddingTop,
    style.textBackgroundPaddingRight,
    style.textBackgroundPaddingBottom,
    style.textBackgroundPaddingLeft,
  );
}

export function getEffectiveTextAnchorPadding(style: BlockStyle): BoxPadding {
  const contentPadding = getTextContentPadding(style);
  if (!isTextBackgroundEnabled(style)) return contentPadding;

  const backgroundPadding = getTextBackgroundPadding(style);
  return {
    top: contentPadding.top + backgroundPadding.top,
    right: contentPadding.right + backgroundPadding.right,
    bottom: contentPadding.bottom + backgroundPadding.bottom,
    left: contentPadding.left + backgroundPadding.left,
  };
}

export function getTextBackgroundBorderRadius(style: BlockStyle): number {
  if (style.textBackgroundBorderRadius !== undefined) {
    return Math.max(0, style.textBackgroundBorderRadius);
  }

  return Math.max(0, style.borderRadius ?? 0);
}

export function isTextBackgroundEnabled(style: BlockStyle): boolean {
  return style.textBackgroundEnabled ?? Boolean(style.backgroundColor);
}

export function getTextBackgroundMode(style: BlockStyle): "fit" | "fixed" {
  return style.textBackgroundMode ?? "fit";
}

export function getTextBackgroundSize(style: BlockStyle, fallbackWidth: number, fallbackHeight: number): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(0, style.textBackgroundWidth ?? fallbackWidth),
    height: Math.max(0, style.textBackgroundHeight ?? fallbackHeight),
  };
}

export function getHorizontalAlignment(textAlign: BlockStyle["textAlign"]): "flex-start" | "center" | "flex-end" {
  if (textAlign === "center") return "center";
  if (textAlign === "right") return "flex-end";
  return "flex-start";
}