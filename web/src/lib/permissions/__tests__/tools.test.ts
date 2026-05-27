import { describe, it, expect, vi } from "vitest";

// Mock @/lib/userContext to avoid pulling next-auth into a unit test.
// We only need parsePermissions; the rest of userContext (NextAuth helpers)
// is irrelevant for testing the tools matrix.
vi.mock("@/lib/userContext", () => ({
  parsePermissions: (raw: string | null | undefined): string[] => {
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  },
}));

import {
  ROLE_TOOL_SCOPE,
  canAccessTool,
  assertCanAccessTool,
} from "@/lib/permissions/tools";

type AppUserIdentity = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  permissions: string;
};

function makeUser(
  role: "ADMIN" | "MONTEUR" | "CM" | "EXTERNAL_GENERATOR",
  permissions: string[] = []
): AppUserIdentity {
  return {
    id: "user-id",
    name: "Test",
    email: "test@local",
    role,
    permissions: JSON.stringify(permissions),
  };
}

describe("ROLE_TOOL_SCOPE matrix", () => {
  it("ADMIN → wildcard '*' (full access)", () => {
    expect(ROLE_TOOL_SCOPE.ADMIN).toBe("*");
  });

  it("CM → captions, transcription, description, cover", () => {
    expect(ROLE_TOOL_SCOPE.CM).toEqual([
      "captions",
      "transcription",
      "description",
      "cover",
    ]);
  });

  it("MONTEUR → captions, transcription only", () => {
    expect(ROLE_TOOL_SCOPE.MONTEUR).toEqual(["captions", "transcription"]);
  });

  it("USER → empty (driven by individual permissions JSON)", () => {
    expect(ROLE_TOOL_SCOPE.EXTERNAL_GENERATOR).toEqual([]);
  });
});

describe("canAccessTool", () => {
  it("ADMIN → true for any tool (no permissions needed)", () => {
    const admin = makeUser("ADMIN");
    expect(canAccessTool(admin, "captions")).toBe(true);
    expect(canAccessTool(admin, "templates")).toBe(true);
    expect(canAccessTool(admin, "anything-random")).toBe(true);
  });

  it("MONTEUR → true only for scope tools (captions, transcription)", () => {
    const monteur = makeUser("MONTEUR");
    expect(canAccessTool(monteur, "captions")).toBe(true);
    expect(canAccessTool(monteur, "transcription")).toBe(true);
    expect(canAccessTool(monteur, "description")).toBe(false);
    expect(canAccessTool(monteur, "cover")).toBe(false);
    expect(canAccessTool(monteur, "templates")).toBe(false);
  });

  it("CM → true for the 4 scope tools", () => {
    const cm = makeUser("CM");
    expect(canAccessTool(cm, "captions")).toBe(true);
    expect(canAccessTool(cm, "transcription")).toBe(true);
    expect(canAccessTool(cm, "description")).toBe(true);
    expect(canAccessTool(cm, "cover")).toBe(true);
    expect(canAccessTool(cm, "templates")).toBe(false);
  });

  it("USER without permissions → false for all", () => {
    const user = makeUser("EXTERNAL_GENERATOR", []);
    expect(canAccessTool(user, "captions")).toBe(false);
    expect(canAccessTool(user, "templates")).toBe(false);
  });

  it("USER with permissions → true only for granted tools", () => {
    const user = makeUser("EXTERNAL_GENERATOR", ["captions", "templates"]);
    expect(canAccessTool(user, "captions")).toBe(true);
    expect(canAccessTool(user, "templates")).toBe(true);
    expect(canAccessTool(user, "transcription")).toBe(false);
  });

  it("MONTEUR with bonus permissions → OR rule (cumulative access)", () => {
    // Un MONTEUR à qui on donne "description" via permissions individuelles
    // doit y avoir accès en plus de ses outils de rôle.
    const monteur = makeUser("MONTEUR", ["description"]);
    expect(canAccessTool(monteur, "captions")).toBe(true); // via rôle
    expect(canAccessTool(monteur, "transcription")).toBe(true); // via rôle
    expect(canAccessTool(monteur, "description")).toBe(true); // via permissions
    expect(canAccessTool(monteur, "cover")).toBe(false); // ni rôle ni permissions
  });

  it("invalid permissions JSON → treats as no permissions (no crash)", () => {
    const user: AppUserIdentity = {
      id: "u",
      name: "x",
      email: null,
      role: "EXTERNAL_GENERATOR",
      permissions: "{invalid json",
    };
    expect(canAccessTool(user, "captions")).toBe(false);
  });
});

describe("assertCanAccessTool", () => {
  it("does not throw when access granted", () => {
    const admin = makeUser("ADMIN");
    expect(() => assertCanAccessTool(admin, "anything")).not.toThrow();
  });

  it("throws explicit error when access denied", () => {
    const monteur = makeUser("MONTEUR");
    expect(() => assertCanAccessTool(monteur, "templates")).toThrow(
      /Accès refusé.*templates/
    );
  });
});
