/**
 * Tests sanity sur le rendu HTML d'un TextBlock — maxLines + shrinkToFit.
 *
 * Vérifie que :
 *  - rules.maxLines=N produit -webkit-line-clamp:N dans le HTML output
 *  - rules.shrinkToFit + minFontSize produit data-shrink-to-fit="true" et
 *    data-min-font-size sur le wrapper externe
 */

import { describe, it, expect } from "vitest";
import { renderTextBlock } from "../renderTextBlock";
import type { TextBlock } from "@/types/template";

function makeTextBlock(overrides: Partial<TextBlock> = {}): TextBlock {
  return {
    id: "tb-1",
    type: "text",
    name: "Test",
    x: 0,
    y: 0,
    w: 200,
    h: 100,
    rotation: 0,
    style: { fontSize: 14, color: "#000" },
    rules: {},
    content: "Hello world",
    ...overrides,
  };
}

describe("renderTextBlock — maxLines", () => {
  it("applies -webkit-line-clamp when rules.maxLines is set", () => {
    const block = makeTextBlock({ rules: { maxLines: 2 } });
    const html = renderTextBlock(block, "Hello world", undefined, false);
    expect(html).toContain("-webkit-line-clamp:2");
    expect(html).toContain("display:-webkit-box");
    expect(html).toContain("overflow:hidden");
  });

  it("does NOT apply line-clamp when rules.maxLines is undefined", () => {
    const block = makeTextBlock({ rules: {} });
    const html = renderTextBlock(block, "Hello world", undefined, false);
    expect(html).not.toContain("-webkit-line-clamp");
  });

  it("does NOT apply line-clamp when rules.maxLines is 0 (falsy)", () => {
    const block = makeTextBlock({ rules: { maxLines: 0 } });
    const html = renderTextBlock(block, "Hello world", undefined, false);
    expect(html).not.toContain("-webkit-line-clamp");
  });

  it("expose maxLines via data-max-lines (lu par le script shrink-to-fit)", () => {
    const block = makeTextBlock({ rules: { maxLines: 2 } });
    const html = renderTextBlock(block, "Hello world", undefined, false);
    expect(html).toContain('data-max-lines="2"');
  });

  it("data-max-lines vide quand maxLines absent", () => {
    const block = makeTextBlock({ rules: {} });
    const html = renderTextBlock(block, "Hello world", undefined, false);
    expect(html).toContain('data-max-lines=""');
  });
});

describe("renderTextBlock — shrinkToFit", () => {
  it("sets data-shrink-to-fit=true when shrinkToFit + minFontSize", () => {
    const block = makeTextBlock({ rules: { shrinkToFit: true, minFontSize: 8 } });
    const html = renderTextBlock(block, "Hello", undefined, false);
    expect(html).toContain('data-shrink-to-fit="true"');
    expect(html).toContain('data-min-font-size="8"');
  });

  it("sets data-shrink-to-fit=false when only shrinkToFit (no minFontSize)", () => {
    const block = makeTextBlock({ rules: { shrinkToFit: true } });
    const html = renderTextBlock(block, "Hello", undefined, false);
    expect(html).toContain('data-shrink-to-fit="false"');
  });

  it("sets data-shrink-to-fit=false when shrinkToFit is false", () => {
    const block = makeTextBlock({ rules: { shrinkToFit: false, minFontSize: 8 } });
    const html = renderTextBlock(block, "Hello", undefined, false);
    expect(html).toContain('data-shrink-to-fit="false"');
  });
});

describe("renderTextBlock — faux-gras (fauxBoldWidth)", () => {
  it("émet -webkit-text-stroke de la couleur du texte quand fauxBoldWidth > 0", () => {
    const block = makeTextBlock({ style: { fontSize: 14, color: "#ff0000", fauxBoldWidth: 2 } });
    const html = renderTextBlock(block, "Hello world", undefined, false);
    expect(html).toContain("-webkit-text-stroke:2.00px #ff0000");
  });

  it("n'émet PAS de -webkit-text-stroke quand fauxBoldWidth est absent", () => {
    const block = makeTextBlock({ style: { fontSize: 14, color: "#000" } });
    const html = renderTextBlock(block, "Hello world", undefined, false);
    expect(html).not.toContain("-webkit-text-stroke");
  });

  it("n'émet PAS de -webkit-text-stroke quand fauxBoldWidth = 0 (falsy)", () => {
    const block = makeTextBlock({ style: { fontSize: 14, color: "#000", fauxBoldWidth: 0 } });
    const html = renderTextBlock(block, "Hello world", undefined, false);
    expect(html).not.toContain("-webkit-text-stroke");
  });

  it("applique aussi le faux-gras sur le span en mode fond per-line", () => {
    const block = makeTextBlock({
      style: { fontSize: 14, color: "#222222", fauxBoldWidth: 1.5, textBackgroundEnabled: true, textBackgroundMode: "per-line", backgroundColor: "#fff" },
    });
    const html = renderTextBlock(block, "Hello world", undefined, false);
    expect(html).toContain("-webkit-text-stroke:1.50px #222222");
  });

  it("faux-gras NÉGATIF émet un filtre erode (et pas de stroke)", () => {
    const block = makeTextBlock({ style: { fontSize: 14, color: "#000", fauxBoldWidth: -1 } });
    const html = renderTextBlock(block, "Hello world", undefined, false);
    // radius = |−1| * 0.5 = 0.5 → id faux-thin-500
    expect(html).toContain("filter:url(#faux-thin-500)");
    expect(html).not.toContain("-webkit-text-stroke");
  });

  it("faux-gras POSITIF n'émet pas de filtre erode", () => {
    const block = makeTextBlock({ style: { fontSize: 14, color: "#000", fauxBoldWidth: 2 } });
    const html = renderTextBlock(block, "Hello world", undefined, false);
    expect(html).not.toContain("filter:url(#faux-thin");
  });

  it("faux-gras négatif en per-line : filtre erode sur le span texte interne", () => {
    const block = makeTextBlock({
      style: { fontSize: 14, color: "#000", fauxBoldWidth: -2, textBackgroundEnabled: true, textBackgroundMode: "per-line", backgroundColor: "#fff" },
    });
    const html = renderTextBlock(block, "Hello world", undefined, false);
    // radius = |−2| * 0.5 = 1.0 → id faux-thin-1000
    expect(html).toContain("filter:url(#faux-thin-1000)");
  });
});

describe("renderTextBlock — maxLines + shrinkToFit combined", () => {
  it("applies both line-clamp and data-shrink-to-fit when both set", () => {
    const block = makeTextBlock({
      rules: { maxLines: 3, shrinkToFit: true, minFontSize: 10 },
    });
    const html = renderTextBlock(block, "Long text", undefined, false);
    expect(html).toContain("-webkit-line-clamp:3");
    expect(html).toContain('data-shrink-to-fit="true"');
    expect(html).toContain('data-min-font-size="10"');
  });
});

describe("renderTextBlock — maxLines en text-background per-line (bugfix)", () => {
  it("applies -webkit-line-clamp on wrapper in per-line background mode", () => {
    const block = makeTextBlock({
      rules: { maxLines: 2 },
      style: {
        fontSize: 14,
        color: "#FFFFFF",
        backgroundColor: "#2C2EFF",
        textBackgroundEnabled: true,
        textBackgroundMode: "per-line",
      },
    });
    const html = renderTextBlock(block, "Trois lignes de texte", undefined, false);
    // Le wrapper block-text-align doit porter le clamp en per-line mode
    expect(html).toContain("block-text-per-line");
    expect(html).toContain("-webkit-line-clamp:2");
    expect(html).toContain("overflow:hidden");
  });

  it("keeps overflow:visible on wrapper when no maxLines in per-line mode", () => {
    const block = makeTextBlock({
      rules: {},
      style: {
        fontSize: 14,
        color: "#FFFFFF",
        backgroundColor: "#2C2EFF",
        textBackgroundEnabled: true,
        textBackgroundMode: "per-line",
      },
    });
    const html = renderTextBlock(block, "Trois lignes de texte", undefined, false);
    expect(html).toContain("block-text-per-line");
    expect(html).not.toContain("-webkit-line-clamp");
    expect(html).toContain("overflow:visible");
  });
});

describe("renderTextBlock — opacité texte + fond (réglages séparés)", () => {
  it("sans fond : applique opacity sur le texte quand textOpacity est défini", () => {
    const block = makeTextBlock({ style: { fontSize: 14, color: "#000", textOpacity: 0.3 } });
    const html = renderTextBlock(block, "Hello", undefined, false);
    expect(html).toContain("opacity:0.3");
  });

  it("sans fond : n'émet aucune opacity quand aucun réglage n'est défini", () => {
    const block = makeTextBlock({ style: { fontSize: 14, color: "#000" } });
    const html = renderTextBlock(block, "Hello", undefined, false);
    expect(html).not.toContain("opacity:");
    expect(html).not.toContain("rgba(");
  });

  it("fit : fond en rgba quand backgroundOpacity défini, texte opaque indépendant", () => {
    const block = makeTextBlock({
      style: {
        fontSize: 14,
        color: "#FFFFFF",
        backgroundColor: "#000000",
        textBackgroundEnabled: true,
        textBackgroundMode: "fit",
        backgroundOpacity: 0.4,
        textOpacity: 0.5,
      },
    });
    const html = renderTextBlock(block, "Hello", undefined, false);
    // Fond translucide via rgba (le texte ne fane pas avec)
    expect(html).toContain("background-color:rgba(0,0,0,0.4)");
    // Opacité du texte appliquée à part
    expect(html).toContain("opacity:0.5");
  });

  it("fit : fond en hex (pas de rgba) quand backgroundOpacity absent", () => {
    const block = makeTextBlock({
      style: {
        fontSize: 14,
        color: "#FFFFFF",
        backgroundColor: "#000000",
        textBackgroundEnabled: true,
        textBackgroundMode: "fit",
      },
    });
    const html = renderTextBlock(block, "Hello", undefined, false);
    expect(html).toContain("background-color:#000000");
    expect(html).not.toContain("rgba(");
  });

  it("per-line + arrondi + opacité fond < 1 : double couche (goo opaque + fondu, texte net)", () => {
    const block = makeTextBlock({
      style: {
        fontSize: 14,
        color: "#FFFFFF",
        backgroundColor: "#2C2EFF",
        textAlign: "left",
        textBackgroundEnabled: true,
        textBackgroundMode: "per-line",
        textBackgroundBorderRadius: 12,
        backgroundOpacity: 0.5,
        textOpacity: 0.6,
      },
    });
    const html = renderTextBlock(block, "Trois lignes de texte", undefined, false);
    // Deux couches distinctes
    expect(html).toContain("block-text-bg-layer");
    expect(html).toContain("block-text-fg-layer");
    // Fond : couleur PLEINE (hex, le goo a besoin d'un alpha plein), PAS de rgba.
    expect(html).toContain("background-color:#2C2EFF");
    expect(html).not.toContain("rgba(44,46,255,0.5)");
    // Goo + opacité de fond appliqués sur la couche fond.
    expect(html).toContain("filter:url(#text-bg-goo-12000)");
    expect(html).toContain("opacity:0.5");
    expect(html).toContain("color:transparent");
    // Texte : couleur visible + sa propre opacité, indépendant de l'opacité de fond.
    expect(html).toContain("color:#FFFFFF");
    expect(html).toContain("opacity:0.6");
  });

  it("per-line + arrondi OPAQUE : single couche inchangée (pas de double couche)", () => {
    const block = makeTextBlock({
      style: {
        fontSize: 14,
        color: "#FFFFFF",
        backgroundColor: "#2C2EFF",
        textBackgroundEnabled: true,
        textBackgroundMode: "per-line",
        textBackgroundBorderRadius: 12,
      },
    });
    const html = renderTextBlock(block, "Texte", undefined, false);
    expect(html).not.toContain("block-text-bg-layer");
    expect(html).not.toContain("block-text-fg-layer");
    expect(html).toContain("background-color:#2C2EFF");
    expect(html).toContain("filter:url(#text-bg-goo-12000)"); // goo sur le wrapper
  });

  it("per-line SANS arrondi + opacité < 1 : single couche rgba (pas de double couche)", () => {
    const block = makeTextBlock({
      style: {
        fontSize: 14,
        color: "#FFFFFF",
        backgroundColor: "#2C2EFF",
        textBackgroundEnabled: true,
        textBackgroundMode: "per-line",
        backgroundOpacity: 0.5,
      },
    });
    const html = renderTextBlock(block, "Texte", undefined, false);
    expect(html).not.toContain("block-text-bg-layer");
    expect(html).toContain("background-color:rgba(44,46,255,0.5)");
  });
});
