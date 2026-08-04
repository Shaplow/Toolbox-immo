import { describe, it, expect } from "vitest";

import {
  canViewMediaLibrary,
  canManageMediaAssets,
  canManageMediaLibraries,
} from "@/lib/permissions/mediaLibrary";

const ALL_ROLES = ["ADMIN", "VIDEASTE", "MONTEUR", "CM", "EXTERNAL_GENERATOR"] as const;

describe("canViewMediaLibrary — consultation + téléchargement", () => {
  it("autorise ADMIN, VIDEASTE et MONTEUR", () => {
    expect(canViewMediaLibrary("ADMIN")).toBe(true);
    expect(canViewMediaLibrary("VIDEASTE")).toBe(true);
    expect(canViewMediaLibrary("MONTEUR")).toBe(true);
  });

  it("refuse CM et EXTERNAL_GENERATOR", () => {
    expect(canViewMediaLibrary("CM")).toBe(false);
    expect(canViewMediaLibrary("EXTERNAL_GENERATOR")).toBe(false);
  });

  it("refuse null / undefined / rôle inconnu", () => {
    expect(canViewMediaLibrary(null)).toBe(false);
    expect(canViewMediaLibrary(undefined)).toBe(false);
    expect(canViewMediaLibrary("")).toBe(false);
    expect(canViewMediaLibrary("SUPERADMIN")).toBe(false);
  });

  it("couvre les 5 rôles sans faux positif", () => {
    const allowed = ALL_ROLES.filter((r) => canViewMediaLibrary(r));
    expect(allowed).toEqual(["ADMIN", "VIDEASTE", "MONTEUR"]);
  });
});

describe("canManageMediaAssets — accès assets (média + audio)", () => {
  it("autorise ADMIN et VIDEASTE", () => {
    expect(canManageMediaAssets("ADMIN")).toBe(true);
    expect(canManageMediaAssets("VIDEASTE")).toBe(true);
  });

  it("refuse MONTEUR, CM, EXTERNAL_GENERATOR", () => {
    expect(canManageMediaAssets("MONTEUR")).toBe(false);
    expect(canManageMediaAssets("CM")).toBe(false);
    expect(canManageMediaAssets("EXTERNAL_GENERATOR")).toBe(false);
  });

  it("refuse null / undefined / rôle inconnu", () => {
    expect(canManageMediaAssets(null)).toBe(false);
    expect(canManageMediaAssets(undefined)).toBe(false);
    expect(canManageMediaAssets("")).toBe(false);
    expect(canManageMediaAssets("SUPERADMIN")).toBe(false);
  });

  it("couvre les 5 rôles sans faux positif", () => {
    const allowed = ALL_ROLES.filter((r) => canManageMediaAssets(r));
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

describe("hiérarchie des 3 niveaux", () => {
  // Un niveau qui autoriserait à gérer sans autoriser à voir produirait une UI
  // incohérente (boutons d'action sur une page inaccessible) et, côté API, un
  // rôle capable de muter mais pas de lire. Cet invariant doit tenir quel que
  // soit le rôle ajouté plus tard.
  it("qui gère les assets peut voir", () => {
    for (const role of ALL_ROLES) {
      if (canManageMediaAssets(role)) expect(canViewMediaLibrary(role)).toBe(true);
    }
  });

  it("qui gère les librairies peut gérer les assets et voir", () => {
    for (const role of ALL_ROLES) {
      if (canManageMediaLibraries(role)) {
        expect(canManageMediaAssets(role)).toBe(true);
        expect(canViewMediaLibrary(role)).toBe(true);
      }
    }
  });

  it("MONTEUR voit mais ne gère rien", () => {
    expect(canViewMediaLibrary("MONTEUR")).toBe(true);
    expect(canManageMediaAssets("MONTEUR")).toBe(false);
    expect(canManageMediaLibraries("MONTEUR")).toBe(false);
  });
});
