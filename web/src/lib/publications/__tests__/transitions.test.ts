import { describe, it, expect } from "vitest";
import {
  canTransition,
  computeAutoTransition,
  computeAutoTransitionTargetPure,
  STATUS_TRANSITIONS,
} from "@/lib/publications/transitions";
import type { SlotStatus } from "@/types/roles";

// ─── canTransition ─────────────────────────────────────────────────────────────

describe("canTransition — ADMIN bypass", () => {
  it("ADMIN peut transitionner vers n'importe quel statut", () => {
    expect(canTransition("PUBLISHED", "DRAFT", "ADMIN")).toBe(true);
    expect(canTransition("ARCHIVED", "DRAFT", "ADMIN")).toBe(true);
    expect(canTransition("BLOCKED", "PLANNED", "ADMIN")).toBe(true);
  });
});

describe("canTransition — statuts legacy tolérés", () => {
  const legacyStatuses = ["TO_DO", "IN_PROGRESS", "READY", "CHECKING", "DONE"];
  for (const s of legacyStatuses) {
    it(`tolère le statut legacy "${s}" en source pour MONTEUR`, () => {
      expect(canTransition(s, "PLANNED", "MONTEUR")).toBe(true);
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
    it("tout statut → EDIT_APPROVED", () => {
      expect(computeAutoTransition("EDIT_REVIEW", "VERSION_PROMOTED")).toBe("EDIT_APPROVED");
      expect(computeAutoTransition("CAPTIONS_PENDING", "VERSION_PROMOTED")).toBe("EDIT_APPROVED");
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

  it("retourne IN_PROGRESS si render DONE mais aucun captionJob encore créé", () => {
    expect(
      computeAutoTransitionTargetPure({
        status: "TO_DO",
        pattern: autoTemplateWithCaptions,
        render: { status: "DONE" },
        latestCaptionJobStatus: null,
      }),
    ).toBe("IN_PROGRESS");
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

  it("retourne IN_PROGRESS si captions FAILED (on n'avance pas sur un échec)", () => {
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
