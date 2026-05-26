import { describe, it, expect } from "vitest";
import { computePublicationSteps } from "@/lib/publications/steps";

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseSlot(overrides?: Partial<{ status: string; caption: string | null }>) {
  return {
    status: "PLANNED" as string,
    caption: null,
    ...overrides,
  };
}

const recipeWithRushes = {
  source: "manual_rushes" as const,
  needsCover: "none" as const,
  needsCaptions: false,
  needsDescription: "none" as const,
  needsClientValidation: false,
  needsRushes: true,
  needsBrief: false,
};

const recipeWithBrief = {
  ...recipeWithRushes,
  needsBrief: true,
  needsRushes: false,
};

const recipeWithBoth = {
  ...recipeWithRushes,
  needsBrief: true,
};

const recipeAutoTemplate = {
  source: "auto_template" as const,
  needsCover: "auto" as const,
  needsCaptions: true,
  needsDescription: "autoGenerate" as const,
  needsClientValidation: false,
  needsRushes: false,
  needsBrief: false,
};

// ── step "edit" visibility ────────────────────────────────────────────────────

describe("computePublicationSteps — step 'edit' visibility", () => {
  it("visible si needsRushes=true", () => {
    const steps = computePublicationSteps({ slot: baseSlot(), recipe: recipeWithRushes });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.visible).toBe(true);
  });

  it("visible si needsBrief=true", () => {
    const steps = computePublicationSteps({ slot: baseSlot(), recipe: recipeWithBrief });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.visible).toBe(true);
  });

  it("visible si needsRushes ET needsBrief", () => {
    const steps = computePublicationSteps({ slot: baseSlot(), recipe: recipeWithBoth });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.visible).toBe(true);
  });

  it("non visible si recipe null", () => {
    const steps = computePublicationSteps({ slot: baseSlot(), recipe: null });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.visible).toBe(false);
  });

  it("non visible si needsRushes=false et needsBrief=false", () => {
    const steps = computePublicationSteps({ slot: baseSlot(), recipe: recipeAutoTemplate });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.visible).toBe(false);
  });
});

// ── step "edit" status ────────────────────────────────────────────────────────

describe("computePublicationSteps — step 'edit' status", () => {
  it("'todo' si aucune version et pas de currentVersionId", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      recipe: recipeWithRushes,
      versionsCount: 0,
      currentVersionId: null,
    });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.status).toBe("todo");
  });

  it("'processing' si au moins une version mais pas encore promue", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      recipe: recipeWithRushes,
      versionsCount: 1,
      currentVersionId: null,
    });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.status).toBe("processing");
  });

  it("'processing' si plusieurs versions mais aucune promue", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      recipe: recipeWithRushes,
      versionsCount: 3,
      currentVersionId: undefined,
    });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.status).toBe("processing");
  });

  it("'done' si currentVersionId est défini", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      recipe: recipeWithRushes,
      versionsCount: 2,
      currentVersionId: "version-abc-123",
    });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.status).toBe("done");
  });

  it("'done' même sans versionsCount si currentVersionId fourni", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      recipe: recipeWithRushes,
      // versionsCount omis → default 0
      currentVersionId: "version-abc-123",
    });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.status).toBe("done");
  });
});

// ── order ─────────────────────────────────────────────────────────────────────

describe("computePublicationSteps — ordre des steps", () => {
  it("le step 'edit' est positionné avant 'cover' et 'captions'", () => {
    const recipeAll = {
      source: "manual_rushes" as const,
      needsCover: "auto" as const,
      needsCaptions: true,
      needsDescription: "none" as const,
      needsClientValidation: false,
      needsRushes: true,
      needsBrief: true,
    };
    const steps = computePublicationSteps({ slot: baseSlot(), recipe: recipeAll });
    const editIdx = steps.findIndex((s) => s.key === "edit");
    const coverIdx = steps.findIndex((s) => s.key === "cover");
    const captionsIdx = steps.findIndex((s) => s.key === "captions");
    expect(editIdx).toBeGreaterThanOrEqual(0);
    if (coverIdx >= 0) expect(editIdx).toBeLessThan(coverIdx);
    if (captionsIdx >= 0) expect(editIdx).toBeLessThan(captionsIdx);
  });

  it("le step 'publish' est toujours le dernier", () => {
    const steps = computePublicationSteps({ slot: baseSlot(), recipe: recipeWithBoth });
    expect(steps[steps.length - 1].key).toBe("publish");
  });
});

// ── auto_template recipe — step "edit" non visible ─────────────────────────────

describe("computePublicationSteps — recipe auto_template sans rushes", () => {
  it("le step 'render' est visible mais pas 'edit'", () => {
    const steps = computePublicationSteps({ slot: baseSlot(), recipe: recipeAutoTemplate });
    const render = steps.find((s) => s.key === "render");
    const edit = steps.find((s) => s.key === "edit");
    expect(render?.visible).toBe(true);
    expect(edit?.visible).toBe(false);
  });
});
