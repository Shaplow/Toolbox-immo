import { describe, it, expect } from "vitest";
import {
  canSeePublication,
  canAssignMonteur,
  canAssignCm,
  canEditPublicationVersion,
  canCommentOnPublication,
  canMarkPublished,
  canEditComment,
} from "@/lib/permissions/publications";
import type { AppUserIdentity } from "@/lib/userContext";

function makeUser(
  role: "ADMIN" | "MONTEUR" | "CM" | "USER",
  id = "user-123"
): AppUserIdentity {
  return {
    id,
    name: "Test",
    email: "test@local",
    role,
    permissions: "[]",
  };
}

const USER_ID = "user-123";
const OTHER_ID = "other-user";

describe("canSeePublication", () => {
  it("ADMIN sees everything", () => {
    expect(
      canSeePublication(makeUser("ADMIN"), {
        id: "s1",
        assigneeMonteurId: OTHER_ID,
        assigneeCmId: OTHER_ID,
      })
    ).toBe(true);
  });

  it("MONTEUR sees only own assigned slots", () => {
    const m = makeUser("MONTEUR", USER_ID);
    expect(
      canSeePublication(m, { id: "s1", assigneeMonteurId: USER_ID, assigneeCmId: null })
    ).toBe(true);
    expect(
      canSeePublication(m, { id: "s2", assigneeMonteurId: OTHER_ID, assigneeCmId: null })
    ).toBe(false);
  });

  it("CM sees only own assigned slots", () => {
    const c = makeUser("CM", USER_ID);
    expect(
      canSeePublication(c, { id: "s1", assigneeMonteurId: null, assigneeCmId: USER_ID })
    ).toBe(true);
    expect(
      canSeePublication(c, { id: "s2", assigneeMonteurId: null, assigneeCmId: OTHER_ID })
    ).toBe(false);
  });

  it("USER sees nothing", () => {
    expect(
      canSeePublication(makeUser("USER"), {
        id: "s1",
        assigneeMonteurId: USER_ID,
        assigneeCmId: USER_ID,
      })
    ).toBe(false);
  });
});

describe("canAssignMonteur / canAssignCm", () => {
  it("only ADMIN can assign", () => {
    expect(canAssignMonteur(makeUser("ADMIN"))).toBe(true);
    expect(canAssignMonteur(makeUser("MONTEUR"))).toBe(false);
    expect(canAssignMonteur(makeUser("CM"))).toBe(false);
    expect(canAssignMonteur(makeUser("USER"))).toBe(false);

    expect(canAssignCm(makeUser("ADMIN"))).toBe(true);
    expect(canAssignCm(makeUser("MONTEUR"))).toBe(false);
    expect(canAssignCm(makeUser("CM"))).toBe(false);
    expect(canAssignCm(makeUser("USER"))).toBe(false);
  });
});

describe("canEditPublicationVersion", () => {
  it("ADMIN can always edit version", () => {
    expect(
      canEditPublicationVersion(makeUser("ADMIN"), {
        id: "s1",
        assigneeMonteurId: OTHER_ID,
        assigneeCmId: OTHER_ID,
      })
    ).toBe(true);
  });

  it("MONTEUR can edit version only if assigned (not CM)", () => {
    const m = makeUser("MONTEUR", USER_ID);
    expect(
      canEditPublicationVersion(m, {
        id: "s1",
        assigneeMonteurId: USER_ID,
        assigneeCmId: null,
      })
    ).toBe(true);
    expect(
      canEditPublicationVersion(m, {
        id: "s2",
        assigneeMonteurId: OTHER_ID,
        assigneeCmId: null,
      })
    ).toBe(false);
  });

  it("CM cannot edit version (it's the monteur's job)", () => {
    expect(
      canEditPublicationVersion(makeUser("CM", USER_ID), {
        id: "s1",
        assigneeMonteurId: null,
        assigneeCmId: USER_ID,
      })
    ).toBe(false);
  });
});

describe("canMarkPublished", () => {
  it("ADMIN can mark anything published", () => {
    expect(
      canMarkPublished(
        { id: "u", role: "ADMIN" },
        { assigneeCmId: OTHER_ID }
      )
    ).toBe(true);
  });

  it("CM can mark published only if assigned (security : Phase 1.3.3 H1 fix)", () => {
    expect(
      canMarkPublished(
        { id: USER_ID, role: "CM" },
        { assigneeCmId: USER_ID }
      )
    ).toBe(true);
    expect(
      canMarkPublished(
        { id: USER_ID, role: "CM" },
        { assigneeCmId: OTHER_ID }
      )
    ).toBe(false);
  });

  it("MONTEUR cannot mark published (escalation defense)", () => {
    expect(
      canMarkPublished(
        { id: USER_ID, role: "MONTEUR" },
        { assigneeCmId: USER_ID }
      )
    ).toBe(false);
  });

  it("USER cannot mark published", () => {
    expect(
      canMarkPublished(
        { id: USER_ID, role: "USER" },
        { assigneeCmId: USER_ID }
      )
    ).toBe(false);
  });
});

describe("canCommentOnPublication", () => {
  it("equivalent to canSeePublication (see = comment)", () => {
    const slot = { assigneeMonteurId: USER_ID, assigneeCmId: OTHER_ID };
    expect(canCommentOnPublication({ id: "x", role: "ADMIN" }, slot)).toBe(true);
    expect(canCommentOnPublication({ id: USER_ID, role: "MONTEUR" }, slot)).toBe(true);
    expect(canCommentOnPublication({ id: USER_ID, role: "CM" }, slot)).toBe(false);
    expect(canCommentOnPublication({ id: USER_ID, role: "USER" }, slot)).toBe(false);
  });
});

describe("canEditComment", () => {
  it("author can edit own comment", () => {
    expect(
      canEditComment({ id: USER_ID, role: "USER" }, { authorId: USER_ID })
    ).toBe(true);
  });

  it("ADMIN can edit any comment", () => {
    expect(
      canEditComment({ id: OTHER_ID, role: "ADMIN" }, { authorId: USER_ID })
    ).toBe(true);
  });

  it("non-author non-admin cannot edit", () => {
    expect(
      canEditComment({ id: OTHER_ID, role: "MONTEUR" }, { authorId: USER_ID })
    ).toBe(false);
    expect(
      canEditComment({ id: OTHER_ID, role: "CM" }, { authorId: USER_ID })
    ).toBe(false);
  });
});
