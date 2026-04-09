import type { TemplateJSON } from "@/types/template";

export type BuilderFontEntry = {
  family: string;
  url?: string;
  source: "global" | "template" | "derived";
};

function mergeFontEntry(collected: Map<string, BuilderFontEntry>, next: BuilderFontEntry) {
  const existing = collected.get(next.family);
  if (!existing) {
    collected.set(next.family, next);
    return;
  }

  collected.set(next.family, {
    family: next.family,
    url: existing.url ?? next.url,
    source:
      existing.source === "global" || next.source === "global"
        ? "global"
        : existing.source === "template" || next.source === "template"
          ? "template"
          : "derived",
  });
}

export function collectBuilderFonts(template: TemplateJSON, globalFonts: BuilderFontEntry[] = []): BuilderFontEntry[] {
  const collected = new Map<string, BuilderFontEntry>();

  for (const font of globalFonts) {
    mergeFontEntry(collected, { ...font, source: "global" });
  }

  for (const font of template.theme.customFonts ?? []) {
    mergeFontEntry(collected, { family: font.family, url: font.url, source: "template" });
  }

  for (const font of [template.theme.fonts.heading, template.theme.fonts.body]) {
    mergeFontEntry(collected, { family: font.family, url: font.url, source: "derived" });
  }

  for (const block of template.blocks) {
    const family = (block as { style?: { fontFamily?: string } }).style?.fontFamily;
    if (family) {
      mergeFontEntry(collected, { family, source: "derived" });
    }
  }

  return [...collected.values()].sort((a, b) => a.family.localeCompare(b.family, "fr", { sensitivity: "base" }));
}