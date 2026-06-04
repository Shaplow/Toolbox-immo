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
