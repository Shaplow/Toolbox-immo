import type { BoxPadding } from "@/lib/textBackground";
import type { BuilderFontEntry } from "@/lib/builderFonts";
import type { AnyBlock } from "@/types/template";

export function toUniformPaddingValue(values: BoxPadding): number {
  if (values.top === values.right && values.top === values.bottom && values.top === values.left) {
    return values.top;
  }
  return Math.round((values.top + values.right + values.bottom + values.left) / 4);
}

export function sourceLabel(source: BuilderFontEntry["source"]): string {
  if (source === "global") return "Globale";
  if (source === "template") return "Template";
  return "Detectee";
}

export function buildAnchoredSizeChange(target: AnyBlock, field: "w" | "h", rawValue: number): Partial<AnyBlock> {
  const nextValue = Math.max(0, Number.isFinite(rawValue) ? rawValue : 0);
  if (field === "w") {
    const delta = nextValue - target.w;
    return {
      w: nextValue,
      x: Math.round(target.x - delta / 2),
    } as Partial<AnyBlock>;
  }
  const delta = nextValue - target.h;
  return {
    h: nextValue,
    y: Math.round(target.y - delta / 2),
  } as Partial<AnyBlock>;
}
