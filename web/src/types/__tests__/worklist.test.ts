/**
 * Tests sur les helpers worklist — focus sur la gestion du scheduledAt
 * nullable introduit pour la banque de contenus.
 */

import { describe, it, expect } from "vitest";
import { isSlotOverdue, type WorklistSlot } from "@/types/worklist";

function makeSlot(partial: Partial<WorklistSlot>): WorklistSlot {
  return {
    id: "s1",
    title: null,
    scheduledAt: new Date(),
    status: "PLANNED",
    notes: null,
    assigneeMonteurId: null,
    assigneeCmId: null,
    assigneeVideasteId: null,
    account: { id: "a1", handle: "acc", name: "Acc" },
    pattern: null,
    ...partial,
  };
}

describe("isSlotOverdue — banque (scheduledAt nullable)", () => {
  it("scheduledAt null → false (slot banque, jamais overdue)", () => {
    const slot = makeSlot({ scheduledAt: null, status: "RUSHES_EXPECTED" });
    expect(isSlotOverdue(slot)).toBe(false);
  });

  it("scheduledAt passé + status non terminal → true", () => {
    const past = new Date(Date.now() - 24 * 3600 * 1000);
    const slot = makeSlot({ scheduledAt: past, status: "PLANNED" });
    expect(isSlotOverdue(slot)).toBe(true);
  });

  it("scheduledAt passé + status PUBLISHED → false (terminal)", () => {
    const past = new Date(Date.now() - 24 * 3600 * 1000);
    const slot = makeSlot({ scheduledAt: past, status: "PUBLISHED" });
    expect(isSlotOverdue(slot)).toBe(false);
  });

  it("scheduledAt futur → false", () => {
    const future = new Date(Date.now() + 24 * 3600 * 1000);
    const slot = makeSlot({ scheduledAt: future, status: "PLANNED" });
    expect(isSlotOverdue(slot)).toBe(false);
  });
});
