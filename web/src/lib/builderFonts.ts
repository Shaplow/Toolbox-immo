import type { TemplateJSON } from "@/types/template";

export type BuilderFontEntry = {
  family: string;
  url?: string;
  source: "global" | "template" | "derived";
};

export type BuilderFontSources = {
  customFonts?: TemplateJSON["theme"]["customFonts"];
  headingFont: TemplateJSON["theme"]["fonts"]["heading"];
  bodyFont: TemplateJSON["theme"]["fonts"]["body"];
  blockFontFamilies: Array<string | undefined>;
};

/**
 * Mot-clé `format()` d'un @font-face à partir de l'URL/extension du fichier.
 * Source unique pour TOUS les émetteurs @font-face (builder live + buildHTML)
 * afin d'éviter le drift : sans ce hint, Chrome charge les .ttf mais refuse
 * les .otf. Défaut woff2 (les URLs FontAsset ont toujours une extension valide).
 */
export function fontFormatFromUrl(url: string): string {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  switch (ext) {
    case "woff2": return "woff2";
    case "woff": return "woff";
    case "ttf": return "truetype";
    case "otf": return "opentype";
    default: return "woff2";
  }
}

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

export function collectBuilderFontsFromSources(
  sources: BuilderFontSources,
  globalFonts: BuilderFontEntry[] = []
): BuilderFontEntry[] {
  const collected = new Map<string, BuilderFontEntry>();

  for (const font of globalFonts) {
    mergeFontEntry(collected, { ...font, source: "global" });
  }

  for (const font of sources.customFonts ?? []) {
    mergeFontEntry(collected, { family: font.family, url: font.url, source: "template" });
  }

  for (const font of [sources.headingFont, sources.bodyFont]) {
    mergeFontEntry(collected, { family: font.family, url: font.url, source: "derived" });
  }

  for (const family of sources.blockFontFamilies) {
    if (family) {
      mergeFontEntry(collected, { family, source: "derived" });
    }
  }

  return [...collected.values()].sort((a, b) => a.family.localeCompare(b.family, "fr", { sensitivity: "base" }));
}

export function collectBuilderFonts(template: TemplateJSON, globalFonts: BuilderFontEntry[] = []): BuilderFontEntry[] {
  return collectBuilderFontsFromSources(
    {
      customFonts: template.theme.customFonts,
      headingFont: template.theme.fonts.heading,
      bodyFont: template.theme.fonts.body,
      blockFontFamilies: template.blocks.map((block) => (block as { style?: { fontFamily?: string } }).style?.fontFamily),
    },
    globalFonts
  );
}