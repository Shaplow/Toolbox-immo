/**
 * applyTranscriptionOutcome — une seule transition, quel que soit le chemin
 * (webhook ou polling), et jamais de suppression de la vidéo d'un render ou
 * d'une version montée.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  releaseJobSource: vi.fn(async () => true),
  notifyUser: vi.fn(),
  translation: vi.fn(async () => undefined),
  caption: vi.fn(async () => undefined),
  description: vi.fn(async () => undefined),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { transcriptionJob: { updateMany: mocks.updateMany } } }));
vi.mock("@/lib/upload/releaseJobSource", () => ({ releaseJobSource: mocks.releaseJobSource }));
vi.mock("@/lib/sseStore", () => ({ notifyUser: mocks.notifyUser }));
vi.mock("@/lib/triggerAutoTranslationFromTranscription", () => ({
  triggerAutoTranslationForTranscription: mocks.translation,
}));
vi.mock("@/lib/triggerAutoCaptionFromTranscription", () => ({
  triggerAutoCaptionForTranscription: mocks.caption,
}));
vi.mock("@/lib/triggerAutoDescriptionFromTranscription", () => ({
  triggerAutoDescriptionForTranscription: mocks.description,
}));

import { applyTranscriptionOutcome } from "../applyOutcome";

const standalone = {
  id: "job-1",
  userId: "user-1",
  inputKey: "transcription/user-1/1-abc/source.mp4",
  outputJsonKey: "transcription/user-1/1-abc/segments.json",
  renderId: null,
  publicationVersionId: null,
};

afterEach(() => vi.clearAllMocks());

describe("applyTranscriptionOutcome", () => {
  it("terminé : transition gardée, source libérée par le helper gardé, SSE, traduction", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const applied = await applyTranscriptionOutcome(standalone, {
      kind: "completed",
      output: { segment_count: 12, duration: 30.5, has_diarization: true },
    });
    expect(applied).toBe(true);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: { in: ["QUEUED", "PROCESSING"] } },
      data: {
        status: "COMPLETED",
        outputJsonKey: standalone.outputJsonKey,
        segmentCount: 12,
        duration: 30.5,
        hasDiarization: true,
      },
    });
    expect(mocks.releaseJobSource).toHaveBeenCalledWith(expect.anything(), "transcription", standalone);
    expect(mocks.notifyUser).toHaveBeenCalledWith("user-1", expect.objectContaining({ status: "COMPLETED", hasDiarization: true }));
    await vi.waitFor(() => expect(mocks.translation).toHaveBeenCalledWith("job-1"));
    // Standalone : ni captions ni description auto.
    expect(mocks.caption).not.toHaveBeenCalled();
    expect(mocks.description).not.toHaveBeenCalled();
  });

  it("déjà terminal (webhook passé avant le polling) : aucun effet", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(applyTranscriptionOutcome(standalone, { kind: "completed", output: {} })).resolves.toBe(false);
    expect(mocks.releaseJobSource).not.toHaveBeenCalled();
    expect(mocks.notifyUser).not.toHaveBeenCalled();
    expect(mocks.translation).not.toHaveBeenCalled();
  });

  it("pipeline auto : captions (render) et description déclenchées", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    await applyTranscriptionOutcome({ ...standalone, renderId: "render-1" }, { kind: "completed", output: {} });
    await vi.waitFor(() => expect(mocks.caption).toHaveBeenCalledWith("job-1"));
    expect(mocks.description).toHaveBeenCalledWith("job-1");
  });

  it("échec : FAILED gardé, garde supplémentaire combinée en AND", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const updatedAt = new Date("2026-10-04T10:00:00.000Z");
    await applyTranscriptionOutcome(
      standalone,
      { kind: "failed", errorMsg: "GPU indisponible" },
      { where: { status: "QUEUED", updatedAt } },
    );
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { AND: [{ id: "job-1", status: { in: ["QUEUED", "PROCESSING"] } }, { status: "QUEUED", updatedAt }] },
      data: { status: "FAILED", errorMsg: "GPU indisponible" },
    });
    expect(mocks.notifyUser).toHaveBeenCalledWith("user-1", expect.objectContaining({ status: "FAILED", errorMsg: "GPU indisponible" }));
  });
});
