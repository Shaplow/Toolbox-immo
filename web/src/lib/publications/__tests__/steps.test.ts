import { describe, it, expect } from "vitest";
import { computePublicationSteps } from "@/lib/publications/steps";

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseSlot(overrides?: Partial<{ status: string; caption: string | null; description: string | null }>) {
  return {
    status: "PLANNED" as string,
    caption: null,
    description: null,
    ...overrides,
  };
}

const recipeWithRushes = {
  source: "manual_rushes" as const,
  coverMode: "none" as const,
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
  coverMode: "auto" as const,
  needsCaptions: true,
  needsDescription: "autoGenerate" as const,
  needsClientValidation: false,
  needsRushes: false,
  needsBrief: false,
};

// ── step "edit" visibility ────────────────────────────────────────────────────

describe("computePublicationSteps — step 'edit' visibility", () => {
  it("visible si needsRushes=true", () => {
    const steps = computePublicationSteps({ slot: baseSlot(), pattern: recipeWithRushes });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.visible).toBe(true);
  });

  it("visible si needsBrief=true", () => {
    const steps = computePublicationSteps({ slot: baseSlot(), pattern: recipeWithBrief });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.visible).toBe(true);
  });

  it("visible si needsRushes ET needsBrief", () => {
    const steps = computePublicationSteps({ slot: baseSlot(), pattern: recipeWithBoth });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.visible).toBe(true);
  });

  it("non visible si pattern null", () => {
    const steps = computePublicationSteps({ slot: baseSlot(), pattern: null });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.visible).toBe(false);
  });

  it("non visible si needsRushes=false et needsBrief=false", () => {
    const steps = computePublicationSteps({ slot: baseSlot(), pattern: recipeAutoTemplate });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.visible).toBe(false);
  });
});

// ── step "edit" status ────────────────────────────────────────────────────────

describe("computePublicationSteps — step 'edit' status", () => {
  it("'todo' si aucune version et pas de currentVersionId", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      pattern: recipeWithRushes,
      versionsCount: 0,
      currentVersionId: null,
    });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.status).toBe("todo");
  });

  it("'processing' si au moins une version mais pas encore promue", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      pattern: recipeWithRushes,
      versionsCount: 1,
      currentVersionId: null,
    });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.status).toBe("processing");
  });

  it("'processing' si plusieurs versions mais aucune promue", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      pattern: recipeWithRushes,
      versionsCount: 3,
      currentVersionId: undefined,
    });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.status).toBe("processing");
  });

  it("'done' si currentVersionId est défini", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      pattern: recipeWithRushes,
      versionsCount: 2,
      currentVersionId: "version-abc-123",
    });
    const edit = steps.find((s) => s.key === "edit");
    expect(edit?.status).toBe("done");
  });

  it("'done' même sans versionsCount si currentVersionId fourni", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      pattern: recipeWithRushes,
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
    const steps = computePublicationSteps({ slot: baseSlot(), pattern: recipeAll });
    const editIdx = steps.findIndex((s) => s.key === "edit");
    const coverIdx = steps.findIndex((s) => s.key === "cover");
    const captionsIdx = steps.findIndex((s) => s.key === "captions");
    expect(editIdx).toBeGreaterThanOrEqual(0);
    if (coverIdx >= 0) expect(editIdx).toBeLessThan(coverIdx);
    if (captionsIdx >= 0) expect(editIdx).toBeLessThan(captionsIdx);
  });

  it("le step 'publish' est toujours le dernier", () => {
    const steps = computePublicationSteps({ slot: baseSlot(), pattern: recipeWithBoth });
    expect(steps[steps.length - 1].key).toBe("publish");
  });
});

// ── auto_template recipe — step "edit" non visible ─────────────────────────────

describe("computePublicationSteps — pattern auto_template sans rushes", () => {
  it("le step 'render' est visible mais pas 'edit'", () => {
    const steps = computePublicationSteps({ slot: baseSlot(), pattern: recipeAutoTemplate });
    const render = steps.find((s) => s.key === "render");
    const edit = steps.find((s) => s.key === "edit");
    expect(render?.visible).toBe(true);
    expect(edit?.visible).toBe(false);
  });
});

// ── step "captions" status (Phase 1.9 — bug fix passage du job) ───────────────

describe("computePublicationSteps — step 'captions' status", () => {
  it("'todo' si needsCaptions et aucun job", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      pattern: recipeAutoTemplate,
      captionJob: null,
    });
    const captions = steps.find((s) => s.key === "captions");
    expect(captions?.visible).toBe(true);
    expect(captions?.status).toBe("todo");
  });

  it("'queued' si job QUEUED", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      pattern: recipeAutoTemplate,
      captionJob: { status: "QUEUED" },
    });
    const captions = steps.find((s) => s.key === "captions");
    expect(captions?.status).toBe("queued");
  });

  it("'processing' si job PROCESSING", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      pattern: recipeAutoTemplate,
      captionJob: { status: "PROCESSING" },
    });
    const captions = steps.find((s) => s.key === "captions");
    expect(captions?.status).toBe("processing");
  });

  it("'done' si job COMPLETED", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      pattern: recipeAutoTemplate,
      captionJob: { status: "COMPLETED" },
    });
    const captions = steps.find((s) => s.key === "captions");
    expect(captions?.status).toBe("done");
  });

  it("'failed' si job FAILED", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      pattern: recipeAutoTemplate,
      captionJob: { status: "FAILED" },
    });
    const captions = steps.find((s) => s.key === "captions");
    expect(captions?.status).toBe("failed");
  });

  it("step non visible si needsCaptions=false (job ignoré)", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      pattern: { ...recipeAutoTemplate, needsCaptions: false },
      captionJob: { status: "COMPLETED" },
    });
    const captions = steps.find((s) => s.key === "captions");
    expect(captions?.visible).toBe(false);
  });
});

// ── step "description" status (P0.2 — FK + fallback slot.description) ─────────

describe("computePublicationSteps — step 'description' status", () => {
  it("'todo' si aucun job et description vide", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      pattern: recipeAutoTemplate,
      descriptionJob: null,
    });
    const desc = steps.find((s) => s.key === "description");
    expect(desc?.visible).toBe(true);
    expect(desc?.status).toBe("todo");
  });

  it("'done' si job COMPLETED avec result", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      pattern: recipeAutoTemplate,
      descriptionJob: { status: "COMPLETED", result: "Texte généré" },
    });
    const desc = steps.find((s) => s.key === "description");
    expect(desc?.status).toBe("done");
  });

  it("'todo' si job COMPLETED mais result vide", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      pattern: recipeAutoTemplate,
      descriptionJob: { status: "COMPLETED", result: null },
    });
    const desc = steps.find((s) => s.key === "description");
    expect(desc?.status).toBe("todo");
  });

  it("'failed' si job FAILED", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      pattern: recipeAutoTemplate,
      descriptionJob: { status: "FAILED", result: null },
    });
    const desc = steps.find((s) => s.key === "description");
    expect(desc?.status).toBe("failed");
  });

  it("'done' (fallback) si pas de job mais slot.description rempli", () => {
    const steps = computePublicationSteps({
      slot: baseSlot({ description: "Description rédigée à la main." }),
      pattern: recipeAutoTemplate,
      descriptionJob: null,
    });
    const desc = steps.find((s) => s.key === "description");
    expect(desc?.status).toBe("done");
  });

  it("'todo' si slot.description = whitespace seulement", () => {
    const steps = computePublicationSteps({
      slot: baseSlot({ description: "   \n  " }),
      pattern: recipeAutoTemplate,
      descriptionJob: null,
    });
    const desc = steps.find((s) => s.key === "description");
    expect(desc?.status).toBe("todo");
  });

  it("job FAILED prime sur fallback (le fallback n'écrase pas un échec)", () => {
    const steps = computePublicationSteps({
      slot: baseSlot({ description: "Texte fallback" }),
      pattern: recipeAutoTemplate,
      descriptionJob: { status: "FAILED", result: null },
    });
    const desc = steps.find((s) => s.key === "description");
    expect(desc?.status).toBe("failed");
  });

  it("step non visible si needsDescription='none'", () => {
    const steps = computePublicationSteps({
      slot: baseSlot({ description: "Texte" }),
      pattern: { ...recipeAutoTemplate, needsDescription: "none" as const },
      descriptionJob: { status: "COMPLETED", result: "OK" },
    });
    const desc = steps.find((s) => s.key === "description");
    expect(desc?.visible).toBe(false);
  });
});
