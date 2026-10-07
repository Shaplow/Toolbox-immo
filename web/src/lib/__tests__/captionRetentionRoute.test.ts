/**
 * POST /api/cron/caption-retention — contrat HTTP.
 *
 * Même contrat que /api/cron/r2-cleanup : dry-run sauf `apply=1`, et un passage réel
 * refusé par le disjoncteur doit être un ÉCHEC pour le cron externe (409) — en 200,
 * crontab ou cron-job.org y voient un succès et le stockage grossit sans alerte.
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptionRetentionReport } from "@/lib/services/captions/expireOutputs";

const mocks = vi.hoisted(() => ({ expire: vi.fn() }));

// r2Cleanup importe Prisma au chargement ; parseCleanupParams reste le vrai.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/services/captions/expireOutputs", () => ({ expireAtelierCaptionOutputs: mocks.expire }));

import { POST } from "@/app/api/cron/caption-retention/route";

function call(query = "", secret: string | null = "s3cret") {
  return POST(
    new NextRequest(`http://localhost/api/cron/caption-retention${query}`, {
      method: "POST",
      headers: secret === null ? {} : { "x-cron-secret": secret },
    }),
  );
}

function report(overrides: Partial<CaptionRetentionReport> = {}): CaptionRetentionReport {
  return {
    dryRun: false,
    retentionDays: 60,
    cutoff: "2026-08-08T04:00:00.000Z",
    candidates: 3,
    claimed: 3,
    deleted: 3,
    pendingRetried: 0,
    pendingLeft: 0,
    skipped: { sharedKey: 0, unsafeKey: 0, race: 0 },
    errors: 0,
    nonTerminalStale: 0,
    bytes: { candidates: 210, missingInR2: 0 },
    byKind: { full: 2, preview: 1 },
    byStatus: { completed: 2, failed: 1 },
    byUser: { u1: { count: 3, bytes: 210 } },
    samples: ["outputs/captions/u1/1754000000000/full.mp4"],
    refused: null,
    ...overrides,
  };
}

describe("POST /api/cron/caption-retention", () => {
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.expire.mockReset();
    vi.stubEnv("CRON_SECRET", "s3cret");
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("CRON_SECRET non configuré : 503, aucune purge", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const res = await call("?apply=1");

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "CRON_SECRET not configured" });
    expect(mocks.expire).not.toHaveBeenCalled();
  });

  it.each([
    ["mauvais secret", "mauvais"],
    ["secret absent", null],
  ])("%s : 401, avant toute purge", async (_label, secret) => {
    const res = await call("?apply=1", secret);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.expire).not.toHaveBeenCalled();
  });

  it("dry-run par défaut : 200, rien n'est demandé en réel", async () => {
    mocks.expire.mockResolvedValue(report({ dryRun: true, claimed: 0, deleted: 0 }));

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(report({ dryRun: true, claimed: 0, deleted: 0 }));
    expect(mocks.expire).toHaveBeenCalledWith({ dryRun: true, maxDeletes: 500 });
    expect(error).not.toHaveBeenCalled();
  });

  it("apply=1 : passage réel au plafond par défaut, 200 et aucune erreur loggée", async () => {
    mocks.expire.mockResolvedValue(report());

    const res = await call("?apply=1");

    expect(res.status).toBe(200);
    expect((await res.json()).refused).toBeNull();
    expect(mocks.expire).toHaveBeenCalledWith({ dryRun: false, maxDeletes: 500 });
    expect(error).not.toHaveBeenCalled();
  });

  it("journalise un résumé de passage : volume candidat, compteurs, écartés", async () => {
    mocks.expire.mockResolvedValue(
      report({ bytes: { candidates: 3 * 1024 ** 3, missingInR2: 0 }, skipped: { sharedKey: 1, unsafeKey: 0, race: 2 } }),
    );

    await call("?apply=1");

    expect(log).toHaveBeenCalledTimes(1);
    const summary = String(log.mock.calls[0][0]);
    expect(summary).toContain("[cron/caption-retention]");
    expect(summary).toContain("candidates=3 (3.00 Go)");
    expect(summary).toContain("deleted=3");
    expect(summary).toContain('skipped={"sharedKey":1,"unsafeKey":0,"race":2}');
    expect(summary).toContain("dryRun=false");
  });

  it("listing R2 en échec : le résumé le dit au lieu d'inventer un volume", async () => {
    mocks.expire.mockResolvedValue(report({ bytes: null }));

    await call("?apply=1");

    expect(String(log.mock.calls[0][0])).toContain("candidates=3 (volume inconnu)");
  });

  it("apply=1 et maxDeletes : le plafond demandé est transmis", async () => {
    mocks.expire.mockResolvedValue(report());

    await call("?apply=1&maxDeletes=1200");

    expect(mocks.expire).toHaveBeenCalledWith({ dryRun: false, maxDeletes: 1200 });
  });

  it("apply=1 avec dryRun=true : reste un dry-run", async () => {
    mocks.expire.mockResolvedValue(report({ dryRun: true, claimed: 0, deleted: 0 }));

    await call("?apply=1&dryRun=true");

    expect(mocks.expire).toHaveBeenCalledWith({ dryRun: true, maxDeletes: 500 });
  });

  it("passage réel refusé par le disjoncteur : 409, corps inchangé, erreur loggée", async () => {
    const refused = { reason: "too_many_candidates" as const, maxDeletes: 2 };
    mocks.expire.mockResolvedValue(report({ claimed: 0, deleted: 0, refused }));

    const res = await call("?apply=1&maxDeletes=2");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(report({ claimed: 0, deleted: 0, refused }));
    expect(mocks.expire).toHaveBeenCalledWith({ dryRun: false, maxDeletes: 2 });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("REFUSÉ");
    expect(String(error.mock.calls[0][0])).toContain("[cron/caption-retention]");
  });

  it("exception du service (R2 non configuré, base…) : 500 avec le message", async () => {
    mocks.expire.mockRejectedValue(new Error("R2 non configuré : R2_BUCKET requis."));

    const res = await call("?apply=1");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "R2 non configuré : R2_BUCKET requis." });
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("exception qui n'est pas une Error : 500 « Erreur interne »", async () => {
    mocks.expire.mockRejectedValue("boom");

    const res = await call();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Erreur interne" });
  });
});
