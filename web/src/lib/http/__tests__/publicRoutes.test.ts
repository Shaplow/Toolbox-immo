import { describe, it, expect } from "vitest";
import { isPublicPath } from "@/lib/http/publicRoutes";

describe("isPublicPath", () => {
  it.each([
    "/validate/3f9a0c",
    "/api/validate/3f9a0c",
    "/data-fill/abc123",
    "/api/data-fill/abc123",
    "/api/cron/r2-cleanup",
    "/api/cron/caption-retention",
    "/api/cron/pod-reconcile",
    "/api/cron/calendar",
    "/export/9f2c",
    "/api/export/9f2c/manifest",
    "/api/export/9f2c/urls",
    "/api/export/9f2c/events",
    "/api/export/9f2c/data/cklib123",
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
    "/api/cron/caption-retention/x",
    "/api/cron/caption-retentionx",
    // export : jeton seul, sous-routes listées seulement
    "/export",
    "/export/9f2c/extra",
    "/api/export/9f2c",
    "/api/export/9f2c/autre",
    "/api/export/9f2c/data",
    "/api/export/9f2c/data/a/b",
    "/api/admin/clients/c1/export-links",
    // tout le reste de l'app
    "/",
    "/home",
    "/admin/clients/abc",
    "/api/admin/clients/abc",
  ])("exige une session pour %s", (pathname) => {
    expect(isPublicPath(pathname)).toBe(false);
  });
});
