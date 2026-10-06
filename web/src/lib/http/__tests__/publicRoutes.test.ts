import { describe, it, expect } from "vitest";
import { isPublicPath } from "@/lib/http/publicRoutes";

describe("isPublicPath", () => {
  it.each([
    "/validate/3f9a0c",
    "/api/validate/3f9a0c",
    "/data-fill/abc123",
    "/api/data-fill/abc123",
    "/api/cron/r2-cleanup",
    "/api/cron/pod-reconcile",
    "/api/cron/calendar",
  ])("laisse passer %s", (pathname) => {
    expect(isPublicPath(pathname)).toBe(true);
  });

  it.each([
    // sans jeton, ou avec un sous-chemin
    "/validate",
    "/validate/",
    "/validate/a/b",
    "/api/validate/a/b",
    "/api/data-fill/x/y",
    // préfixes voisins
    "/validated/abc",
    "/data-fill-admin/abc",
    "/exports/abc",
    // crons inconnus ou détournés
    "/api/cron",
    "/api/cron/autre",
    "/api/cron/r2-cleanup/extra",
    "/api/cron/r2-cleanupx",
    // tout le reste de l'app
    "/",
    "/home",
    "/admin/clients/abc",
    "/api/admin/clients/abc",
  ])("exige une session pour %s", (pathname) => {
    expect(isPublicPath(pathname)).toBe(false);
  });
});
