import { describe, it, expect } from "vitest";
import {
  isRendered,
  isRenderInFlight,
  hasRenderFailed,
  isRenderCandidate,
  type RenderEligibilityInput,
} from "@/lib/slots/renderEligibility";

/** Base "candidate" valide — chaque test ne dévie que d'un champ. */
function base(overrides: Partial<RenderEligibilityInput> = {}): RenderEligibilityInput {
  return {
    status: "IN_PROGRESS",
    render: null,
    latestRender: null,
    pattern: { source: "auto_template", templateId: "tmpl_1" },
    ...overrides,
  };
}

describe("isRenderCandidate", () => {
  it("un rendu courant en ERROR reste candidat (cas « Relancer »)", () => {
    const s = base({ render: { status: "ERROR" }, latestRender: { status: "ERROR" } });
    expect(isRenderCandidate(s)).toBe(true);
    expect(hasRenderFailed(s)).toBe(true);
  });

  it("latestRender DONE → plus candidat (déjà rendu)", () => {
    const s = base({ latestRender: { status: "DONE" } });
    expect(isRenderCandidate(s)).toBe(false);
    expect(isRendered(s)).toBe(true);
  });

  it("un rendu en vol (PENDING/PROCESSING) → plus candidat", () => {
    expect(isRenderCandidate(base({ latestRender: { status: "PENDING" } }))).toBe(false);
    expect(isRenderCandidate(base({ latestRender: { status: "PROCESSING" } }))).toBe(false);
    expect(isRenderInFlight(base({ latestRender: { status: "PROCESSING" } }))).toBe(true);
  });

  it("recette manual_rushes → jamais candidate", () => {
    expect(
      isRenderCandidate(base({ pattern: { source: "manual_rushes", templateId: "tmpl_1" } })),
    ).toBe(false);
  });

  it("statut terminal → jamais candidate", () => {
    expect(isRenderCandidate(base({ status: "PUBLISHED" }))).toBe(false);
    expect(isRenderCandidate(base({ status: "ARCHIVED" }))).toBe(false);
    expect(isRenderCandidate(base({ status: "CANCELLED" }))).toBe(false);
  });

  it("recette sans template → jamais candidate", () => {
    expect(isRenderCandidate(base({ pattern: { source: "auto_template", templateId: null } }))).toBe(
      false,
    );
  });

  it("cas nominal (rien lancé) → candidate", () => {
    expect(isRenderCandidate(base())).toBe(true);
  });
});

describe("isRendered / isRenderInFlight / hasRenderFailed", () => {
  it("isRendered priorise render OU latestRender à DONE", () => {
    expect(isRendered(base({ render: { status: "DONE" } }))).toBe(true);
    expect(isRendered(base({ latestRender: { status: "DONE" } }))).toBe(true);
    expect(isRendered(base())).toBe(false);
  });

  it("isRenderInFlight est false dès que isRendered est vrai (race SSE/promotion)", () => {
    const s = base({ render: { status: "DONE" }, latestRender: { status: "PROCESSING" } });
    expect(isRendered(s)).toBe(true);
    expect(isRenderInFlight(s)).toBe(false);
  });

  it("hasRenderFailed est false si un rendu plus récent a réussi", () => {
    const s = base({ render: { status: "DONE" }, latestRender: { status: "ERROR" } });
    expect(hasRenderFailed(s)).toBe(false);
  });
});
