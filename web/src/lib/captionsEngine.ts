type CaptionsEngine = "ass" | "cairo";
type LineHeightMode = "fixed_box" | "painted_gap";

const CAIRO_COMPATIBLE_PRESETS = new Set(["none", "appear"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function toBool(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return defaultValue;
}

function resolveAnimationPreset(configData: Record<string, unknown>): string {
  const animation = configData.animation;
  if (typeof animation === "string" && animation.trim()) {
    return animation.trim().toLowerCase();
  }

  const animationConfig = asRecord(animation);
  const preset = animationConfig?.preset;
  if (typeof preset === "string" && preset.trim()) {
    return preset.trim().toLowerCase();
  }

  return "reveal";
}

export function inferCaptionsEngine(_configData: Record<string, unknown>): CaptionsEngine {
  return "ass";
}

function normalizeLineHeightMode(layout: Record<string, unknown> | null, engine: CaptionsEngine): Record<string, unknown> | null {
  if (engine !== "cairo") {
    return layout;
  }

  const explicitMode = typeof layout?.line_height_mode === "string" ? layout.line_height_mode.trim().toLowerCase() : "";
  if (explicitMode === "fixed_box" || explicitMode === "painted_gap") {
    return layout;
  }

  return {
    ...(layout ?? {}),
    line_height_mode: "fixed_box" satisfies LineHeightMode,
  };
}

export function normalizeCaptionConfig(configData: Record<string, unknown>): Record<string, unknown> {
  const engine = inferCaptionsEngine(configData);
  const layout = asRecord(configData.layout);
  const normalizedLayout = normalizeLineHeightMode(layout, engine);
  const needsEngine = configData.engine !== engine;
  const needsLayout = normalizedLayout !== layout;

  if (!needsEngine && !needsLayout) {
    return configData;
  }

  return {
    ...configData,
    engine,
    ...(needsLayout ? { layout: normalizedLayout } : {}),
  };
}