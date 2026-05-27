import { describe, it, expect } from "vitest";
import {
  hashToken,
  compareHashes,
  resolveClientValidationConfig,
} from "@/lib/publications/clientValidation";

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
