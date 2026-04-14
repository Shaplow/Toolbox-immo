export const PER_LINE_TEXT_GOO_FILTER_ID = "text-bg-goo";
export const PER_LINE_TEXT_GOO_STD_DEVIATION = 10;
export const PER_LINE_TEXT_GOO_COLOR_MATRIX = "1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 19 -9";
export const PER_LINE_TEXT_GOO_FILTER_REGION = {
  x: "-20%",
  y: "-20%",
  width: "140%",
  height: "140%",
} as const;

export function getPerLineTextGooBlur(scale = 1): number {
  return Math.max(0.001, PER_LINE_TEXT_GOO_STD_DEVIATION * scale);
}

export function getPerLineTextSideBridgeMetrics(borderRadius: number, sidePadding: number): {
  inset: number;
  width: number;
} {
  const safeRadius = Math.max(0, borderRadius);
  const safePadding = Math.max(0, sidePadding);
  if (safeRadius <= 0 && safePadding <= 0) {
    return { inset: 0, width: 0 };
  }

  const width = Math.max(
    safePadding,
    Math.min(Math.max(safeRadius, safePadding), safePadding + safeRadius * 0.45),
  );
  const inset = safeRadius > 0 ? Math.min(width, safeRadius * 0.6) : 0;
  return { inset, width };
}