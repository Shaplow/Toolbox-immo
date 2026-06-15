import { describe, it, expect } from "vitest";
import type { SlotStatus } from "@/types/calendar";
import { getMacroStep, MACRO_STEP_ORDER, MACRO_STEPS } from "../macroStep";

describe("getMacroStep", () => {
  it("maps all 17 modern statuses without throwing", () => {
    const allStatuses: SlotStatus[] = [
      "DRAFT",
      "PLANNED",
      "RUSHES_EXPECTED",
      "RUSHES_RECEIVED",
      "IN_EDIT",
      "EDIT_REVIEW",
      "EDIT_APPROVED",
      "CAPTIONS_PENDING",
      "READY_FOR_CM",
      "AWAITING_CLIENT",
      "CLIENT_REVISION",
      "SCHEDULED",
      "PUBLISHED",
      "REJECTED",
      "CANCELLED",
      "BLOCKED",
      "ARCHIVED",
    ];
    allStatuses.forEach((s) => {
      const step = getMacroStep(s);
      expect(MACRO_STEPS[step]).toBeDefined();
    });
  });

  it("maps legacy aliases (TO_DO/IN_PROGRESS/READY/CHECKING/DONE)", () => {
    expect(getMacroStep("TO_DO" as SlotStatus)).toBe("brief");
    expect(getMacroStep("IN_PROGRESS" as SlotStatus)).toBe("production");
    expect(getMacroStep("READY" as SlotStatus)).toBe("validation");
    expect(getMacroStep("CHECKING" as SlotStatus)).toBe("validation");
    expect(getMacroStep("DONE" as SlotStatus)).toBe("published");
  });

  it("groups production statuses (rushes + edit) under 'production'", () => {
    expect(getMacroStep("RUSHES_EXPECTED")).toBe("production");
    expect(getMacroStep("RUSHES_RECEIVED")).toBe("production");
    expect(getMacroStep("IN_EDIT")).toBe("production");
  });

  it("groups validation statuses (review + captions) under 'validation'", () => {
    expect(getMacroStep("EDIT_REVIEW")).toBe("validation");
    expect(getMacroStep("EDIT_APPROVED")).toBe("validation");
    expect(getMacroStep("CAPTIONS_PENDING")).toBe("validation");
  });

  it("groups CM/client workflow under 'scheduled'", () => {
    expect(getMacroStep("READY_FOR_CM")).toBe("scheduled");
    expect(getMacroStep("AWAITING_CLIENT")).toBe("scheduled");
    expect(getMacroStep("CLIENT_REVISION")).toBe("scheduled");
    expect(getMacroStep("SCHEDULED")).toBe("scheduled");
  });

  it("flags REJECTED/CANCELLED/BLOCKED as 'blocked' (out of normal timeline)", () => {
    expect(getMacroStep("REJECTED")).toBe("blocked");
    expect(getMacroStep("CANCELLED")).toBe("blocked");
    expect(getMacroStep("BLOCKED")).toBe("blocked");
  });

  it("flags PUBLISHED and ARCHIVED both as 'published'", () => {
    expect(getMacroStep("PUBLISHED")).toBe("published");
    expect(getMacroStep("ARCHIVED")).toBe("published");
  });

  it("MACRO_STEP_ORDER contains exactly the 5 narrative steps in order", () => {
    expect(MACRO_STEP_ORDER).toEqual([
      "brief",
      "production",
      "validation",
      "scheduled",
      "published",
    ]);
  });
});
