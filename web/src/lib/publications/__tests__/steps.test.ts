import { describe, it, expect } from "vitest";
import { computePublicationSteps } from "@/lib/publications/steps";

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseSlot(overrides?: Partial<{ status: string; description: string | null }>) {
  return {
    status: "PLANNED" as string,
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
  coverMode: "autoPack" as const,
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
  it("'waiting' si aucune version et amont (rushes) pas encore terminé", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      pattern: recipeWithRushes,
      versionsCount: 0,
      currentVersionId: null,
    });
    const edit = steps.find((s) => s.key === "edit");
    // Avant : "todo". Depuis 2026-05-31 : si rushes n'est pas done, edit
    // bascule en "waiting" pour signaler qu'on dépend d'un amont.
    expect(edit?.status).toBe("waiting");
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
      coverMode: "autoPack" as const,
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
  it("'waiting' si needsCaptions, aucun job et render amont pas DONE", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      pattern: recipeAutoTemplate,
      captionJob: null,
    });
    const captions = steps.find((s) => s.key === "captions");
    expect(captions?.visible).toBe(true);
    // Render n'est pas done → captions bascule "waiting" (avant : "todo").
    expect(captions?.status).toBe("waiting");
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
  it("'waiting' si aucun job, description vide et amont (render) pas DONE", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      pattern: recipeAutoTemplate,
      descriptionJob: null,
    });
    const desc = steps.find((s) => s.key === "description");
    expect(desc?.visible).toBe(true);
    expect(desc?.status).toBe("waiting");
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

  it("'waiting' si job COMPLETED mais result vide et amont pas DONE", () => {
    const steps = computePublicationSteps({
      slot: baseSlot(),
      pattern: recipeAutoTemplate,
      descriptionJob: { status: "COMPLETED", result: null },
    });
    const desc = steps.find((s) => s.key === "description");
    // result vide → status sous-jacent "todo" → bascule "waiting" car render amont pas DONE.
    expect(desc?.status).toBe("waiting");
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

  it("'waiting' si slot.description = whitespace seulement et amont pas DONE", () => {
    const steps = computePublicationSteps({
      slot: baseSlot({ description: "   \n  " }),
      pattern: recipeAutoTemplate,
      descriptionJob: null,
    });
    const desc = steps.find((s) => s.key === "description");
    // whitespace → status sous-jacent "todo" → bascule "waiting".
    expect(desc?.status).toBe("waiting");
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
