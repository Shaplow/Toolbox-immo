import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(public input: unknown) {}
  }
  class S3Client {
    send = mocks.send;
  }
  return {
    S3Client,
    PutObjectCommand: class extends Command {},
    DeleteObjectCommand: class extends Command {},
    GetObjectCommand: class extends Command {},
    HeadObjectCommand: class extends Command {},
    ListObjectsV2Command: class extends Command {},
  };
});
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: vi.fn() }));

import { headR2Object, objectExistsInR2 } from "@/lib/r2";

/** Erreur façon SDK S3 : le statut HTTP est dans `$metadata`, absent pour une coupure réseau. */
function s3Error(name: string, httpStatusCode?: number): Error {
  return Object.assign(new Error(name), {
    name,
    ...(httpStatusCode !== undefined && { $metadata: { httpStatusCode } }),
  });
}

/**
 * Laisse passer les pauses de relance (300 ms puis 1 s) avant de lire l'issue,
 * sans jamais laisser une promesse rejetée sans handler.
 */
async function settle<T>(promise: Promise<T>) {
  const outcome = promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await vi.advanceTimersByTimeAsync(2000);
  return outcome;
}

describe("headR2Object", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.send.mockReset();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("R2_ACCOUNT_ID", "acc");
    vi.stubEnv("R2_ACCESS_KEY_ID", "key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
    vi.stubEnv("R2_BUCKET", "bucket");
    vi.stubEnv("R2_PUBLIC_URL", "https://cdn.toolboximmo.com");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("renvoie la taille et l'ETag d'un objet présent", async () => {
    mocks.send.mockResolvedValueOnce({ ContentLength: 1234, ETag: '"abc"' });

    const outcome = await settle(headR2Object("content-library/videos/a.mp4"));

    expect(outcome).toEqual({ ok: true, value: { contentLength: 1234, etag: '"abc"' } });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("renvoie null tout de suite sur un 404, sans relance", async () => {
    mocks.send.mockRejectedValue(s3Error("NotFound", 404));

    const outcome = await settle(headR2Object("absent.mp4"));

    expect(outcome).toEqual({ ok: true, value: null });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["403 (identifiants révoqués)", 403, "AccessDenied"],
    ["400", 400, "BadRequest"],
    ["401", 401, "Unauthorized"],
  ])("échoue tout de suite sur un %s, sans attendre ni relancer", async (_label, status, name) => {
    mocks.send.mockRejectedValue(s3Error(name, status));

    const outcome = await settle(headR2Object("a.mp4"));

    expect(outcome.ok).toBe(false);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["500", 500],
    ["503", 503],
    ["429 (limitation de débit)", 429],
  ])("relance un %s puis lève si l'erreur persiste", async (_label, status) => {
    mocks.send.mockRejectedValue(s3Error("ServiceError", status));

    const outcome = await settle(headR2Object("a.mp4"));

    expect(outcome.ok).toBe(false);
    // 1 essai + 2 relances (300 ms puis 1 s).
    expect(mocks.send).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("relance une coupure réseau, sans statut HTTP", async () => {
    mocks.send.mockRejectedValue(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));

    const outcome = await settle(headR2Object("a.mp4"));

    expect(outcome.ok).toBe(false);
    expect(mocks.send).toHaveBeenCalledTimes(3);
  });

  it("aboutit si une relance réussit", async () => {
    mocks.send
      .mockRejectedValueOnce(s3Error("ServiceUnavailable", 503))
      .mockResolvedValueOnce({ ContentLength: 7, ETag: '"x"' });

    const outcome = await settle(headR2Object("a.mp4"));

    expect(outcome).toEqual({ ok: true, value: { contentLength: 7, etag: '"x"' } });
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it("objectExistsInR2 en hérite : false sur 404, erreur immédiate sur 403", async () => {
    mocks.send.mockRejectedValueOnce(s3Error("NotFound", 404));
    expect(await settle(objectExistsInR2("absent.mp4"))).toEqual({ ok: true, value: false });

    mocks.send.mockReset();
    mocks.send.mockRejectedValue(s3Error("AccessDenied", 403));
    const denied = await settle(objectExistsInR2("a.mp4"));
    expect(denied.ok).toBe(false);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
