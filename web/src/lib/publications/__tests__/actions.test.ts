import { describe, expect, it } from "vitest";
import {
  canTriggerCaptions,
  canTriggerCover,
  canGenerateDescription,
  promoteVersionWarning,
  type ActionContext,
} from "../actions";

/** Contexte de base — slot auto_template avec needs captions/description, sans
 *  job en vol, render DONE, version promue. Surcharge ce qu'il faut par test. */
function makeCtx(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    pattern: {
      source: "auto_template",
      needsCaptions: true,
      needsDescription: "autoGenerate",
      coverMode: "autoPack",
    },
    resolved: {
      needsCaptions: true,
      needsDescription: "autoGenerate",
      coverMode: "autoPack",
      coverPresetId: "preset-1",
      captionPresetId: "caption-1",
      descriptionPromptId: "prompt-1",
    },
    render: { status: "DONE" },
    currentVersion: { id: "v1" },
    coverPack: null,
    latestCaptionJob: null,
    isAdmin: true,
    canEdit: true,
    ...overrides,
  };
}

// ─── canTriggerCaptions ──────────────────────────────────────────────────────

describe("canTriggerCaptions", () => {
  it("masque si !canEdit", () => {
    const v = canTriggerCaptions(makeCtx({ canEdit: false }));
    expect(v).toEqual({ visible: false });
  });

  it("masque si pattern null", () => {
    const v = canTriggerCaptions(makeCtx({ pattern: null }));
    expect(v).toEqual({ visible: false });
  });

  it("masque si !needsCaptions", () => {
    const v = canTriggerCaptions(
      makeCtx({
        pattern: {
          source: "auto_template",
          needsCaptions: false,
          needsDescription: "none",
          coverMode: "none",
        },
      }),
    );
    expect(v).toEqual({ visible: false });
  });

  it("auto_template sans job → intent=auto, disabled", () => {
    const v = canTriggerCaptions(makeCtx());
    expect(v).toMatchObject({ visible: true, enabled: false, intent: "auto" });
  });

  it("job actif QUEUED → intent=pending", () => {
    const v = canTriggerCaptions(
      makeCtx({
        pattern: {
          source: "manual_rushes",
          needsCaptions: true,
          needsDescription: "none",
          coverMode: "none",
        },
        latestCaptionJob: { status: "QUEUED" },
      }),
    );
    expect(v).toMatchObject({ enabled: false, intent: "pending" });
  });

  it("job actif PROCESSING → intent=pending", () => {
    const v = canTriggerCaptions(
      makeCtx({
        pattern: {
          source: "manual_rushes",
          needsCaptions: true,
          needsDescription: "none",
          coverMode: "none",
        },
        latestCaptionJob: { status: "PROCESSING" },
      }),
    );
    expect(v).toMatchObject({ enabled: false, intent: "pending" });
  });

  it("manual sans currentVersion ni render → intent=waiting", () => {
    const v = canTriggerCaptions(
      makeCtx({
        pattern: {
          source: "manual_rushes",
          needsCaptions: true,
          needsDescription: "none",
          coverMode: "none",
        },
        currentVersion: null,
        render: null,
      }),
    );
    expect(v).toMatchObject({ enabled: false, intent: "waiting" });
  });

  it("manual avec version promue → enabled", () => {
    const v = canTriggerCaptions(
      makeCtx({
        pattern: {
          source: "manual_rushes",
          needsCaptions: true,
          needsDescription: "none",
          coverMode: "none",
        },
        currentVersion: { id: "v1" },
        render: null,
        latestCaptionJob: null,
      }),
    );
    expect(v).toEqual({ visible: true, enabled: true });
  });

  it("manual avec render mais pas de version → enabled (cas auto_template sans rushes)", () => {
    const v = canTriggerCaptions(
      makeCtx({
        pattern: {
          source: "external_upload",
          needsCaptions: true,
          needsDescription: "none",
          coverMode: "none",
        },
        currentVersion: null,
        render: { status: "DONE" },
        latestCaptionJob: null,
      }),
    );
    expect(v).toEqual({ visible: true, enabled: true });
  });

  it("auto_template avec job FAILED → bouton disponible pour relancer (enabled)", () => {
    const v = canTriggerCaptions(
      makeCtx({
        latestCaptionJob: { status: "FAILED" },
      }),
    );
    // Job FAILED n'est ni active ni "auto" puisqu'un job a été créé → enabled.
    expect(v).toEqual({ visible: true, enabled: true });
  });
});

// ─── canTriggerCover ─────────────────────────────────────────────────────────

describe("canTriggerCover", () => {
  it("masque si coverMode=none", () => {
    const v = canTriggerCover(
      makeCtx({
        resolved: {
          needsCaptions: false,
          needsDescription: "none",
          coverMode: "none",
          coverPresetId: null,
          captionPresetId: null,
          descriptionPromptId: null,
        },
      }),
    );
    expect(v).toEqual({ visible: false });
  });

  it("coverPack QUEUED → intent=pending", () => {
    const v = canTriggerCover(
      makeCtx({ coverPack: { status: "QUEUED" } }),
    );
    expect(v).toMatchObject({ enabled: false, intent: "pending" });
  });

  it("coverPack READY → intent=pending (sélection à faire dans la section)", () => {
    const v = canTriggerCover(
      makeCtx({ coverPack: { status: "READY" } }),
    );
    expect(v).toMatchObject({ enabled: false, intent: "pending" });
  });

  it("coverMode=auto sans coverPresetId → intent=config-missing", () => {
    const v = canTriggerCover(
      makeCtx({
        resolved: {
          needsCaptions: false,
          needsDescription: "none",
          coverMode: "autoPack",
          coverPresetId: null,
          captionPresetId: null,
          descriptionPromptId: null,
        },
      }),
    );
    expect(v).toMatchObject({ enabled: false, intent: "config-missing" });
  });

  it("coverPack FAILED → l'admin peut relancer (enabled)", () => {
    const v = canTriggerCover(
      makeCtx({ coverPack: { status: "FAILED" } }),
    );
    expect(v).toEqual({ visible: true, enabled: true });
  });

  it("coverMode=auto + preset + cible → enabled", () => {
    const v = canTriggerCover(makeCtx());
    expect(v).toEqual({ visible: true, enabled: true });
  });

  it("pas de cible → intent=waiting", () => {
    const v = canTriggerCover(
      makeCtx({
        currentVersion: null,
        render: null,
      }),
    );
    expect(v).toMatchObject({ enabled: false, intent: "waiting" });
  });
});

// ─── canGenerateDescription ──────────────────────────────────────────────────

describe("canGenerateDescription", () => {
  it("mode=none → masqué", () => {
    const v = canGenerateDescription(
      makeCtx({
        resolved: {
          needsCaptions: false,
          needsDescription: "none",
          coverMode: "none",
          coverPresetId: null,
          captionPresetId: null,
          descriptionPromptId: null,
        },
      }),
    );
    expect(v).toEqual({ visible: false });
  });

  it("mode=preFilled → masqué", () => {
    const v = canGenerateDescription(
      makeCtx({
        resolved: {
          needsCaptions: false,
          needsDescription: "preFilled",
          coverMode: "none",
          coverPresetId: null,
          captionPresetId: null,
          descriptionPromptId: null,
        },
      }),
    );
    expect(v).toEqual({ visible: false });
  });

  it("mode=fixed → masqué", () => {
    const v = canGenerateDescription(
      makeCtx({
        resolved: {
          needsCaptions: false,
          needsDescription: "fixed",
          coverMode: "none",
          coverPresetId: null,
          captionPresetId: null,
          descriptionPromptId: null,
        },
      }),
    );
    expect(v).toEqual({ visible: false });
  });

  it("mode=autoGenerate → intent=auto, disabled (badge)", () => {
    const v = canGenerateDescription(
      makeCtx({
        resolved: {
          needsCaptions: false,
          needsDescription: "autoGenerate",
          coverMode: "none",
          coverPresetId: null,
          captionPresetId: null,
          descriptionPromptId: null,
        },
      }),
    );
    expect(v).toMatchObject({ enabled: false, intent: "auto" });
  });

  it("mode=manualWrite → enabled", () => {
    const v = canGenerateDescription(
      makeCtx({
        resolved: {
          needsCaptions: false,
          needsDescription: "manualWrite",
          coverMode: "none",
          coverPresetId: null,
          captionPresetId: null,
          descriptionPromptId: null,
        },
      }),
    );
    expect(v).toEqual({ visible: true, enabled: true });
  });

  it("fallback sur pattern si resolved manquant", () => {
    const v = canGenerateDescription(
      makeCtx({
        resolved: null,
        pattern: {
          source: "auto_template",
          needsCaptions: false,
          needsDescription: "manualWrite",
          coverMode: "none",
        },
      }),
    );
    expect(v).toEqual({ visible: true, enabled: true });
  });
});

// ─── promoteVersionWarning ───────────────────────────────────────────────────

describe("promoteVersionWarning", () => {
  it("aucun job complété → null", () => {
    const w = promoteVersionWarning(
      makeCtx({ latestCaptionJob: null, coverPack: null }),
    );
    expect(w).toBeNull();
  });

  it("captions COMPLETED → warning mentionne sous-titres", () => {
    const w = promoteVersionWarning(
      makeCtx({
        latestCaptionJob: { status: "COMPLETED" },
        coverPack: null,
      }),
    );
    expect(w).toContain("sous-titres");
    expect(w).not.toContain("cover");
  });

  it("coverPack READY → warning mentionne cover", () => {
    const w = promoteVersionWarning(
      makeCtx({
        latestCaptionJob: null,
        coverPack: { status: "READY" },
      }),
    );
    expect(w).toContain("cover");
    expect(w).not.toContain("sous-titres");
  });

  it("les deux complétés → warning mentionne les deux", () => {
    const w = promoteVersionWarning(
      makeCtx({
        latestCaptionJob: { status: "COMPLETED" },
        coverPack: { status: "READY" },
      }),
    );
    expect(w).toContain("sous-titres");
    expect(w).toContain("cover");
  });

  it("jobs encore en cours → null (pas encore incohérent)", () => {
    const w = promoteVersionWarning(
      makeCtx({
        latestCaptionJob: { status: "PROCESSING" },
        coverPack: { status: "QUEUED" },
      }),
    );
    expect(w).toBeNull();
  });
});
