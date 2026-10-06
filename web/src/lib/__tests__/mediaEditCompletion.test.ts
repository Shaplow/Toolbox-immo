/**
 * Fin d'un job media_edit : webhook RunPod ET poll de secours.
 *
 * Le worker réécrit le fichier sous la MÊME clé R2 (ré-encodage MP4) et renvoie
 * une URL bâtie avec SON R2_PUBLIC_URL. Quand cette origine n'est pas la nôtre
 * (dérive de config), l'URL est rejetée — mais le fichier a changé quand même :
 * la taille stockée (MediaAsset.sizeBytes) doit suivre, sinon l'export client,
 * qui contrôle strictement la taille annoncée, refuse le fichier à chaque essai,
 * et l'URL doit être cache-bustée, sinon CDN et navigateurs servent l'ancienne vidéo.
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jobFindFirst: vi.fn(),
  jobFindUnique: vi.fn(),
  jobUpdate: vi.fn(),
  assetFindUnique: vi.fn(),
  assetUpdate: vi.fn(),
  assetUpdateMany: vi.fn(),
  fetchRunpodStatus: vi.fn(),
  verifyWebhook: vi.fn(),
  readSize: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const prisma = {
    mediaEditJob: {
      findFirst: mocks.jobFindFirst,
      findUnique: mocks.jobFindUnique,
      update: mocks.jobUpdate,
    },
    mediaAsset: {
      findUnique: mocks.assetFindUnique,
      update: mocks.assetUpdate,
      updateMany: mocks.assetUpdateMany,
    },
    // Forme tableau (poll, branche non-R2 du webhook) ou callback (chemin nominal du webhook).
    $transaction: async (arg: unknown) =>
      typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[]),
  };
  return { prisma };
});
vi.mock("@/lib/api/requireAuth", () => ({
  requireUser: async () => ({ ctx: { effectiveUser: { id: "u1", role: "ADMIN" } } }),
}));
vi.mock("@/lib/permissions/mediaLibrary", () => ({ canManageMediaAssets: () => true }));
vi.mock("@/lib/runpod", () => ({
  runpodConfigured: () => true,
  submitRunpodJob: vi.fn(),
  fetchRunpodStatus: mocks.fetchRunpodStatus,
}));
vi.mock("@/lib/webhooks/runpod", () => ({
  getRunpodWebhookUrl: () => "https://app.test/webhook",
  verifyAndParseRunpodWebhook: mocks.verifyWebhook,
}));
vi.mock("@/lib/r2", () => ({
  isR2PublicUrl: (url: unknown) =>
    typeof url === "string" && url.startsWith("https://cdn.toolboximmo.com/"),
}));
vi.mock("@/lib/services/mediaAsset/assetSize", () => ({ readEditedAssetSize: mocks.readSize }));

import { GET } from "@/app/api/admin/libraries/media/assets/[assetId]/edit/route";
import { POST as webhookPOST } from "@/app/api/webhooks/runpod/media-edit/route";

const CDN = "https://cdn.toolboximmo.com";
const FOREIGN = "https://worker-bucket.example.com";

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.jobUpdate.mockResolvedValue({});
  mocks.assetUpdate.mockResolvedValue({});
  mocks.assetUpdateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("poll de secours media_edit (GET /edit)", () => {
  const job = {
    id: "job1",
    assetId: "asset1",
    status: "processing",
    runpodId: "rp1",
    // Webhook perdu depuis plus de 15 minutes : le poll interroge RunPod.
    updatedAt: new Date(Date.now() - 20 * 60_000),
  };

  function poll() {
    return GET(new NextRequest("http://localhost/api/admin/libraries/media/assets/asset1/edit"), {
      params: Promise.resolve({ assetId: "asset1" }),
    });
  }

  beforeEach(() => {
    mocks.jobFindFirst.mockResolvedValue(job);
    mocks.readSize.mockResolvedValue(BigInt(5_000_000));
  });

  it("video_url hors R2 : garde taille et durée, cache-buste l'URL actuelle et loggue l'origine rejetée", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.fetchRunpodStatus.mockResolvedValue({
      status: "COMPLETED",
      output: { duration: 12.5, video_url: `${FOREIGN}/content-library/videos/asset1.mp4?sig=secret` },
    });
    mocks.assetFindUnique.mockResolvedValue({ url: `${CDN}/content-library/videos/asset1.mp4?v=ancien` });

    const res = await poll();

    expect((await res.json()).job.status).toBe("done");
    expect(mocks.jobUpdate).toHaveBeenCalledWith({ where: { id: "job1" }, data: { status: "done" } });
    expect(mocks.assetUpdate).toHaveBeenCalledWith({
      where: { id: "asset1" },
      data: {
        sizeBytes: BigInt(5_000_000),
        duration: 12.5,
        // Même origine, même clé, nouveau ?v= : jamais l'URL étrangère.
        url: `${CDN}/content-library/videos/asset1.mp4?v=job1`,
      },
    });
    expect(error).toHaveBeenCalledTimes(1);
    const logged = String(error.mock.calls[0][0]);
    expect(logged).toContain(FOREIGN);
    expect(logged).not.toContain("secret"); // la query peut porter une signature
  });

  it("video_url sur notre R2 : adopte l'URL, cache-bustée", async () => {
    mocks.fetchRunpodStatus.mockResolvedValue({
      status: "COMPLETED",
      output: { duration: 3, video_url: `${CDN}/content-library/videos/asset1.mp4` },
    });

    await poll();

    const { data } = mocks.assetUpdate.mock.calls[0][0];
    expect(data.sizeBytes).toBe(BigInt(5_000_000));
    expect(data.url).toMatch(/^https:\/\/cdn\.toolboximmo\.com\/content-library\/videos\/asset1\.mp4\?v=\d+$/);
    expect(mocks.assetFindUnique).not.toHaveBeenCalled();
  });

  it("sans video_url : ne touche pas à l'URL, mais met la taille à jour", async () => {
    mocks.fetchRunpodStatus.mockResolvedValue({ status: "COMPLETED", output: { duration: 3 } });

    await poll();

    const { data } = mocks.assetUpdate.mock.calls[0][0];
    expect(data).toEqual({ sizeBytes: BigInt(5_000_000), duration: 3 });
  });
});

describe("webhook media_edit (POST)", () => {
  function webhook(output: Record<string, unknown>) {
    mocks.verifyWebhook.mockResolvedValue({
      ok: true,
      body: { id: "rp1", status: "COMPLETED", output: { job_id: "job1", ...output } },
    });
    mocks.jobFindUnique.mockResolvedValue({
      id: "job1",
      assetId: "asset1",
      status: "processing",
      runpodId: "rp1",
    });
    return webhookPOST(
      new NextRequest("http://localhost/api/webhooks/runpod/media-edit", { method: "POST" }),
    );
  }

  it("video_url hors R2 : le job échoue ET la taille du fichier réécrit est mise à jour", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.readSize.mockResolvedValue(BigInt(777));

    const res = await webhook({ duration: 3, video_url: `${FOREIGN}/content-library/videos/asset1.mp4` });

    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.readSize).toHaveBeenCalledWith("asset1");
    expect(mocks.jobUpdate).toHaveBeenCalledWith({
      where: { id: "job1" },
      data: { status: "failed", errorMsg: expect.stringContaining("non-R2") },
    });
    expect(mocks.assetUpdateMany).toHaveBeenCalledWith({
      where: { id: "asset1" },
      data: { sizeBytes: BigInt(777) },
    });
    // L'URL de l'asset n'est pas modifiée sur ce chemin.
    expect(mocks.assetUpdate).not.toHaveBeenCalled();
  });

  it("video_url hors R2 et taille illisible : la taille repasse à null, l'export la recalculera", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.readSize.mockResolvedValue(null);

    await webhook({ video_url: `${FOREIGN}/x.mp4` });

    expect(mocks.assetUpdateMany).toHaveBeenCalledWith({
      where: { id: "asset1" },
      data: { sizeBytes: null },
    });
  });

  it("chemin nominal (video_url sur notre R2) : job terminé, taille, durée et URL cache-bustée", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.readSize.mockResolvedValue(BigInt(4242));

    await webhook({ duration: 9, video_url: `${CDN}/content-library/videos/asset1.mp4?v=ancien` });

    expect(mocks.jobUpdate).toHaveBeenCalledWith({ where: { id: "job1" }, data: { status: "done" } });
    expect(mocks.assetUpdate).toHaveBeenCalledWith({
      where: { id: "asset1" },
      data: { sizeBytes: BigInt(4242) },
    });
    expect(mocks.assetUpdate).toHaveBeenCalledWith({
      where: { id: "asset1" },
      data: { duration: 9, url: `${CDN}/content-library/videos/asset1.mp4?v=job1` },
    });
    expect(mocks.assetUpdateMany).not.toHaveBeenCalled();
  });
});
