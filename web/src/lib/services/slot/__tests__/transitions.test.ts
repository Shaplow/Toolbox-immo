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
import {
  canTransition,
  computeAutoTransition,
  computeAutoTransitionTargetPure,
  STATUS_TRANSITIONS,
} from "@/lib/services/slot/transitions";
import type { SlotStatus } from "@/types/roles";

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

// ─────────────────────────────────────────────────────────────────────────────
// Suite historique fusionnée depuis src/lib/publications/__tests__/transitions.test.ts
// (même module testé — canTransition, computeAutoTransition, matrice STATUS_TRANSITIONS).
// ─────────────────────────────────────────────────────────────────────────────

// ─── canTransition ─────────────────────────────────────────────────────────────

describe("canTransition — ADMIN bypass", () => {
  it("ADMIN peut transitionner vers n'importe quel statut", () => {
    expect(canTransition("PUBLISHED", "DRAFT", "ADMIN")).toBe(true);
    expect(canTransition("ARCHIVED", "DRAFT", "ADMIN")).toBe(true);
    expect(canTransition("BLOCKED", "PLANNED", "ADMIN")).toBe(true);
  });
});

describe("canTransition — statuts legacy verrouillés (durcissement 2026-05-30)", () => {
  // Avant le backfill Phase 1.3 on tolérait n'importe quelle sortie depuis un
  // statut legacy — un MONTEUR pouvait pousser un slot legacy vers PUBLISHED en
  // bypassant la matrice. Désormais : ADMIN-only.
  const legacyStatuses = ["TO_DO", "IN_PROGRESS", "READY", "CHECKING", "DONE"];
  for (const s of legacyStatuses) {
    it(`refuse le statut legacy "${s}" en source pour MONTEUR (ADMIN-only)`, () => {
      expect(canTransition(s, "PLANNED", "MONTEUR")).toBe(false);
      expect(canTransition(s, "PLANNED", "ADMIN")).toBe(true);
    });
  }
});

describe("canTransition — matrice pour rôles non-ADMIN", () => {
  it("MONTEUR peut transitionner DRAFT → PLANNED", () => {
    expect(canTransition("DRAFT", "PLANNED", "MONTEUR")).toBe(true);
  });

  it("CM ne peut pas transitionner DRAFT → PUBLISHED (saut interdit)", () => {
    expect(canTransition("DRAFT", "PUBLISHED", "CM")).toBe(false);
  });

  it("MONTEUR ne peut pas aller de PUBLISHED vers DRAFT", () => {
    expect(canTransition("PUBLISHED", "DRAFT", "MONTEUR")).toBe(false);
  });

  it("USER ne peut faire aucune transition", () => {
    expect(canTransition("DRAFT", "PLANNED", "EXTERNAL_GENERATOR")).toBe(false);
  });

  it("CANCELLED → [] (terminal) : impossible pour CM", () => {
    expect(canTransition("CANCELLED", "PLANNED", "CM")).toBe(false);
  });

  it("BLOCKED → [] (terminal) : impossible pour MONTEUR", () => {
    expect(canTransition("BLOCKED", "IN_EDIT", "MONTEUR")).toBe(false);
  });
});

describe("STATUS_TRANSITIONS — cohérence de la matrice", () => {
  const allStatuses: SlotStatus[] = [
    "DRAFT", "PLANNED", "RUSHES_EXPECTED", "RUSHES_RECEIVED", "IN_EDIT",
    "EDIT_REVIEW", "EDIT_APPROVED", "CAPTIONS_PENDING", "READY_FOR_CM",
    "AWAITING_CLIENT", "CLIENT_REVISION",
    "SCHEDULED", "PUBLISHED", "REJECTED", "CANCELLED", "BLOCKED", "ARCHIVED",
  ];

  it("tous les statuts SlotStatus ont une entrée dans STATUS_TRANSITIONS", () => {
    for (const s of allStatuses) {
      expect(STATUS_TRANSITIONS).toHaveProperty(s);
    }
  });

  it("PUBLISHED → ARCHIVED seulement", () => {
    expect(STATUS_TRANSITIONS.PUBLISHED).toEqual(["ARCHIVED"]);
  });

  it("CANCELLED est terminal (aucune transition)", () => {
    expect(STATUS_TRANSITIONS.CANCELLED).toHaveLength(0);
  });

  it("ARCHIVED est terminal (aucune transition)", () => {
    expect(STATUS_TRANSITIONS.ARCHIVED).toHaveLength(0);
  });

  it("BLOCKED est terminal (aucune transition)", () => {
    expect(STATUS_TRANSITIONS.BLOCKED).toHaveLength(0);
  });

  // ─── W2 — Validation client externe ────────────────────────────────────────

  it("READY_FOR_CM → AWAITING_CLIENT (envoi pour validation client)", () => {
    expect(STATUS_TRANSITIONS.READY_FOR_CM).toContain("AWAITING_CLIENT");
  });

  it("AWAITING_CLIENT → SCHEDULED (client valide)", () => {
    expect(STATUS_TRANSITIONS.AWAITING_CLIENT).toContain("SCHEDULED");
  });

  it("AWAITING_CLIENT → CLIENT_REVISION (client refuse avec commentaire)", () => {
    expect(STATUS_TRANSITIONS.AWAITING_CLIENT).toContain("CLIENT_REVISION");
  });

  it("AWAITING_CLIENT → CANCELLED (client annule)", () => {
    expect(STATUS_TRANSITIONS.AWAITING_CLIENT).toContain("CANCELLED");
  });

  it("CLIENT_REVISION → AWAITING_CLIENT (renvoi après corrections)", () => {
    expect(STATUS_TRANSITIONS.CLIENT_REVISION).toContain("AWAITING_CLIENT");
  });

  it("CLIENT_REVISION → IN_EDIT (retour montage si gros changement)", () => {
    expect(STATUS_TRANSITIONS.CLIENT_REVISION).toContain("IN_EDIT");
  });

  it("CLIENT_REVISION → CANCELLED (annulation complète)", () => {
    expect(STATUS_TRANSITIONS.CLIENT_REVISION).toContain("CANCELLED");
  });
});

// ─── computeAutoTransition ────────────────────────────────────────────────────

describe("computeAutoTransition", () => {
  describe("RUSHES_UPLOADED_FIRST", () => {
    it("DRAFT → RUSHES_RECEIVED", () => {
      expect(computeAutoTransition("DRAFT", "RUSHES_UPLOADED_FIRST")).toBe("RUSHES_RECEIVED");
    });
    it("PLANNED → RUSHES_RECEIVED", () => {
      expect(computeAutoTransition("PLANNED", "RUSHES_UPLOADED_FIRST")).toBe("RUSHES_RECEIVED");
    });
    it("RUSHES_EXPECTED → RUSHES_RECEIVED", () => {
      expect(computeAutoTransition("RUSHES_EXPECTED", "RUSHES_UPLOADED_FIRST")).toBe("RUSHES_RECEIVED");
    });
    it("RUSHES_RECEIVED (déjà reçu) → null", () => {
      expect(computeAutoTransition("RUSHES_RECEIVED", "RUSHES_UPLOADED_FIRST")).toBeNull();
    });
    it("IN_EDIT (rush ajouté en cours de montage) → null", () => {
      expect(computeAutoTransition("IN_EDIT", "RUSHES_UPLOADED_FIRST")).toBeNull();
    });
  });

  describe("VERSION_UPLOADED_FIRST", () => {
    it("RUSHES_RECEIVED → EDIT_REVIEW", () => {
      expect(computeAutoTransition("RUSHES_RECEIVED", "VERSION_UPLOADED_FIRST")).toBe("EDIT_REVIEW");
    });
    it("IN_EDIT → EDIT_REVIEW", () => {
      expect(computeAutoTransition("IN_EDIT", "VERSION_UPLOADED_FIRST")).toBe("EDIT_REVIEW");
    });
    it("DRAFT (pas encore reçu) → null", () => {
      expect(computeAutoTransition("DRAFT", "VERSION_UPLOADED_FIRST")).toBeNull();
    });
  });

  describe("VERSION_UPLOADED_AGAIN", () => {
    it("EDIT_APPROVED → EDIT_REVIEW (demande de retour montage)", () => {
      expect(computeAutoTransition("EDIT_APPROVED", "VERSION_UPLOADED_AGAIN")).toBe("EDIT_REVIEW");
    });
    it("IN_EDIT (nouvelle version en cours) → null", () => {
      expect(computeAutoTransition("IN_EDIT", "VERSION_UPLOADED_AGAIN")).toBeNull();
    });
  });

  describe("VERSION_PROMOTED", () => {
    it("statuts de montage amont → EDIT_APPROVED", () => {
      expect(computeAutoTransition("EDIT_REVIEW", "VERSION_PROMOTED")).toBe("EDIT_APPROVED");
      expect(computeAutoTransition("IN_EDIT", "VERSION_PROMOTED")).toBe("EDIT_APPROVED");
    });
    it("garde 2026-05-30 : ne régresse pas un slot déjà avancé", () => {
      // Promouvoir une version d'un slot SCHEDULED/PUBLISHED ne doit pas le
      // ramener en EDIT_APPROVED (perte de date programmée côté CM).
      expect(computeAutoTransition("CAPTIONS_PENDING", "VERSION_PROMOTED")).toBeNull();
      expect(computeAutoTransition("SCHEDULED", "VERSION_PROMOTED")).toBeNull();
      expect(computeAutoTransition("PUBLISHED", "VERSION_PROMOTED")).toBeNull();
    });
  });
});

// ─── computeAutoTransitionTargetPure (pipeline RunPod) ────────────────────────

describe("computeAutoTransitionTargetPure — règles auto_template", () => {
  const autoTemplatePattern = { source: "auto_template", needsCaptions: false };
  const autoTemplateWithCaptions = { source: "auto_template", needsCaptions: true };

  it("retourne IN_PROGRESS si render PENDING (TO_DO → IN_PROGRESS)", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "TO_DO",
        pattern: autoTemplatePattern,
        render: { status: "PENDING" },
        latestCaptionJobStatus: null,
      }),
    ).toBe("IN_PROGRESS");
  });

  it("retourne IN_PROGRESS si render PROCESSING (TO_DO → IN_PROGRESS)", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "TO_DO",
        pattern: autoTemplatePattern,
        render: { status: "PROCESSING" },
        latestCaptionJobStatus: null,
      }),
    ).toBe("IN_PROGRESS");
  });

  it("retourne IN_PROGRESS si render ERROR (le CM verra l'erreur, pas READY_FOR_CM)", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "TO_DO",
        pattern: autoTemplatePattern,
        render: { status: "ERROR" },
        latestCaptionJobStatus: null,
      }),
    ).toBe("IN_PROGRESS");
  });

  it("retourne READY_FOR_CM si render DONE et pas de captions à faire", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "TO_DO",
        pattern: autoTemplatePattern,
        render: { status: "DONE" },
        latestCaptionJobStatus: null,
      }),
    ).toBe("READY_FOR_CM");
  });

  it("retourne IN_PROGRESS si render DONE mais captions encore PROCESSING", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "TO_DO",
        pattern: autoTemplateWithCaptions,
        render: { status: "DONE" },
        latestCaptionJobStatus: "PROCESSING",
      }),
    ).toBe("IN_PROGRESS");
  });

  it("retourne IN_PROGRESS si render DONE mais captions QUEUED", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "TO_DO",
        pattern: autoTemplateWithCaptions,
        render: { status: "DONE" },
        latestCaptionJobStatus: "QUEUED",
      }),
    ).toBe("IN_PROGRESS");
  });

  it("retourne READY_FOR_CM si render DONE et aucun captionJob (pipeline jamais lancé)", () => {
    // Le pipeline captions n'a jamais été déclenché (vieux render, ou trigger
    // qui a fail silencieusement) — on ne bloque pas le CM.
    expect(
      computeAutoTransitionTargetPure({
        status: "TO_DO",
        pattern: autoTemplateWithCaptions,
        render: { status: "DONE" },
        latestCaptionJobStatus: null,
      }),
    ).toBe("READY_FOR_CM");
  });

  it("retourne READY_FOR_CM si render DONE + captions COMPLETED", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "TO_DO",
        pattern: autoTemplateWithCaptions,
        render: { status: "DONE" },
        latestCaptionJobStatus: "COMPLETED",
      }),
    ).toBe("READY_FOR_CM");
  });

  it("retourne IN_PROGRESS si captions FAILED (admin doit relancer ou débloquer)", () => {
    // Avant 2026-05-31 : on transitionnait en READY_FOR_CM, le CM pouvait
    // publier sans sous-titres alors qu'ils étaient exigés. Désormais on
    // reste en IN_PROGRESS jusqu'à action explicite admin.
    expect(
      computeAutoTransitionTargetPure({
        status: "TO_DO",
        pattern: autoTemplateWithCaptions,
        render: { status: "DONE" },
        latestCaptionJobStatus: "FAILED",
      }),
    ).toBe("IN_PROGRESS");
  });
});

describe("computeAutoTransitionTargetPure — idempotence et scope", () => {
  it("retourne null si slot.status n'est pas piloté pipeline (déjà avancé manuellement)", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "IN_EDIT",
        pattern: { source: "auto_template", needsCaptions: false },
        render: { status: "DONE" },
        latestCaptionJobStatus: null,
      }),
    ).toBeNull();
    expect(
      computeAutoTransitionTargetPure({
        status: "SCHEDULED",
        pattern: { source: "auto_template", needsCaptions: false },
        render: { status: "DONE" },
        latestCaptionJobStatus: null,
      }),
    ).toBeNull();
    expect(
      computeAutoTransitionTargetPure({
        status: "PUBLISHED",
        pattern: { source: "auto_template", needsCaptions: false },
        render: { status: "DONE" },
        latestCaptionJobStatus: null,
      }),
    ).toBeNull();
  });

  it("idempotence : retourne null si déjà IN_PROGRESS et render PROCESSING", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "IN_PROGRESS",
        pattern: { source: "auto_template", needsCaptions: false },
        render: { status: "PROCESSING" },
        latestCaptionJobStatus: null,
      }),
    ).toBeNull();
  });

  it("idempotence : retourne null si déjà READY_FOR_CM et render DONE", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "READY_FOR_CM",
        pattern: { source: "auto_template", needsCaptions: false },
        render: { status: "DONE" },
        latestCaptionJobStatus: null,
      }),
    ).toBeNull();
  });

  it("transitionne IN_PROGRESS → READY_FOR_CM quand render DONE + captions COMPLETED", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "IN_PROGRESS",
        pattern: { source: "auto_template", needsCaptions: true },
        render: { status: "DONE" },
        latestCaptionJobStatus: "COMPLETED",
      }),
    ).toBe("READY_FOR_CM");
  });

  it("retourne null si pattern.source = manual_rushes (autre flow)", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "TO_DO",
        pattern: { source: "manual_rushes", needsCaptions: false },
        render: { status: "DONE" },
        latestCaptionJobStatus: null,
      }),
    ).toBeNull();
  });

  it("retourne null si pattern.source = external_upload", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "TO_DO",
        pattern: { source: "external_upload", needsCaptions: false },
        render: { status: "DONE" },
        latestCaptionJobStatus: null,
      }),
    ).toBeNull();
  });

  it("retourne null si pattern est null", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "TO_DO",
        pattern: null,
        render: { status: "DONE" },
        latestCaptionJobStatus: null,
      }),
    ).toBeNull();
  });

  it("retourne null si render est null (pas encore créé)", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "TO_DO",
        pattern: { source: "auto_template", needsCaptions: false },
        render: null,
        latestCaptionJobStatus: null,
      }),
    ).toBeNull();
  });
});

// ─── Initial statuses modernes (PLANNED, DRAFT) — régression historique ──────
//
// Les slots auto_template sont créés en PLANNED (mapSourceToInitialStatus).
// Avant le fix, PIPELINE_DRIVEN_STATUSES ne contenait que TO_DO/IN_PROGRESS/
// READY_FOR_CM → un slot PLANNED restait bloqué même quand son Render passait
// DONE. Ces tests figent l'invariant pour les statuts initiaux modernes.

describe("computeAutoTransitionTargetPure — statuts initiaux modernes", () => {
  const autoTemplate = { source: "auto_template", needsCaptions: false };
  const autoTemplateWithCaptions = { source: "auto_template", needsCaptions: true };

  it("PLANNED + render DONE + pas de captions → READY_FOR_CM", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "PLANNED",
        pattern: autoTemplate,
        render: { status: "DONE" },
        latestCaptionJobStatus: null,
      }),
    ).toBe("READY_FOR_CM");
  });

  it("PLANNED + render PROCESSING → IN_PROGRESS", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "PLANNED",
        pattern: autoTemplate,
        render: { status: "PROCESSING" },
        latestCaptionJobStatus: null,
      }),
    ).toBe("IN_PROGRESS");
  });

  it("PLANNED + render DONE + captions COMPLETED → READY_FOR_CM", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "PLANNED",
        pattern: autoTemplateWithCaptions,
        render: { status: "DONE" },
        latestCaptionJobStatus: "COMPLETED",
      }),
    ).toBe("READY_FOR_CM");
  });

  it("PLANNED + render DONE + captions PROCESSING → IN_PROGRESS", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "PLANNED",
        pattern: autoTemplateWithCaptions,
        render: { status: "DONE" },
        latestCaptionJobStatus: "PROCESSING",
      }),
    ).toBe("IN_PROGRESS");
  });

  it("DRAFT + render DONE → READY_FOR_CM (cas createSlot sans pattern)", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "DRAFT",
        pattern: autoTemplate,
        render: { status: "DONE" },
        latestCaptionJobStatus: null,
      }),
    ).toBe("READY_FOR_CM");
  });
});
