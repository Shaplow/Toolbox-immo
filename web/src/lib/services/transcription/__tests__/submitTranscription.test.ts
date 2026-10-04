/**
 * submitTranscription — claim (vérifications AVANT toute écriture) et envoi.
 *
 * Invariant central : un « Lancer » cliqué pendant un upload ne doit plus tuer
 * le job (avant : claim puis HEAD → FAILED définitif + source orpheline).
 */

import type { TranscriptionJob } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  objectExistsInR2: vi.fn(),
  r2Configured: vi.fn(() => true),
  runpodConfigured: vi.fn(() => true),
  submitRunpodJob: vi.fn(),
  applyOutcome: vi.fn(),
  notifyUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transcriptionJob: {
      updateMany: mocks.updateMany,
      findUniqueOrThrow: mocks.findUniqueOrThrow,
    },
  },
}));
vi.mock("@/lib/r2", () => ({
  r2Configured: mocks.r2Configured,
  objectExistsInR2: mocks.objectExistsInR2,
  getR2PublicUrl: (key: string) => `https://r2.test/${key}`,
}));
vi.mock("@/lib/runpod", () => ({
  runpodConfigured: mocks.runpodConfigured,
  submitRunpodJob: mocks.submitRunpodJob,
}));
vi.mock("@/lib/webhooks/runpod", () => ({ getRunpodWebhookUrl: () => "https://app.test/webhook" }));
vi.mock("@/lib/sseStore", () => ({ notifyUser: mocks.notifyUser }));
vi.mock("@/lib/services/transcription/applyOutcome", () => ({
  applyTranscriptionOutcome: mocks.applyOutcome,
}));

import {
  claimTranscriptionForSubmit,
  dispatchTranscription,
  EngineUnavailableError,
  isDispatchPending,
  launchTranscriptionJobs,
  StorageUnavailableError,
  UploadPendingError,
} from "../submitTranscription";
import { ConflictError } from "@/lib/services/_runtime/errors";

function job(overrides: Partial<TranscriptionJob> = {}): TranscriptionJob {
  return {
    id: "job-1",
    userId: "user-1",
    status: "QUEUED",
    inputKey: "transcription/user-1/1-abc/source.mp4",
    inputFilename: "visite.mp4",
    model: "turbo",
    language: "fr",
    languages: [],
    enableDiarization: false,
    hasDiarization: false,
    runpodJobId: null,
    outputJsonKey: "transcription/user-1/1-abc/segments.json",
    segmentsJson: null,
    segmentCount: null,
    duration: null,
    errorMsg: null,
    renderId: null,
    publicationVersionId: null,
    slotId: null,
    staleSince: null,
    staleReason: null,
    batchId: null,
    uploadedAt: null,
    createdAt: new Date("2026-10-04T10:00:00.000Z"),
    updatedAt: new Date("2026-10-04T10:00:00.000Z"),
    ...overrides,
  } as TranscriptionJob;
}

beforeEach(() => {
  vi.stubEnv("RUNPOD_ENDPOINT_ID", "endpoint");
  vi.stubEnv("RUNPOD_API_KEY", "key");
  vi.stubEnv("HF_TOKEN", "hf");
  mocks.r2Configured.mockReturnValue(true);
  mocks.runpodConfigured.mockReturnValue(true);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  // Relecture après claim : le claim a posé PROCESSING et uploadedAt.
  mocks.findUniqueOrThrow.mockImplementation(async ({ where }: { where: { id: string } }) =>
    job({ id: where.id, status: "PROCESSING", enableDiarization: true, uploadedAt: new Date() }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("claimTranscriptionForSubmit", () => {
  it("upload pas encore arrivé : 409 UPLOAD_PENDING, job intact", async () => {
    mocks.objectExistsInR2.mockResolvedValue(false);
    await expect(claimTranscriptionForSubmit(job())).rejects.toBeInstanceOf(UploadPendingError);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("R2 muet : 503, job intact", async () => {
    mocks.objectExistsInR2.mockRejectedValue(new Error("ECONNRESET"));
    await expect(claimTranscriptionForSubmit(job())).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("upload confirmé : pas de HEAD, claim atomique puis relecture", async () => {
    const claimed = await claimTranscriptionForSubmit(job({ uploadedAt: new Date() }));
    expect(mocks.objectExistsInR2).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "QUEUED" },
      data: expect.objectContaining({ status: "PROCESSING", errorMsg: null }),
    });
    // Relu après le claim : le réglage enregistré juste avant part avec le job.
    expect(claimed.enableDiarization).toBe(true);
  });

  it("job hérité sans uploadedAt mais source présente : claim et pose uploadedAt", async () => {
    mocks.objectExistsInR2.mockResolvedValue(true);
    await claimTranscriptionForSubmit(job());
    const { data } = mocks.updateMany.mock.calls[0][0] as { data: { uploadedAt: Date } };
    expect(data.uploadedAt).toBeInstanceOf(Date);
  });

  it("double clic : le second claim échoue en 409", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(claimTranscriptionForSubmit(job({ uploadedAt: new Date() }))).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuse sans rien écrire : statut, diarisation sans HF_TOKEN, RunPod absent", async () => {
    await expect(claimTranscriptionForSubmit(job({ status: "PROCESSING" }))).rejects.toBeInstanceOf(ConflictError);
    vi.stubEnv("HF_TOKEN", "");
    await expect(
      claimTranscriptionForSubmit(job({ enableDiarization: true, uploadedAt: new Date() })),
    ).rejects.toBeInstanceOf(EngineUnavailableError);
    vi.stubEnv("HF_TOKEN", "hf");
    mocks.runpodConfigured.mockReturnValue(false);
    await expect(claimTranscriptionForSubmit(job({ uploadedAt: new Date() }))).rejects.toBeInstanceOf(
      EngineUnavailableError,
    );
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

describe("dispatchTranscription (RunPod)", () => {
  const claimed = job({ status: "PROCESSING", uploadedAt: new Date(), enableDiarization: true });

  it("job annulé en attendant son tour : rien n'est envoyé", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(dispatchTranscription(claimed, { serverlessOnly: true })).resolves.toEqual({
      ok: false,
      error: "Job annulé avant l'envoi",
      skipped: true,
    });
    expect(mocks.submitRunpodJob).not.toHaveBeenCalled();
  });

  it("envoi Serverless puis écriture gardée de runpodJobId", async () => {
    mocks.submitRunpodJob.mockResolvedValue({ id: "rp-42" });
    await expect(dispatchTranscription(claimed, { serverlessOnly: true })).resolves.toEqual({ ok: true });
    const [, , payload, options] = mocks.submitRunpodJob.mock.calls[0];
    expect(options).toEqual({ serverlessOnly: true });
    expect(payload.input).toMatchObject({
      job_type: "transcribe",
      job_id: "job-1",
      model_size: "large-v3-turbo",
      language: "fr",
      enable_diarization: true,
      hf_token: "hf",
    });
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: { id: "job-1", status: "PROCESSING" },
      data: { runpodJobId: "rp-42", outputJsonKey: claimed.outputJsonKey },
    });
  });

  it("échec d'envoi d'une vidéo uploadée : remise en attente, source conservée", async () => {
    mocks.submitRunpodJob.mockRejectedValue(new Error("RunPod /run 401"));
    const result = await dispatchTranscription(claimed);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("401") });
    expect(mocks.applyOutcome).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: { id: "job-1", status: "PROCESSING", runpodJobId: null },
      data: { status: "QUEUED", errorMsg: expect.stringContaining("Relancez la vidéo") },
    });
    expect(mocks.notifyUser).toHaveBeenCalledWith("user-1", expect.objectContaining({ status: "QUEUED" }));
  });

  it("échec d'envoi d'un job du pipeline auto : FAILED via l'issue partagée", async () => {
    mocks.submitRunpodJob.mockRejectedValue(new Error("RunPod /run 500"));
    const auto = { ...claimed, renderId: "render-1" } as TranscriptionJob;
    await dispatchTranscription(auto);
    expect(mocks.applyOutcome).toHaveBeenCalledWith(auto, {
      kind: "failed",
      errorMsg: expect.stringContaining("RunPod /run 500"),
    });
  });
});

describe("launchTranscriptionJobs", () => {
  it("disjoncteur : après un échec d'envoi, les suivants sont remis en attente sans appel RunPod", async () => {
    mocks.submitRunpodJob.mockRejectedValue(new Error("RunPod /run 401"));
    const jobs = Array.from({ length: 6 }, (_, i) => job({ id: `ready-${i}`, uploadedAt: new Date() }));
    await launchTranscriptionJobs(jobs);
    await vi.waitFor(() => {
      const requeues = mocks.updateMany.mock.calls.filter(
        (call) => (call[0] as { data?: { status?: string } }).data?.status === "QUEUED",
      );
      expect(requeues).toHaveLength(6);
    });
    // 4 envois partent en parallèle avant le premier échec ; les 2 derniers jamais.
    expect(mocks.submitRunpodJob.mock.calls.length).toBeLessThanOrEqual(4);
    expect(isDispatchPending("ready-0")).toBe(false);
  });

  it("rapporte chaque job, sans qu'un échec bloque les autres", async () => {
    mocks.objectExistsInR2.mockResolvedValue(false);
    mocks.submitRunpodJob.mockResolvedValue({ id: "rp" });
    const results = await launchTranscriptionJobs([
      job({ id: "ready-1", uploadedAt: new Date() }),
      job({ id: "still-uploading" }),
      job({ id: "ready-2", uploadedAt: new Date() }),
    ]);
    expect(results).toEqual([
      { jobId: "ready-1", ok: true },
      { jobId: "still-uploading", ok: false, code: "UPLOAD_PENDING", error: "L'upload de ce fichier n'est pas terminé." },
      { jobId: "ready-2", ok: true },
    ]);
    // L'envoi part en fond, en Serverless.
    await vi.waitFor(() => expect(mocks.submitRunpodJob).toHaveBeenCalledTimes(2));
    expect(mocks.submitRunpodJob.mock.calls.every((call) => call[3]?.serverlessOnly === true)).toBe(true);
  });
});
