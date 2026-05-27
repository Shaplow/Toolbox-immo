import { describe, it, expect } from "vitest";
import {
  canSeePublication,
  canAssignMonteur,
  canAssignCm,
  canEditPublicationVersion,
  canCommentOnPublication,
  canMarkPublished,
  canEditComment,
  canUploadRushes,
  canDeleteRushes,
  canUploadVersion,
  canPromoteVersion,
  canDeleteVersion,
  canRestoreVersion,
  canEditBrief,
} from "@/lib/permissions/publications";
import type { AppUserIdentity } from "@/lib/userContext";

function makeUser(
  role: "ADMIN" | "MONTEUR" | "CM" | "EXTERNAL_GENERATOR",
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
      canSeePublication(makeUser("EXTERNAL_GENERATOR"), {
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
    expect(canAssignMonteur(makeUser("EXTERNAL_GENERATOR"))).toBe(false);

    expect(canAssignCm(makeUser("ADMIN"))).toBe(true);
    expect(canAssignCm(makeUser("MONTEUR"))).toBe(false);
    expect(canAssignCm(makeUser("CM"))).toBe(false);
    expect(canAssignCm(makeUser("EXTERNAL_GENERATOR"))).toBe(false);
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
        { id: USER_ID, role: "EXTERNAL_GENERATOR" },
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
    expect(canCommentOnPublication({ id: USER_ID, role: "EXTERNAL_GENERATOR" }, slot)).toBe(false);
  });
});

describe("canEditComment", () => {
  it("author can edit own comment", () => {
    expect(
      canEditComment({ id: USER_ID, role: "EXTERNAL_GENERATOR" }, { authorId: USER_ID })
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

// ─── Rushes ────────────────────────────────────────────────────────────────────

describe("canUploadRushes", () => {
  it("ADMIN peut uploader des rushes partout", () => {
    expect(canUploadRushes({ id: OTHER_ID, role: "ADMIN" }, { assigneeCmId: USER_ID })).toBe(true);
  });

  it("CM assigné peut uploader des rushes", () => {
    expect(canUploadRushes({ id: USER_ID, role: "CM" }, { assigneeCmId: USER_ID })).toBe(true);
  });

  it("CM non assigné ne peut pas uploader des rushes", () => {
    expect(canUploadRushes({ id: USER_ID, role: "CM" }, { assigneeCmId: OTHER_ID })).toBe(false);
  });

  it("MONTEUR ne peut pas uploader des rushes", () => {
    expect(canUploadRushes({ id: USER_ID, role: "MONTEUR" }, { assigneeCmId: USER_ID })).toBe(false);
  });

  it("USER ne peut pas uploader des rushes", () => {
    expect(canUploadRushes({ id: USER_ID, role: "EXTERNAL_GENERATOR" }, { assigneeCmId: USER_ID })).toBe(false);
  });

  it("VIDEASTE assigné peut uploader des rushes (son rôle principal)", () => {
    expect(
      canUploadRushes(
        { id: USER_ID, role: "VIDEASTE" },
        { assigneeCmId: null, assigneeVideasteId: USER_ID },
      ),
    ).toBe(true);
  });

  it("VIDEASTE non assigné ne peut pas uploader des rushes", () => {
    expect(
      canUploadRushes(
        { id: USER_ID, role: "VIDEASTE" },
        { assigneeCmId: null, assigneeVideasteId: OTHER_ID },
      ),
    ).toBe(false);
  });

  it("VIDEASTE sans champ assigneeVideasteId défini (slot legacy) → false", () => {
    expect(
      canUploadRushes(
        { id: USER_ID, role: "VIDEASTE" },
        { assigneeCmId: USER_ID }, // legacy slot sans champ vidéaste — undefined
      ),
    ).toBe(false);
  });
});

describe("canDeleteRushes", () => {
  it("ADMIN peut supprimer n'importe quel rush", () => {
    expect(canDeleteRushes({ id: OTHER_ID, role: "ADMIN" }, { uploadedByUserId: USER_ID })).toBe(true);
  });

  it("auteur du rush peut le supprimer", () => {
    expect(canDeleteRushes({ id: USER_ID, role: "CM" }, { uploadedByUserId: USER_ID })).toBe(true);
  });

  it("non-auteur non-admin ne peut pas supprimer", () => {
    expect(canDeleteRushes({ id: OTHER_ID, role: "CM" }, { uploadedByUserId: USER_ID })).toBe(false);
    expect(canDeleteRushes({ id: OTHER_ID, role: "MONTEUR" }, { uploadedByUserId: USER_ID })).toBe(false);
  });
});

// ─── Versions ──────────────────────────────────────────────────────────────────

describe("canUploadVersion", () => {
  it("ADMIN peut uploader une version partout", () => {
    expect(canUploadVersion({ id: OTHER_ID, role: "ADMIN" }, { assigneeMonteurId: USER_ID })).toBe(true);
  });

  it("MONTEUR assigné peut uploader une version", () => {
    expect(canUploadVersion({ id: USER_ID, role: "MONTEUR" }, { assigneeMonteurId: USER_ID })).toBe(true);
  });

  it("MONTEUR non assigné ne peut pas uploader une version", () => {
    expect(canUploadVersion({ id: USER_ID, role: "MONTEUR" }, { assigneeMonteurId: OTHER_ID })).toBe(false);
  });

  it("CM ne peut pas uploader une version", () => {
    expect(canUploadVersion({ id: USER_ID, role: "CM" }, { assigneeMonteurId: USER_ID })).toBe(false);
  });

  it("USER ne peut pas uploader une version", () => {
    expect(canUploadVersion({ id: USER_ID, role: "EXTERNAL_GENERATOR" }, { assigneeMonteurId: USER_ID })).toBe(false);
  });
});

describe("canPromoteVersion", () => {
  it("ADMIN seul peut promouvoir une version", () => {
    expect(canPromoteVersion({ role: "ADMIN" })).toBe(true);
  });

  it("MONTEUR ne peut pas promouvoir une version", () => {
    expect(canPromoteVersion({ role: "MONTEUR" })).toBe(false);
  });

  it("CM ne peut pas promouvoir une version", () => {
    expect(canPromoteVersion({ role: "CM" })).toBe(false);
  });

  it("USER ne peut pas promouvoir une version", () => {
    expect(canPromoteVersion({ role: "EXTERNAL_GENERATOR" })).toBe(false);
  });
});

describe("canDeleteVersion", () => {
  it("ADMIN peut supprimer n'importe quelle version", () => {
    expect(canDeleteVersion({ id: OTHER_ID, role: "ADMIN" }, { uploadedByUserId: USER_ID })).toBe(true);
  });

  it("auteur de la version peut la supprimer", () => {
    expect(canDeleteVersion({ id: USER_ID, role: "MONTEUR" }, { uploadedByUserId: USER_ID })).toBe(true);
  });

  it("non-auteur non-admin ne peut pas supprimer", () => {
    expect(canDeleteVersion({ id: OTHER_ID, role: "MONTEUR" }, { uploadedByUserId: USER_ID })).toBe(false);
    expect(canDeleteVersion({ id: OTHER_ID, role: "CM" }, { uploadedByUserId: USER_ID })).toBe(false);
  });
});

describe("canRestoreVersion", () => {
  it("ADMIN seul peut restaurer une version", () => {
    expect(canRestoreVersion({ role: "ADMIN" })).toBe(true);
    expect(canRestoreVersion({ role: "MONTEUR" })).toBe(false);
    expect(canRestoreVersion({ role: "CM" })).toBe(false);
    expect(canRestoreVersion({ role: "EXTERNAL_GENERATOR" })).toBe(false);
  });
});

// ─── Brief ─────────────────────────────────────────────────────────────────────

describe("canEditBrief", () => {
  it("ADMIN peut éditer le brief partout", () => {
    expect(canEditBrief({ id: OTHER_ID, role: "ADMIN" }, { assigneeCmId: USER_ID })).toBe(true);
  });

  it("CM assigné peut éditer le brief", () => {
    expect(canEditBrief({ id: USER_ID, role: "CM" }, { assigneeCmId: USER_ID })).toBe(true);
  });

  it("CM non assigné ne peut pas éditer le brief", () => {
    expect(canEditBrief({ id: USER_ID, role: "CM" }, { assigneeCmId: OTHER_ID })).toBe(false);
  });

  it("MONTEUR ne peut pas éditer le brief", () => {
    expect(canEditBrief({ id: USER_ID, role: "MONTEUR" }, { assigneeCmId: USER_ID })).toBe(false);
  });

  it("USER ne peut pas éditer le brief", () => {
    expect(canEditBrief({ id: USER_ID, role: "EXTERNAL_GENERATOR" }, { assigneeCmId: USER_ID })).toBe(false);
  });
});
