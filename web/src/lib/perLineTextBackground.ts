export const PER_LINE_TEXT_GOO_FILTER_ID = "text-bg-goo";
export const PER_LINE_TEXT_GOO_COLOR_INTERPOLATION = "sRGB" as const;
export const PER_LINE_TEXT_GOO_STD_DEVIATION = 10;
export const PER_LINE_TEXT_GOO_COLOR_MATRIX = "1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 19 -9";
export const PER_LINE_TEXT_GOO_ALPHA_SLOPE = 1.35;
export const PER_LINE_TEXT_GOO_ALPHA_INTERCEPT = 0;
export const PER_LINE_TEXT_GOO_RADIUS_SCALE = 0.72;
export const PER_LINE_TEXT_GOO_FILTER_REGION = {
  x: "-20%",
  y: "-20%",
  width: "140%",
  height: "140%",
} as const;

const PER_LINE_TEXT_GOO_REFERENCE_RADIUS = 12;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function smoothstep01(value: number): number {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

export function getPerLineTextGooIntensity(borderRadius: number): number {
  const safeRadius = Math.max(0, borderRadius);
  if (safeRadius <= 0) return 0;
  return smoothstep01(safeRadius / PER_LINE_TEXT_GOO_REFERENCE_RADIUS);
}

export function getPerLineTextGooFilterId(borderRadius: number): string {
  const radiusToken = Math.round(Math.max(0, borderRadius) * 1000);
  return `${PER_LINE_TEXT_GOO_FILTER_ID}-${radiusToken}`;
}

export function shouldApplyPerLineTextGoo(borderRadius: number): boolean {
  const safeRadius = Math.max(0, borderRadius);
  return safeRadius > 0;
}

export function getPerLineTextGooFilterBlur(borderRadius: number, scale = 1): number {
  const safeRadius = Math.max(0, borderRadius);
  if (safeRadius <= 0) return 0;

  const intensity = getPerLineTextGooIntensity(safeRadius);
  const blur = Math.min(
    PER_LINE_TEXT_GOO_STD_DEVIATION,
    0.35 + safeRadius * (0.18 + 0.42 * intensity),
  );
  return Math.max(0.001, blur * scale);
}

export function getPerLineTextEffectiveRadius(borderRadius: number): number {
  const safeRadius = Math.max(0, borderRadius);
  if (safeRadius <= 0) return 0;

  const intensity = getPerLineTextGooIntensity(safeRadius);
  const radiusScale = 0.18 + (PER_LINE_TEXT_GOO_RADIUS_SCALE - 0.18) * intensity;
  return safeRadius * radiusScale;
}

export function getPerLineTextSideBridgeMetrics(borderRadius: number, sidePadding: number): {
  inset: number;
  width: number;
} {
  const safeRadius = Math.max(0, borderRadius);
  const safePadding = Math.max(0, sidePadding);
  if (safeRadius <= 0) {
    return { inset: 0, width: 0 };
  }

  const intensity = getPerLineTextGooIntensity(safeRadius);
  const maxWidth = safePadding > 0 ? safePadding : safeRadius;
  const width = Math.min(maxWidth, safeRadius * (0.18 + 0.82 * intensity));
  const inset = Math.min(width * (0.35 + 0.1 * intensity), safeRadius * (0.25 + 0.25 * intensity));
  return { inset, width };
}