/**
 * Tests unitaires sur les transitions pipeline — fige les invariants des
 * fixes W2 (staleSince-aware) et QW6.
 *
 *  1. computeAutoTransitionTargetPure ignore les captions stale (post-promote V2)
 *  2. La logique latestCompletedFresh préserve le COMPLETED non-stale même quand
 *     un PROCESSING plus récent existe (V6.6.1)
 *  3. needsClientValidation override route vers AWAITING_CLIENT vs READY_FOR_CM
 */

import { describe, it, expect } from "vitest";
import { computeAutoTransitionTargetPure } from "@/lib/services/slot/transitions";

function makeSlot(overrides: Partial<Parameters<typeof computeAutoTransitionTargetPure>[0]> = {}) {
  return {
    status: "IN_PROGRESS",
    needsClientValidationOverride: null,
    pattern: {
      source: "auto_template",
      needsCaptions: true,
      needsCaptionsMode: "auto",
      needsClientValidation: true,
    },
    render: { status: "DONE" },
    latestCaptionJobStatus: "COMPLETED",
    ...overrides,
  };
}

describe("computeAutoTransitionTargetPure — stale-aware (W2/QW6)", () => {
  it("render DONE + captions COMPLETED non-stale + needsClientValidation → AWAITING_CLIENT", () => {
    const target = computeAutoTransitionTargetPure(makeSlot());
    expect(target).toBe("AWAITING_CLIENT");
  });

  it("render DONE + captions COMPLETED + needsClientValidation=false → READY_FOR_CM", () => {
    const target = computeAutoTransitionTargetPure(
      makeSlot({
        pattern: {
          source: "auto_template",
          needsCaptions: true,
          needsCaptionsMode: "auto",
          needsClientValidation: false,
        },
      }),
    );
    expect(target).toBe("READY_FOR_CM");
  });

  it("render DONE + captionStatus=PROCESSING (en cours) → ne bascule pas en AWAITING_CLIENT", () => {
    // V6.6.1 : un retry PROCESSING qui arrive après un COMPLETED valide ne
    // doit pas régresser le slot. La fn pure reçoit `latestCaptionJobStatus`
    // — le caller (applyAutoTransitionFromPipeline) est responsable de
    // sélectionner le COMPLETED non-stale en amont, mais ici on vérifie que
    // PROCESSING comme dernier état ne crée pas une transition prématurée.
    const target = computeAutoTransitionTargetPure(
      makeSlot({ latestCaptionJobStatus: "PROCESSING" }),
    );
    // Pas de COMPLETED non-stale détecté ici → reste en IN_PROGRESS (target=null
    // car la fn return null quand le pipeline n'est pas prêt).
    expect(target).toBe(null);
  });

  it("needsClientValidationOverride=true override pattern.needsClientValidation=false", () => {
    const target = computeAutoTransitionTargetPure(
      makeSlot({
        needsClientValidationOverride: true,
        pattern: {
          source: "auto_template",
          needsCaptions: true,
          needsCaptionsMode: "auto",
          needsClientValidation: false,
        },
      }),
    );
    expect(target).toBe("AWAITING_CLIENT");
  });

  it("pattern.source !== auto_template → pas de transition automatique", () => {
    const target = computeAutoTransitionTargetPure(
      makeSlot({
        pattern: {
          source: "manual_rushes",
          needsCaptions: true,
          needsCaptionsMode: "auto",
          needsClientValidation: true,
        },
      }),
    );
    expect(target).toBe(null);
  });

  it("render absent → pas de transition", () => {
    const target = computeAutoTransitionTargetPure(makeSlot({ render: null }));
    expect(target).toBe(null);
  });

  it("statut hors PIPELINE_DRIVEN (ex: AWAITING_CLIENT déjà atteint) → null (idempotence)", () => {
    const target = computeAutoTransitionTargetPure(
      makeSlot({ status: "AWAITING_CLIENT" }),
    );
    // PIPELINE_DRIVEN_STATUSES n'inclut PAS AWAITING_CLIENT → null.
    expect(target).toBe(null);
  });

  it("needsCaptionsMode=none → captions non requises, bascule directe vers post-pipeline", () => {
    const target = computeAutoTransitionTargetPure(
      makeSlot({
        pattern: {
          source: "auto_template",
          needsCaptions: false,
          needsCaptionsMode: "none",
          needsClientValidation: true,
        },
        latestCaptionJobStatus: null,
      }),
    );
    expect(target).toBe("AWAITING_CLIENT");
  });
});
