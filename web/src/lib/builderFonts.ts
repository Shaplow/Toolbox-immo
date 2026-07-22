import type { TemplateJSON } from "@/types/template";

export type BuilderFontEntry = {
  family: string;
  url?: string;
  /**
   * Poids réellement référencés par le template (blocs + heading/body). Sert à ne
   * demander à Google QUE des poids existants (le blanket 300;400;500;600;700 faisait
   * échouer la requête entière quand une police n'avait pas les 5 poids).
   */
  weights?: number[];
  source: "global" | "template" | "derived";
};

export type BuilderFontSources = {
  customFonts?: TemplateJSON["theme"]["customFonts"];
  headingFont: TemplateJSON["theme"]["fonts"]["heading"];
  bodyFont: TemplateJSON["theme"]["fonts"]["body"];
  blockFonts: Array<{ family?: string; weight?: number }>;
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

function mergeWeights(a?: number[], b?: number[]): number[] | undefined {
  if (!a?.length && !b?.length) return undefined;
  return [...new Set([...(a ?? []), ...(b ?? [])])].sort((x, y) => x - y);
}

function mergeFontEntry(collected: Map<string, BuilderFontEntry>, next: BuilderFontEntry) {
  const existing = collected.get(next.family);
  if (!existing) {
    collected.set(next.family, { ...next, weights: mergeWeights(next.weights) });
    return;
  }

  collected.set(next.family, {
    family: next.family,
    url: existing.url ?? next.url,
    weights: mergeWeights(existing.weights, next.weights),
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
    mergeFontEntry(collected, { family: font.family, url: font.url, weights: font.weights, source: "derived" });
  }

  for (const { family, weight } of sources.blockFonts) {
    if (family) {
      mergeFontEntry(collected, { family, weights: weight != null ? [weight] : undefined, source: "derived" });
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
      blockFonts: template.blocks.map((block) => {
        const style = (block as { style?: { fontFamily?: string; fontWeight?: number } }).style;
        return { family: style?.fontFamily, weight: style?.fontWeight };
      }),
    },
    globalFonts
  );
}

/**
 * Poids Google à demander pour une famille : 400 (aperçu du sélecteur) + poids
 * réellement utilisés, triés/dédupliqués. On ne demande jamais 300;500;600 « au cas où »
 * (beaucoup de polices display ne les ont pas → HTTP 400 → police non chargée).
 */
export function googleFontWeights(weights?: number[]): number[] {
  return [...new Set([400, ...(weights ?? [])])].sort((a, b) => a - b);
}

/**
 * URL css2 pour UNE famille Google, isolée. Un `<link>` par famille : si Google
 * renvoie 400 (poids inexistant, nom invalide), seule cette police est affectée —
 * les autres continuent de charger (fix « certaines typos ne s'affichent pas »).
 */
export function googleFontCssUrl(family: string, weights?: number[]): string {
  const wght = googleFontWeights(weights).join(";");
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${wght}&display=swap`;
}