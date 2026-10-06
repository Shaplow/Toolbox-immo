/**
 * POST /api/cron/r2-cleanup — contrat HTTP du disjoncteur.
 *
 * Un passage réel refusé (trop d'orphelins) doit être un ÉCHEC pour le cron
 * externe : en 200, crontab ou cron-job.org y voient un succès et la fuite de
 * stockage se répète chaque nuit sans alerte. Le nettoyage des multipart est
 * indépendant du disjoncteur.
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cleanup: vi.fn(), abortStale: vi.fn() }));

// r2Cleanup importe Prisma au chargement ; parseCleanupParams reste le vrai.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/r2Cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/r2Cleanup")>()),
  cleanupOrphanR2Objects: mocks.cleanup,
}));
vi.mock("@/lib/r2Multipart", () => ({ abortStaleMultipartUploads: mocks.abortStale }));

import { POST } from "@/app/api/cron/r2-cleanup/route";

const STALE_ABORT_MS = 48 * 60 * 60 * 1000;

function call(query = "") {
  return POST(
    new NextRequest(`http://localhost/api/cron/r2-cleanup${query}`, {
      method: "POST",
      headers: { "x-cron-secret": "s3cret" },
    }),
  );
}

function cleanupResult(overrides: Record<string, unknown> = {}) {
  return {
    scanned: 10,
    orphans: 3,
    deleted: 3,
    dryRun: false,
    byClass: {},
    refused: null,
    ...overrides,
  };
}

describe("POST /api/cron/r2-cleanup", () => {
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.cleanup.mockReset();
    mocks.abortStale.mockReset();
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.spyOn(console, "log").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.abortStale.mockImplementation(async (_olderThanMs: number, opts: { dryRun: boolean }) => ({
      found: 0,
      aborted: 0,
      bytesFreed: 0,
      dryRun: opts.dryRun,
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("passage réel refusé par le disjoncteur : 409, corps inchangé, erreur loggée", async () => {
    const refused = { reason: "too_many_orphans", maxDeletes: 2 };
    mocks.cleanup.mockResolvedValue(cleanupResult({ deleted: 0, refused }));

    const res = await call("?apply=1&maxDeletes=2");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      ...cleanupResult({ deleted: 0, refused }),
      multipart: { found: 0, aborted: 0, bytesFreed: 0, dryRun: false },
    });
    expect(mocks.cleanup).toHaveBeenCalledWith({ dryRun: false, maxDeletes: 2 });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("REFUSÉ");
  });

  it("le refus du disjoncteur ne retient pas le nettoyage des multipart", async () => {
    mocks.cleanup.mockResolvedValue(
      cleanupResult({ deleted: 0, refused: { reason: "too_many_orphans", maxDeletes: 2 } }),
    );

    await call("?apply=1&maxDeletes=2");

    // Même `dryRun` que le passage demandé : un faux positif de référencement
    // d'objets n'a aucun lien avec un multipart inachevé.
    expect(mocks.abortStale).toHaveBeenCalledWith(STALE_ABORT_MS, { dryRun: false });
  });

  it("passage réel accepté : 200 et aucune erreur loggée", async () => {
    mocks.cleanup.mockResolvedValue(cleanupResult());

    const res = await call("?apply=1");

    expect(res.status).toBe(200);
    expect((await res.json()).refused).toBeNull();
    expect(mocks.cleanup).toHaveBeenCalledWith({ dryRun: false, maxDeletes: 500 });
    expect(error).not.toHaveBeenCalled();
  });

  it("dry-run par défaut : 200, rien n'est demandé en réel ni aux orphelins ni aux multipart", async () => {
    mocks.cleanup.mockResolvedValue(cleanupResult({ deleted: 0, dryRun: true }));

    const res = await call();

    expect(res.status).toBe(200);
    expect(mocks.cleanup).toHaveBeenCalledWith({ dryRun: true, maxDeletes: 500 });
    expect(mocks.abortStale).toHaveBeenCalledWith(STALE_ABORT_MS, { dryRun: true });
  });

  it("refuse un appel sans le bon secret, avant tout nettoyage", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/cron/r2-cleanup?apply=1", {
        method: "POST",
        headers: { "x-cron-secret": "mauvais" },
      }),
    );

    expect(res.status).toBe(401);
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.abortStale).not.toHaveBeenCalled();
  });
});
