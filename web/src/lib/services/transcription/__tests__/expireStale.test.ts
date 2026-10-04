/**
 * expireStaleTranscriptionJobs — guérir, remettre en attente ou abandonner,
 * avec des écritures gardées sur l'état lu.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(async () => ({ count: 1 })),
  sourceExists: vi.fn(),
  applyOutcome: vi.fn(async () => true),
  notifyUser: vi.fn(),
  dispatchPending: vi.fn(() => false),
  engineIsLocal: vi.fn(() => false),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { transcriptionJob: { updateMany: mocks.updateMany } } }));
vi.mock("@/lib/sseStore", () => ({ notifyUser: mocks.notifyUser }));
vi.mock("@/lib/services/transcription/applyOutcome", () => ({ applyTranscriptionOutcome: mocks.applyOutcome }));
vi.mock("@/lib/services/transcription/submitTranscription", () => ({
  transcriptionSourceExists: mocks.sourceExists,
  isDispatchPending: mocks.dispatchPending,
  transcriptionEngineIsLocal: mocks.engineIsLocal,
}));

import { expireStaleTranscriptionJobs, type StaleJob } from "../expireStale";
import { DISPATCH_REQUEUED_MESSAGE } from "@/lib/transcription/staleRules";

const NOW = new Date("2026-10-04T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function job(overrides: Partial<StaleJob>): StaleJob {
  return {
    id: "job-1",
    userId: "user-1",
    status: "QUEUED",
    runpodJobId: null,
    inputKey: "transcription/user-1/1-abc/source.mp4",
    outputJsonKey: null,
    uploadedAt: null,
    updatedAt: new Date(NOW.getTime() - HOUR),
    renderId: null,
    publicationVersionId: null,
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("expireStaleTranscriptionJobs", () => {
  it("upload non confirmé mais fichier présent : guéri (uploadedAt posé), pas tué", async () => {
    mocks.sourceExists.mockResolvedValue(true);
    const stale = job({});
    const summary = await expireStaleTranscriptionJobs([stale], { now: NOW });
    expect(summary.healed).toBe(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "QUEUED", runpodJobId: null, updatedAt: stale.updatedAt },
      data: { uploadedAt: NOW },
    });
    expect(mocks.applyOutcome).not.toHaveBeenCalled();
  });

  it("fichier absent : FAILED via l'issue partagée, gardé sur l'état lu", async () => {
    mocks.sourceExists.mockResolvedValue(false);
    const stale = job({});
    const summary = await expireStaleTranscriptionJobs([stale], { now: NOW });
    expect(summary.failed.upload_abandoned).toBe(1);
    expect(mocks.applyOutcome).toHaveBeenCalledWith(
      stale,
      { kind: "failed", errorMsg: expect.stringContaining("Upload jamais finalisé") },
      { where: { id: "job-1", status: "QUEUED", runpodJobId: null, updatedAt: stale.updatedAt } },
    );
  });

  it("R2 muet : on ne conclut rien", async () => {
    mocks.sourceExists.mockRejectedValue(new Error("R2 down"));
    const summary = await expireStaleTranscriptionJobs([job({})], { now: NOW });
    expect(summary).toEqual({
      failed: { upload_abandoned: 0, never_launched: 0, dispatch_interrupted: 0 },
      requeued: 0,
      healed: 0,
    });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.applyOutcome).not.toHaveBeenCalled();
  });

  it("envoi interrompu d'un dépôt standalone : remis en attente, message explicite", async () => {
    const summary = await expireStaleTranscriptionJobs(
      [job({ status: "PROCESSING", uploadedAt: new Date(NOW.getTime() - 2 * HOUR) })],
      { now: NOW },
    );
    expect(summary.requeued).toBe(1);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "QUEUED", errorMsg: DISPATCH_REQUEUED_MESSAGE } }),
    );
    expect(mocks.notifyUser).toHaveBeenCalledWith("user-1", expect.objectContaining({ status: "QUEUED" }));
  });

  it("envoi encore en file dans ce process (RunPod lent) : pas touché", async () => {
    mocks.dispatchPending.mockReturnValueOnce(true);
    const summary = await expireStaleTranscriptionJobs(
      [job({ status: "PROCESSING", uploadedAt: new Date(NOW.getTime() - 2 * HOUR) })],
      { now: NOW },
    );
    expect(summary.requeued).toBe(0);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("vidéo prête depuis 8 jours : FAILED (stockage libéré)", async () => {
    const summary = await expireStaleTranscriptionJobs(
      [job({ uploadedAt: new Date(NOW.getTime() - 9 * 24 * HOUR), updatedAt: new Date(NOW.getTime() - 8 * 24 * HOUR) })],
      { now: NOW },
    );
    expect(summary.failed.never_launched).toBe(1);
  });

  it("vidéo prête depuis 1 h : intacte", async () => {
    const summary = await expireStaleTranscriptionJobs([job({ uploadedAt: new Date(NOW.getTime() - HOUR) })], {
      now: NOW,
    });
    expect(summary.healed + summary.requeued + summary.failed.never_launched).toBe(0);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
