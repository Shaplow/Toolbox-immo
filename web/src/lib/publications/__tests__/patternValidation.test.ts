import { describe, it, expect } from "vitest";
import {
  validatePatternConfig,
  detectOrphanedPatternConfig,
  type PatternValidationInput,
  type TemplateValidationContext,
} from "@/lib/publications/patternValidation";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<PatternValidationInput> = {}): PatternValidationInput {
  return {
    source: "auto_template",
    templateId: "tpl-1",
    coverMode: "none",
    coverConfig: null,
    needsCaptions: false,
    needsDescription: "none",
    needsClientValidation: false,
    allowsClientRevision: false,
    captionPresetId: null,
    descriptionPromptId: null,
    ...overrides,
  };
}

const templateWithPreset: TemplateValidationContext = {
  coverPresetNames: ["Default", "Sombre"],
};

const templateNoPreset: TemplateValidationContext = {
  coverPresetNames: [],
};

// ─── Cas OK (6 sans erreur) ───────────────────────────────────────────────────

describe("validatePatternConfig — cas OK", () => {
  it("pattern minimal auto_template avec template défini", () => {
    expect(validatePatternConfig(makeInput(), templateWithPreset)).toEqual([]);
  });

  it("coverMode=autoPack avec template ayant des presets → OK", () => {
    const input = makeInput({
      coverMode: "autoPack",
      coverConfig: { enabled: true },
    });
    expect(validatePatternConfig(input, templateWithPreset)).toEqual([]);
  });

  it("needsCaptions=true + captionPresetId défini", () => {
    const input = makeInput({ needsCaptions: true, captionPresetId: "cp-1" });
    expect(validatePatternConfig(input, templateWithPreset)).toEqual([]);
  });

  it("needsDescription=autoGenerate + descriptionPromptId défini", () => {
    const input = makeInput({
      needsDescription: "autoGenerate",
      descriptionPromptId: "dp-1",
    });
    expect(validatePatternConfig(input, templateWithPreset)).toEqual([]);
  });

  it("source=manual_rushes sans templateId (legitime)", () => {
    const input = makeInput({ source: "manual_rushes", templateId: null });
    expect(validatePatternConfig(input, templateWithPreset)).toEqual([]);
  });

  it("needsClientValidation=true + allowsClientRevision=true (couplage OK)", () => {
    const input = makeInput({
      needsClientValidation: true,
      allowsClientRevision: true,
    });
    expect(validatePatternConfig(input, templateWithPreset)).toEqual([]);
  });
});

// ─── Cas KO (6 erreurs ciblées) ───────────────────────────────────────────────

describe("validatePatternConfig — cas KO", () => {
  it("C5 : source=auto_template sans templateId → MISSING_TEMPLATE", () => {
    const errors = validatePatternConfig(
      makeInput({ source: "auto_template", templateId: null }),
      templateWithPreset,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      field: "templateId",
      code: "MISSING_TEMPLATE",
    });
  });

  it("C1 (Phase 2.6) : coverMode=autoPack + template sans preset → MISSING_COVER_PRESET_NAME", () => {
    const errors = validatePatternConfig(
      makeInput({ coverMode: "autoPack", coverConfig: null }),
      templateNoPreset,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      field: "coverConfig",
      code: "MISSING_COVER_PRESET_NAME",
    });
  });

  it("C1 (Phase 2.6) : coverMode=autoPack + template avec preset → OK (peu importe coverConfig)", () => {
    const errors = validatePatternConfig(
      makeInput({ coverMode: "autoPack", coverConfig: null }),
      templateWithPreset,
    );
    expect(errors).toEqual([]);
  });

  it("C3 : needsCaptions=true sans captionPresetId → MISSING_CAPTION_PRESET", () => {
    const errors = validatePatternConfig(
      makeInput({ needsCaptions: true }),
      templateWithPreset,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("MISSING_CAPTION_PRESET");
  });

  it("C4 : needsDescription=autoGenerate sans descriptionPromptId → MISSING_DESCRIPTION_PROMPT", () => {
    const errors = validatePatternConfig(
      makeInput({ needsDescription: "autoGenerate" }),
      templateWithPreset,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("MISSING_DESCRIPTION_PROMPT");
  });

  it("C10 : allowsClientRevision=true sans needsClientValidation → ALLOWS_REVISION_WITHOUT_VALIDATION", () => {
    const errors = validatePatternConfig(
      makeInput({ allowsClientRevision: true, needsClientValidation: false }),
      templateWithPreset,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("ALLOWS_REVISION_WITHOUT_VALIDATION");
  });

  it("plusieurs erreurs cumulées sont toutes retournées", () => {
    const errors = validatePatternConfig(
      makeInput({
        source: "auto_template",
        templateId: null, // C5
        needsCaptions: true, // C3
      }),
      templateWithPreset,
    );
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.code).sort()).toEqual([
      "MISSING_CAPTION_PRESET",
      "MISSING_TEMPLATE",
    ]);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("validatePatternConfig — edge cases", () => {
  it("template null + coverMode=autoPack → skip C1 (validation impossible)", () => {
    // Sans template chargé, on ne peut pas vérifier qu'il a des presets cover.
    // Comportement attendu : la validation cover passe silencieusement.
    const errors = validatePatternConfig(
      makeInput({ coverMode: "autoPack", coverConfig: { enabled: true } }),
      null,
    );
    expect(errors).toEqual([]);
  });
});

// ─── detectOrphanedPatternConfig ──────────────────────────────────────────────

describe("detectOrphanedPatternConfig", () => {
  it("pattern valide → null", () => {
    expect(detectOrphanedPatternConfig(makeInput(), templateWithPreset)).toBeNull();
  });

  it("pattern avec erreurs → { count, codes }", () => {
    const result = detectOrphanedPatternConfig(
      makeInput({ needsCaptions: true }),
      templateWithPreset,
    );
    expect(result).toEqual({ count: 1, codes: ["MISSING_CAPTION_PRESET"] });
  });
});
