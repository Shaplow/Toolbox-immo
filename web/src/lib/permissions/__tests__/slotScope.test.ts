import { describe, it, expect } from "vitest";
import {
  whereClauseForUser,
  canUserAccessSlot,
  ALLOWED_PATCH_FIELDS_BY_ROLE,
  isValidSlotStatus,
} from "@/lib/permissions/slotScope";

describe("whereClauseForUser", () => {
  const USER_ID = "user-123";

  it("ADMIN → no restriction (empty where)", () => {
    expect(whereClauseForUser("ADMIN", USER_ID)).toEqual({});
  });

  it("MONTEUR → scoped on assigneeMonteurId", () => {
    expect(whereClauseForUser("MONTEUR", USER_ID)).toEqual({
      assigneeMonteurId: USER_ID,
    });
  });

  it("CM → scoped on assigneeCmId", () => {
    expect(whereClauseForUser("CM", USER_ID)).toEqual({
      assigneeCmId: USER_ID,
    });
  });

  it("VIDEASTE → scoped on assigneeVideasteId", () => {
    expect(whereClauseForUser("VIDEASTE", USER_ID)).toEqual({
      assigneeVideasteId: USER_ID,
    });
  });

  it("USER → impossible id (no slot match)", () => {
    expect(whereClauseForUser("EXTERNAL_GENERATOR", USER_ID)).toEqual({
      id: "__never__",
    });
  });

  it("unknown role → fallback to USER (impossible id)", () => {
    // @ts-expect-error — test du fallback runtime
    expect(whereClauseForUser("HACKER", USER_ID)).toEqual({
      id: "__never__",
    });
  });
});

describe("canUserAccessSlot", () => {
  const USER_ID = "user-123";
  const OTHER_USER_ID = "other-user";

  const slotAssignedToUser = {
    assigneeMonteurId: USER_ID,
    assigneeCmId: USER_ID,
  };
  const slotAssignedToOther = {
    assigneeMonteurId: OTHER_USER_ID,
    assigneeCmId: OTHER_USER_ID,
  };
  const slotUnassigned = {
    assigneeMonteurId: null,
    assigneeCmId: null,
  };

  it("ADMIN → always true (assigned, other, unassigned)", () => {
    expect(canUserAccessSlot(slotAssignedToUser, "ADMIN", USER_ID)).toBe(true);
    expect(canUserAccessSlot(slotAssignedToOther, "ADMIN", USER_ID)).toBe(true);
    expect(canUserAccessSlot(slotUnassigned, "ADMIN", USER_ID)).toBe(true);
  });

  it("MONTEUR → true only when assigneeMonteurId matches", () => {
    expect(canUserAccessSlot(slotAssignedToUser, "MONTEUR", USER_ID)).toBe(true);
    expect(canUserAccessSlot(slotAssignedToOther, "MONTEUR", USER_ID)).toBe(false);
    expect(canUserAccessSlot(slotUnassigned, "MONTEUR", USER_ID)).toBe(false);
  });

  it("CM → true only when assigneeCmId matches", () => {
    expect(canUserAccessSlot(slotAssignedToUser, "CM", USER_ID)).toBe(true);
    expect(canUserAccessSlot(slotAssignedToOther, "CM", USER_ID)).toBe(false);
    expect(canUserAccessSlot(slotUnassigned, "CM", USER_ID)).toBe(false);
  });

  it("VIDEASTE → true only when assigneeVideasteId matches", () => {
    expect(
      canUserAccessSlot({ ...slotAssignedToUser, assigneeVideasteId: USER_ID }, "VIDEASTE", USER_ID),
    ).toBe(true);
    expect(
      canUserAccessSlot({ ...slotAssignedToUser, assigneeVideasteId: OTHER_USER_ID }, "VIDEASTE", USER_ID),
    ).toBe(false);
    expect(canUserAccessSlot(slotUnassigned, "VIDEASTE", USER_ID)).toBe(false);
  });

  it("USER → always false", () => {
    expect(canUserAccessSlot(slotAssignedToUser, "EXTERNAL_GENERATOR", USER_ID)).toBe(false);
    expect(canUserAccessSlot(slotAssignedToOther, "EXTERNAL_GENERATOR", USER_ID)).toBe(false);
  });

  it("cross-role isolation : MONTEUR assigned only as CM → no access", () => {
    const slot = { assigneeMonteurId: null, assigneeCmId: USER_ID };
    expect(canUserAccessSlot(slot, "MONTEUR", USER_ID)).toBe(false);
  });

  it("cross-role isolation : CM assigned only as MONTEUR → no access", () => {
    const slot = { assigneeMonteurId: USER_ID, assigneeCmId: null };
    expect(canUserAccessSlot(slot, "CM", USER_ID)).toBe(false);
  });
});

describe("ALLOWED_PATCH_FIELDS_BY_ROLE — security invariants", () => {
  it("MONTEUR cannot modify assignees (security : would break scoping)", () => {
    expect(ALLOWED_PATCH_FIELDS_BY_ROLE.MONTEUR).not.toContain("assigneeMonteurId");
    expect(ALLOWED_PATCH_FIELDS_BY_ROLE.MONTEUR).not.toContain("assigneeCmId");
  });

  it("CM cannot modify assignees (security : same reason)", () => {
    expect(ALLOWED_PATCH_FIELDS_BY_ROLE.CM).not.toContain("assigneeMonteurId");
    expect(ALLOWED_PATCH_FIELDS_BY_ROLE.CM).not.toContain("assigneeCmId");
  });

  it("MONTEUR/CM can modify status, notes, description (operational)", () => {
    for (const role of ["MONTEUR", "CM"] as const) {
      expect(ALLOWED_PATCH_FIELDS_BY_ROLE[role]).toContain("status");
      expect(ALLOWED_PATCH_FIELDS_BY_ROLE[role]).toContain("notes");
      expect(ALLOWED_PATCH_FIELDS_BY_ROLE[role]).toContain("description");
    }
  });

  it("CM can modify description (Phase 2.1 — légende IG unifiée)", () => {
    expect(ALLOWED_PATCH_FIELDS_BY_ROLE.CM).toContain("description");
    expect(ALLOWED_PATCH_FIELDS_BY_ROLE.CM).toContain("title");
  });

  it("aucun rôle ne peut PATCH caption — champ supprimé Phase 2.1", () => {
    for (const role of ["ADMIN", "MONTEUR", "CM", "VIDEASTE", "EXTERNAL_GENERATOR"] as const) {
      expect(ALLOWED_PATCH_FIELDS_BY_ROLE[role]).not.toContain("caption");
    }
  });

  it("USER has no allowed fields", () => {
    expect(ALLOWED_PATCH_FIELDS_BY_ROLE.EXTERNAL_GENERATOR).toEqual([]);
  });

  it("ADMIN can modify assignees and pattern (override capability)", () => {
    expect(ALLOWED_PATCH_FIELDS_BY_ROLE.ADMIN).toContain("assigneeMonteurId");
    expect(ALLOWED_PATCH_FIELDS_BY_ROLE.ADMIN).toContain("assigneeCmId");
    expect(ALLOWED_PATCH_FIELDS_BY_ROLE.ADMIN).toContain("assigneeVideasteId");
    expect(ALLOWED_PATCH_FIELDS_BY_ROLE.ADMIN).toContain("patternId");
  });

  it("ADMIN can modify Phase 5 one-off overrides (cover/captions/description presets)", () => {
    expect(ALLOWED_PATCH_FIELDS_BY_ROLE.ADMIN).toContain("coverModeOverride");
    expect(ALLOWED_PATCH_FIELDS_BY_ROLE.ADMIN).toContain("coverPresetIdOverride");
    expect(ALLOWED_PATCH_FIELDS_BY_ROLE.ADMIN).toContain("captionPresetIdOverride");
    expect(ALLOWED_PATCH_FIELDS_BY_ROLE.ADMIN).toContain("descriptionPromptIdOverride");
  });

  it("Non-ADMIN roles cannot modify Phase 5 one-off overrides (security)", () => {
    for (const role of ["MONTEUR", "CM", "VIDEASTE", "EXTERNAL_GENERATOR"] as const) {
      expect(ALLOWED_PATCH_FIELDS_BY_ROLE[role]).not.toContain("coverModeOverride");
      expect(ALLOWED_PATCH_FIELDS_BY_ROLE[role]).not.toContain("coverPresetIdOverride");
      expect(ALLOWED_PATCH_FIELDS_BY_ROLE[role]).not.toContain("captionPresetIdOverride");
      expect(ALLOWED_PATCH_FIELDS_BY_ROLE[role]).not.toContain("descriptionPromptIdOverride");
    }
  });

  it("VIDEASTE can modify status + notes only (rapport de shoot)", () => {
    expect(ALLOWED_PATCH_FIELDS_BY_ROLE.VIDEASTE).toEqual(["status", "notes"]);
    expect(ALLOWED_PATCH_FIELDS_BY_ROLE.VIDEASTE).not.toContain("assigneeVideasteId");
    expect(ALLOWED_PATCH_FIELDS_BY_ROLE.VIDEASTE).not.toContain("description");
  });
});

describe("isValidSlotStatus", () => {
  it("accepts new pipeline statuses", () => {
    expect(isValidSlotStatus("DRAFT")).toBe(true);
    expect(isValidSlotStatus("PLANNED")).toBe(true);
    expect(isValidSlotStatus("IN_EDIT")).toBe(true);
    expect(isValidSlotStatus("PUBLISHED")).toBe(true);
    expect(isValidSlotStatus("ARCHIVED")).toBe(true);
  });

  it("accepts legacy statuses (cohabitation)", () => {
    expect(isValidSlotStatus("TO_DO")).toBe(true);
    expect(isValidSlotStatus("IN_PROGRESS")).toBe(true);
    expect(isValidSlotStatus("READY")).toBe(true);
    expect(isValidSlotStatus("CHECKING")).toBe(true);
    expect(isValidSlotStatus("DONE")).toBe(true);
  });

  it("rejects unknown strings", () => {
    expect(isValidSlotStatus("UNKNOWN")).toBe(false);
    expect(isValidSlotStatus("draft")).toBe(false); // case-sensitive
    expect(isValidSlotStatus("")).toBe(false);
  });

  it("rejects non-string types (security)", () => {
    expect(isValidSlotStatus(null)).toBe(false);
    expect(isValidSlotStatus(undefined)).toBe(false);
    expect(isValidSlotStatus(123)).toBe(false);
    expect(isValidSlotStatus({})).toBe(false);
    expect(isValidSlotStatus([])).toBe(false);
  });

  it("rejects Object.prototype properties (prototype pollution defense)", () => {
    // Uses Object.hasOwn instead of `in` to avoid these passing validation
    expect(isValidSlotStatus("toString")).toBe(false);
    expect(isValidSlotStatus("constructor")).toBe(false);
    expect(isValidSlotStatus("__proto__")).toBe(false);
    expect(isValidSlotStatus("hasOwnProperty")).toBe(false);
  });
});
