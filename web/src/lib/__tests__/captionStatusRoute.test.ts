/**
 * GET /api/render/captions/[id] — résolution d'un job par le poll de secours.
 *
 * Le poll peut terminer un job avant le webhook RunPod. Il doit alors libérer la
 * source avec la même garde que le webhook : en mode « utiliser la vidéo du slot »,
 * `inputKey` est le montage ou le rendu de la publication, qu'il supprimait sans
 * condition. Et si le webhook a gagné la course, rien ne doit être rejoué.
 */

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  // Lus au chargement du module de la route.
  process.env.RUNPOD_API_KEY = "rp-key";
  process.env.RUNPOD_ENDPOINT_ID = "rp-endpoint";
  return {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    resolvePhase: vi.fn(),
    deleteFromR2: vi.fn(),
    onCaptionsCompleted: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    captionJob: { findUnique: mocks.findUnique, updateMany: mocks.updateMany, update: mocks.update },
  },
}));
vi.mock("@/lib/api/requireAuth", () => ({
  requireUser: async () => ({ ctx: { effectiveUser: { id: "u1" }, canAdminBypass: false } }),
  requireAdmin: async () => ({ ctx: { effectiveUser: { id: "u1" }, actualUser: { id: "u1" } } }),
}));
vi.mock("@/lib/r2", () => ({
  getR2PublicUrl: (key: string) => `https://cdn.toolboximmo.com/${key}`,
  isR2PublicUrl: (url: unknown) => typeof url === "string" && url.startsWith("https://cdn.toolboximmo.com/"),
  deleteFromR2: mocks.deleteFromR2,
  r2Configured: () => true,
}));
vi.mock("@/lib/runpod", () => ({
  resolveRunpodJobPhase: mocks.resolvePhase,
  runpodConfigured: () => true,
  isPodJobId: () => false,
}));
vi.mock("@/lib/services/slot/pipelineHooks", () => ({ onCaptionsCompleted: mocks.onCaptionsCompleted }));

import { GET } from "@/app/api/render/captions/[id]/route";

const OUTPUT_KEY = "outputs/captions/u1/1784555832902/full.mp4";

function processingJob(inputKey: string | null) {
  return {
    id: "j1",
    userId: "u1",
    status: "PROCESSING",
    runpodJobId: "rp1",
    inputKey,
    outputKey: OUTPUT_KEY,
    outputUrl: null,
    errorMsg: null,
    srtContent: null,
    presetId: null,
    updatedAt: new Date(),
  };
}

async function poll() {
  const res = await GET(new NextRequest("http://localhost/api/render/captions/j1"), {
    params: Promise.resolve({ id: "j1" }),
  });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.update.mockResolvedValue({});
  mocks.deleteFromR2.mockResolvedValue(undefined);
  mocks.onCaptionsCompleted.mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("job terminé par le poll", () => {
  it.each([
    ["le montage de la publication", "publications/s1/versions/v0-abc.mp4"],
    ["le rendu de la publication", "renders/r1.mp4"],
  ])("ne supprime jamais %s utilisé comme source", async (_label, inputKey) => {
    mocks.findUnique.mockResolvedValueOnce(processingJob(inputKey));
    mocks.resolvePhase.mockResolvedValueOnce({ phase: "completed", output: { output_key: OUTPUT_KEY } });

    const { body } = await poll();

    expect(body).toEqual({ status: "COMPLETED", videoUrl: `https://cdn.toolboximmo.com/${OUTPUT_KEY}` });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "j1", status: "PROCESSING" },
      data: { status: "COMPLETED", outputUrl: `https://cdn.toolboximmo.com/${OUTPUT_KEY}` },
    });
    expect(mocks.deleteFromR2).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled(); // inputKey reste pointé
    expect(mocks.onCaptionsCompleted).toHaveBeenCalledWith("j1");
  });

  it("libère une vidéo uploadée pour le job", async () => {
    const inputKey = "inputs/captions/u1/1784555800000/video.mp4";
    mocks.findUnique.mockResolvedValueOnce(processingJob(inputKey));
    mocks.resolvePhase.mockResolvedValueOnce({ phase: "completed", output: { output_key: OUTPUT_KEY } });

    await poll();

    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "j1" }, data: { inputKey: null } });
    expect(mocks.deleteFromR2).toHaveBeenCalledWith(inputKey);
  });

  it("un échec de la libération ne casse ni la réponse ni les hooks, et garde le fichier", async () => {
    mocks.findUnique.mockResolvedValueOnce(processingJob("inputs/captions/u1/1784555800000/video.mp4"));
    mocks.resolvePhase.mockResolvedValueOnce({ phase: "completed", output: { output_key: OUTPUT_KEY } });
    mocks.update.mockRejectedValueOnce(new Error("db indisponible"));

    const { body } = await poll();

    expect(body).toEqual({ status: "COMPLETED", videoUrl: `https://cdn.toolboximmo.com/${OUTPUT_KEY}` });
    expect(mocks.onCaptionsCompleted).toHaveBeenCalledWith("j1");
    // DB d'abord : la clé reste référencée, donc le fichier n'est pas supprimé.
    expect(mocks.deleteFromR2).not.toHaveBeenCalled();
  });

  it("refuse une video_url hors de notre R2 et se rabat sur la clé", async () => {
    mocks.findUnique.mockResolvedValueOnce(processingJob(null));
    mocks.resolvePhase.mockResolvedValueOnce({
      phase: "completed",
      output: { output_key: OUTPUT_KEY, video_url: "https://worker-bucket.example.com/x.mp4" },
    });

    const { body } = await poll();

    expect(body.videoUrl).toBe(`https://cdn.toolboximmo.com/${OUTPUT_KEY}`);
  });

  it("ne rejoue rien quand le webhook a terminé le job entre-temps", async () => {
    mocks.findUnique
      .mockResolvedValueOnce(processingJob("inputs/captions/u1/1/video.mp4"))
      .mockResolvedValueOnce({ ...processingJob(null), status: "COMPLETED", outputUrl: "https://cdn.toolboximmo.com/w.mp4" });
    mocks.resolvePhase.mockResolvedValueOnce({ phase: "completed", output: { output_key: OUTPUT_KEY } });
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    const { body } = await poll();

    expect(body).toEqual({ status: "COMPLETED", videoUrl: "https://cdn.toolboximmo.com/w.mp4" });
    expect(mocks.deleteFromR2).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.onCaptionsCompleted).not.toHaveBeenCalled();
  });
});

describe("job en échec ou bloqué constaté par le poll", () => {
  it("échec : garde la vidéo de la publication", async () => {
    mocks.findUnique.mockResolvedValueOnce(processingJob("publications/s1/versions/v0-abc.mp4"));
    mocks.resolvePhase.mockResolvedValueOnce({ phase: "failed", error: "ffmpeg a planté" });

    const { body } = await poll();

    expect(body).toEqual({ status: "FAILED", error: "ffmpeg a planté" });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "j1", status: "PROCESSING" },
      data: { status: "FAILED", errorMsg: "ffmpeg a planté" },
    });
    expect(mocks.deleteFromR2).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("échec : une libération en erreur ne casse pas la réponse", async () => {
    mocks.findUnique.mockResolvedValueOnce(processingJob("inputs/captions/u1/1784555800000/video.mp4"));
    mocks.resolvePhase.mockResolvedValueOnce({ phase: "failed", error: "ffmpeg a planté" });
    mocks.update.mockRejectedValueOnce(new Error("db indisponible"));

    const { body } = await poll();

    expect(body).toEqual({ status: "FAILED", error: "ffmpeg a planté" });
    expect(mocks.deleteFromR2).not.toHaveBeenCalled();
  });

  it("bloqué : libère une vidéo uploadée pour le job", async () => {
    const inputKey = "inputs/captions/u1/1784555800000/video.mp4";
    mocks.findUnique.mockResolvedValueOnce(processingJob(inputKey));
    mocks.resolvePhase.mockResolvedValueOnce({ phase: "stalled" });

    const { body } = await poll();

    expect(body.status).toBe("FAILED");
    expect(mocks.deleteFromR2).toHaveBeenCalledWith(inputKey);
  });

  it("ne rejoue rien quand le webhook a résolu le job entre-temps", async () => {
    mocks.findUnique
      .mockResolvedValueOnce(processingJob("inputs/captions/u1/1/video.mp4"))
      .mockResolvedValueOnce({ ...processingJob(null), status: "FAILED", errorMsg: "erreur du worker" });
    mocks.resolvePhase.mockResolvedValueOnce({ phase: "failed", error: "ffmpeg a planté" });
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    const { body } = await poll();

    expect(body).toEqual({ status: "FAILED", error: "erreur du worker" });
    expect(mocks.deleteFromR2).not.toHaveBeenCalled();
  });
});
