import { describe, it, expect } from "vitest";
import { hashToken, compareHashes } from "@/lib/publications/clientValidation";
import {
  resolveClientValidationConfig,
  resolveOverride,
  resolveSlotConfig,
} from "@/lib/services/slot/config";

// ─── hashToken ────────────────────────────────────────────────────────────────

describe("hashToken", () => {
  it("retourne un sha256 hex stable pour la même entrée", () => {
    expect(hashToken("hello")).toBe(hashToken("hello"));
    expect(hashToken("hello")).toHaveLength(64); // sha256 hex = 64 chars
  });

  it("produit des hash différents pour des entrées différentes", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

// ─── compareHashes ────────────────────────────────────────────────────────────

describe("compareHashes", () => {
  it("true pour deux hash identiques", () => {
    const h = hashToken("token1");
    expect(compareHashes(h, h)).toBe(true);
  });

  it("false pour deux hash différents", () => {
    expect(compareHashes(hashToken("a"), hashToken("b"))).toBe(false);
  });

  it("false pour longueurs différentes (sans throw)", () => {
    expect(compareHashes("abc", "abcdef")).toBe(false);
  });
});

// ─── resolveClientValidationConfig ────────────────────────────────────────────

describe("resolveClientValidationConfig", () => {
  it("hérite du pattern quand aucun override", () => {
    const cfg = resolveClientValidationConfig(
      {
        needsClientValidationOverride: null,
        allowsClientRevisionOverride: null,
      },
      { needsClientValidation: true, allowsClientRevision: true },
    );
    expect(cfg).toEqual({
      needsClientValidation: true,
      allowsClientRevision: true,
      source: {
        needsClientValidation: "pattern",
        allowsClientRevision: "pattern",
      },
    });
  });

  it("override true écrase pattern false", () => {
    const cfg = resolveClientValidationConfig(
      {
        needsClientValidationOverride: true,
        allowsClientRevisionOverride: true,
      },
      { needsClientValidation: false, allowsClientRevision: false },
    );
    expect(cfg.needsClientValidation).toBe(true);
    expect(cfg.allowsClientRevision).toBe(true);
    expect(cfg.source.needsClientValidation).toBe("override");
    expect(cfg.source.allowsClientRevision).toBe("override");
  });

  it("override false écrase pattern true (désactivation explicite)", () => {
    const cfg = resolveClientValidationConfig(
      {
        needsClientValidationOverride: false,
        allowsClientRevisionOverride: false,
      },
      { needsClientValidation: true, allowsClientRevision: true },
    );
    expect(cfg.needsClientValidation).toBe(false);
    expect(cfg.allowsClientRevision).toBe(false);
  });

  it("override partiel : un seul champ surchargé", () => {
    const cfg = resolveClientValidationConfig(
      {
        needsClientValidationOverride: true,
        allowsClientRevisionOverride: null,
      },
      { needsClientValidation: false, allowsClientRevision: true },
    );
    expect(cfg.needsClientValidation).toBe(true); // override
    expect(cfg.allowsClientRevision).toBe(true); // pattern
    expect(cfg.source.needsClientValidation).toBe("override");
    expect(cfg.source.allowsClientRevision).toBe("pattern");
  });

  it("pas de pattern → defaults false, source default", () => {
    const cfg = resolveClientValidationConfig(
      {
        needsClientValidationOverride: null,
        allowsClientRevisionOverride: null,
      },
      null,
    );
    expect(cfg.needsClientValidation).toBe(false);
    expect(cfg.allowsClientRevision).toBe(false);
    expect(cfg.source.needsClientValidation).toBe("default");
  });

  it("pas de pattern mais override : override prime", () => {
    const cfg = resolveClientValidationConfig(
      {
        needsClientValidationOverride: true,
        allowsClientRevisionOverride: false,
      },
      null,
    );
    expect(cfg.needsClientValidation).toBe(true);
    expect(cfg.allowsClientRevision).toBe(false);
    expect(cfg.source.needsClientValidation).toBe("override");
  });
});

// ─── resolveOverride (helper générique) ───────────────────────────────────────

describe("resolveOverride", () => {
  it("override défini (true) → override prime", () => {
    expect(resolveOverride(true, false, false)).toEqual({ value: true, source: "override" });
  });

  it("override défini (false) → override prime (désactivation explicite)", () => {
    expect(resolveOverride(false, true, true)).toEqual({ value: false, source: "override" });
  });

  it("override null + pattern défini → valeur du pattern", () => {
    expect(resolveOverride(null, "autoGenerate", "none")).toEqual({
      value: "autoGenerate",
      source: "pattern",
    });
  });

  it("override null + pattern undefined → default", () => {
    expect(resolveOverride(null, undefined, "fallback")).toEqual({
      value: "fallback",
      source: "default",
    });
  });

  it("override undefined comporte comme null → pattern prime", () => {
    expect(resolveOverride(undefined, "x", "default")).toEqual({
      value: "x",
      source: "pattern",
    });
  });
});

// ─── resolveSlotConfig (config résolue exhaustive) ────────────────────────────

describe("resolveSlotConfig", () => {
  const pattern = {
    needsClientValidation: true,
    allowsClientRevision: true,
    needsCaptions: true,
    needsDescription: "autoGenerate",
    needsRushes: true,
    needsBrief: false,
  };

  it("aucun override → héritage complet du pattern", () => {
    const cfg = resolveSlotConfig(
      {
        needsClientValidationOverride: null,
        allowsClientRevisionOverride: null,
        needsCaptionsOverride: null,
        needsDescriptionOverride: null,
        needsRushesOverride: null,
        needsBriefOverride: null,
      },
      pattern,
    );
    expect(cfg.needsClientValidation).toBe(true);
    expect(cfg.needsCaptions).toBe(true);
    expect(cfg.needsDescription).toBe("autoGenerate");
    expect(cfg.needsRushes).toBe(true);
    expect(cfg.needsBrief).toBe(false);
    expect(cfg.source.needsCaptions).toBe("pattern");
  });

  it("override needsCaptions=false → désactive captions pour ce slot uniquement", () => {
    const cfg = resolveSlotConfig(
      {
        needsClientValidationOverride: null,
        allowsClientRevisionOverride: null,
        needsCaptionsOverride: false,
        needsDescriptionOverride: null,
        needsRushesOverride: null,
        needsBriefOverride: null,
      },
      pattern,
    );
    expect(cfg.needsCaptions).toBe(false);
    expect(cfg.source.needsCaptions).toBe("override");
    // Les autres champs restent hérités du pattern
    expect(cfg.needsDescription).toBe("autoGenerate");
    expect(cfg.source.needsDescription).toBe("pattern");
  });

  it("override needsDescription=none → force désactivation, pattern dit autoGenerate", () => {
    const cfg = resolveSlotConfig(
      {
        needsClientValidationOverride: null,
        allowsClientRevisionOverride: null,
        needsCaptionsOverride: null,
        needsDescriptionOverride: "none",
        needsRushesOverride: null,
        needsBriefOverride: null,
      },
      pattern,
    );
    expect(cfg.needsDescription).toBe("none");
    expect(cfg.source.needsDescription).toBe("override");
  });

  it("pas de pattern → defaults false + needsDescription='none'", () => {
    const cfg = resolveSlotConfig(
      {
        needsClientValidationOverride: null,
        allowsClientRevisionOverride: null,
        needsCaptionsOverride: null,
        needsDescriptionOverride: null,
        needsRushesOverride: null,
        needsBriefOverride: null,
      },
      null,
    );
    expect(cfg.needsCaptions).toBe(false);
    expect(cfg.needsDescription).toBe("none");
    expect(cfg.source.needsCaptions).toBe("default");
  });

  it("override total : tous les champs surchargés, pattern ignoré", () => {
    const cfg = resolveSlotConfig(
      {
        needsClientValidationOverride: false,
        allowsClientRevisionOverride: false,
        needsCaptionsOverride: false,
        needsDescriptionOverride: "none",
        needsRushesOverride: false,
        needsBriefOverride: true,
      },
      pattern,
    );
    expect(cfg.needsClientValidation).toBe(false);
    expect(cfg.needsCaptions).toBe(false);
    expect(cfg.needsBrief).toBe(true);
    expect(cfg.source.needsClientValidation).toBe("override");
    expect(cfg.source.needsBrief).toBe("override");
  });
});
