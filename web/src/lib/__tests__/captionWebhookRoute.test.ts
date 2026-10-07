/**
 * POST /api/webhooks/runpod/captions — course avec le poll de secours.
 *
 * Le poll (GET /api/render/captions/[id]) peut résoudre le job pendant que le webhook
 * le traite. Celui qui écrit en second ne doit rien rejouer : ni libération de la
 * source, ni notification, ni hooks de pipeline (activité CAPTIONS_COMPLETED en double).
 */

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  verifyWebhook: vi.fn(),
  deleteFromR2: vi.fn(),
  notifyUser: vi.fn(),
  onCaptionsCompleted: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    captionJob: { findUnique: mocks.findUnique, update: mocks.update, updateMany: mocks.updateMany },
  },
}));
vi.mock("@/lib/webhooks/runpod", () => ({ verifyAndParseRunpodWebhook: mocks.verifyWebhook }));
vi.mock("@/lib/r2", () => ({
  getR2PublicUrl: (key: string) => `https://cdn.toolboximmo.com/${key}`,
  isR2PublicUrl: (url: unknown) => typeof url === "string" && url.startsWith("https://cdn.toolboximmo.com/"),
  deleteFromR2: mocks.deleteFromR2,
  r2Configured: () => true,
}));
vi.mock("@/lib/sseStore", () => ({ notifyUser: mocks.notifyUser }));
vi.mock("@/lib/services/slot/pipelineHooks", () => ({ onCaptionsCompleted: mocks.onCaptionsCompleted }));

import { POST } from "@/app/api/webhooks/runpod/captions/route";

const OUTPUT_KEY = "outputs/captions/u1/1784555832902/full.mp4";
const UPLOADED_SOURCE = "inputs/captions/u1/1784555800000/video.mp4";

function processingJob() {
  return { id: "j1", userId: "u1", status: "PROCESSING", runpodJobId: "rp1", inputKey: UPLOADED_SOURCE, outputKey: OUTPUT_KEY };
}

function webhook(body: Record<string, unknown>) {
  mocks.verifyWebhook.mockResolvedValueOnce({ ok: true, body: { id: "rp1", ...body } });
  return POST(new NextRequest("http://localhost/api/webhooks/runpod/captions", { method: "POST" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue(processingJob());
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.update.mockResolvedValue({});
  mocks.deleteFromR2.mockResolvedValue(undefined);
  mocks.onCaptionsCompleted.mockResolvedValue(undefined);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("webhook captions terminé", () => {
  it("écrit l'état sous garde puis libère la source et lance les hooks", async () => {
    const res = await webhook({ status: "COMPLETED", output: { output_key: OUTPUT_KEY } });

    expect(res.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "j1", status: { in: ["QUEUED", "PROCESSING"] } },
      data: { status: "COMPLETED", outputUrl: `https://cdn.toolboximmo.com/${OUTPUT_KEY}` },
    });
    expect(mocks.deleteFromR2).toHaveBeenCalledWith(UPLOADED_SOURCE);
    expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
    expect(mocks.onCaptionsCompleted).toHaveBeenCalledWith("j1");
  });

  it("ne rejoue rien quand le poll a résolu le job entre-temps", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await webhook({ status: "COMPLETED", output: { output_key: OUTPUT_KEY } });

    expect(res.status).toBe(200);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.deleteFromR2).not.toHaveBeenCalled();
    expect(mocks.notifyUser).not.toHaveBeenCalled();
    expect(mocks.onCaptionsCompleted).not.toHaveBeenCalled();
  });
});

describe("webhook captions en échec", () => {
  it("écrit l'échec sous garde puis libère la source", async () => {
    await webhook({ status: "FAILED", error: "ffmpeg a planté" });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "j1", status: { in: ["QUEUED", "PROCESSING"] } },
      data: { status: "FAILED", errorMsg: "ffmpeg a planté" },
    });
    expect(mocks.deleteFromR2).toHaveBeenCalledWith(UPLOADED_SOURCE);
    expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
  });

  it("ne rejoue rien quand le poll a résolu le job entre-temps", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    await webhook({ status: "FAILED", error: "ffmpeg a planté" });

    expect(mocks.deleteFromR2).not.toHaveBeenCalled();
    expect(mocks.notifyUser).not.toHaveBeenCalled();
  });
});
