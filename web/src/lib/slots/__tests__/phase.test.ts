import { describe, it, expect } from "vitest";
import {
  getPublicationPhase,
  PHASE_LABELS,
  PHASE_COLORS,
  type PublicationPhase,
} from "@/lib/slots/phase";

describe("getPublicationPhase", () => {
  it("DRAFT et PLANNED → planned", () => {
    expect(getPublicationPhase("DRAFT")).toBe("planned");
    expect(getPublicationPhase("PLANNED")).toBe("planned");
  });

  it("RUSHES_EXPECTED → shooting", () => {
    expect(getPublicationPhase("RUSHES_EXPECTED")).toBe("shooting");
  });

  it("toute la phase montage → production", () => {
    expect(getPublicationPhase("RUSHES_RECEIVED")).toBe("production");
    expect(getPublicationPhase("IN_EDIT")).toBe("production");
    expect(getPublicationPhase("EDIT_APPROVED")).toBe("production");
    expect(getPublicationPhase("CAPTIONS_PENDING")).toBe("production");
  });

  it("EDIT_REVIEW → admin_review (Phase 2.3 : sa propre phase)", () => {
    expect(getPublicationPhase("EDIT_REVIEW")).toBe("admin_review");
  });

  it("phase CM (cover, description, validation client) → cm_review", () => {
    // "À finaliser" : il reste cover et/ou description et/ou validation client.
    // Distincte de "À publier" qui est strictement réservée à SCHEDULED.
    expect(getPublicationPhase("READY_FOR_CM")).toBe("cm_review");
    expect(getPublicationPhase("AWAITING_CLIENT")).toBe("cm_review");
    expect(getPublicationPhase("CLIENT_REVISION")).toBe("cm_review");
  });

  it("SCHEDULED → publishing (et seulement SCHEDULED — tout est validé)", () => {
    expect(getPublicationPhase("SCHEDULED")).toBe("publishing");
  });

  it("PUBLISHED → published", () => {
    expect(getPublicationPhase("PUBLISHED")).toBe("published");
  });

  it("statuts terminaux → terminated", () => {
    expect(getPublicationPhase("CANCELLED")).toBe("terminated");
    expect(getPublicationPhase("REJECTED")).toBe("terminated");
    expect(getPublicationPhase("ARCHIVED")).toBe("terminated");
    expect(getPublicationPhase("BLOCKED")).toBe("terminated");
  });

  it("statuts legacy mappés raisonnablement", () => {
    expect(getPublicationPhase("TO_DO")).toBe("planned");
    expect(getPublicationPhase("IN_PROGRESS")).toBe("production");
    expect(getPublicationPhase("READY")).toBe("cm_review");
    expect(getPublicationPhase("CHECKING")).toBe("cm_review");
    expect(getPublicationPhase("DONE")).toBe("published");
  });
});

describe("PHASE_LABELS / PHASE_COLORS", () => {
  const phases: PublicationPhase[] = [
    "planned",
    "shooting",
    "production",
    "admin_review",
    "cm_review",
    "publishing",
    "published",
    "terminated",
  ];

  it("toutes les phases ont un label FR non vide", () => {
    for (const phase of phases) {
      expect(PHASE_LABELS[phase]).toBeTruthy();
      expect(PHASE_LABELS[phase].length).toBeGreaterThan(0);
    }
  });

  it("toutes les phases ont une couleur tailwind", () => {
    for (const phase of phases) {
      expect(PHASE_COLORS[phase]).toContain("bg-");
      expect(PHASE_COLORS[phase]).toContain("text-");
    }
  });
});
