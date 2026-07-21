import { describe, it, expect } from "vitest";

import {
  canAccessMediaLibrary,
  canManageMediaLibraries,
} from "@/lib/permissions/mediaLibrary";

const ALL_ROLES = ["ADMIN", "VIDEASTE", "MONTEUR", "CM", "EXTERNAL_GENERATOR"] as const;

describe("canAccessMediaLibrary — accès assets (média + audio)", () => {
  it("autorise ADMIN et VIDEASTE", () => {
    expect(canAccessMediaLibrary("ADMIN")).toBe(true);
    expect(canAccessMediaLibrary("VIDEASTE")).toBe(true);
  });

  it("refuse MONTEUR, CM, EXTERNAL_GENERATOR", () => {
    expect(canAccessMediaLibrary("MONTEUR")).toBe(false);
    expect(canAccessMediaLibrary("CM")).toBe(false);
    expect(canAccessMediaLibrary("EXTERNAL_GENERATOR")).toBe(false);
  });

  it("refuse null / undefined / rôle inconnu", () => {
    expect(canAccessMediaLibrary(null)).toBe(false);
    expect(canAccessMediaLibrary(undefined)).toBe(false);
    expect(canAccessMediaLibrary("")).toBe(false);
    expect(canAccessMediaLibrary("SUPERADMIN")).toBe(false);
  });

  it("couvre les 5 rôles sans faux positif", () => {
    const allowed = ALL_ROLES.filter((r) => canAccessMediaLibrary(r));
    expect(allowed).toEqual(["ADMIN", "VIDEASTE"]);
  });
});

describe("canManageMediaLibraries — gestion library-level (ADMIN only)", () => {
  it("autorise uniquement ADMIN", () => {
    expect(canManageMediaLibraries("ADMIN")).toBe(true);
  });

  it("refuse VIDEASTE et tous les autres rôles", () => {
    expect(canManageMediaLibraries("VIDEASTE")).toBe(false);
    const allowed = ALL_ROLES.filter((r) => canManageMediaLibraries(r));
    expect(allowed).toEqual(["ADMIN"]);
  });

  it("refuse null / undefined", () => {
    expect(canManageMediaLibraries(null)).toBe(false);
    expect(canManageMediaLibraries(undefined)).toBe(false);
  });
});
