/**
 * prepareCoverFramePack — planification, tolérance par source, et déport RunPod.
 *
 * Deux invariants structurants sont vérifiés ici :
 *  - les `CoverFrameCandidate` sont créés AVANT l'extraction, pour porter la
 *    provenance (slotId / sequenceIndex / sourceUrl) jusqu'au webhook, qui arrive
 *    dans un autre process ;
 *  - `usedTimestamps` ne retient que les picks RÉELLEMENT servis — une source en
 *    échec ne doit pas être marquée consommée, sinon « Refaire un tirage » la
 *    condamne sans l'avoir jamais proposée.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPackFindUnique = vi.fn();
const mockPackUpdate = vi.fn();
const mockCandidateCreate = vi.fn();
const mockCandidateUpdateMany = vi.fn();
const mockCandidateDeleteMany = vi.fn();
const mockCandidateFindMany = vi.fn();
const mockMediaAssetFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    coverFramePack: {
      findUnique: (...args: unknown[]) => mockPackFindUnique(...args),
      update: (...args: unknown[]) => mockPackUpdate(...args),
      findMany: vi.fn(async () => []),
    },
    coverFrameCandidate: {
      create: (...args: unknown[]) => mockCandidateCreate(...args),
      updateMany: (...args: unknown[]) => mockCandidateUpdateMany(...args),
      deleteMany: (...args: unknown[]) => mockCandidateDeleteMany(...args),
      findMany: (...args: unknown[]) => mockCandidateFindMany(...args),
    },
    mediaAsset: {
      findMany: (...args: unknown[]) => mockMediaAssetFindMany(...args),
    },
    $transaction: async (ops: unknown) =>
      Array.isArray(ops) ? Promise.all(ops) : (ops as (tx: unknown) => Promise<unknown>)({}),
  },
}));

vi.mock("@/lib/r2", () => ({
  // R2 non configuré : persistFrame retombe sur l'URL proxy, aucun I/O réseau.
  r2Configured: () => false,
  uploadToR2: vi.fn(),
  deleteFromR2: vi.fn(),
  deleteR2Prefix: vi.fn(),
}));

// `vi.hoisted` : coverAuto appelle runpodConfigured() au CHARGEMENT du module
// (dimensionnement du limiteur), donc le mock doit exister avant l'import.
const { mockRunpodConfigured, mockSubmitRunpodJob } = vi.hoisted(() => ({
  mockRunpodConfigured: vi.fn(() => false),
  mockSubmitRunpodJob: vi.fn(),
}));
vi.mock("@/lib/runpod", () => ({
  runpodConfigured: mockRunpodConfigured,
  submitRunpodJob: mockSubmitRunpodJob,
  resolveRunpodJobPhase: vi.fn(),
}));

vi.mock("@/lib/webhooks/runpod", () => ({
  getRunpodWebhookUrl: () => "https://app.test/api/webhooks/runpod/cover-frames?secret=x",
}));

// Ce module tire "server-only" via captionPromptStore — inutilisable sous Vitest.
vi.mock("@/lib/triggerAutoCaptionFromTranscription", () => ({
  resolveSlotExcludeZones: vi.fn(() => []),
  resolveZone: vi.fn((zone: { startSec: number; endSec?: number }) => zone),
}));
vi.mock("@/lib/sseStore", () => ({ notifyUser: vi.fn() }));
vi.mock("@/lib/services/slot/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/renderer/buildHTML", () => ({ buildHTML: vi.fn() }));
vi.mock("@/lib/renderer/renderPNG", () => ({ renderPNG: vi.fn() }));
vi.mock("@/lib/renderer/enrichListingWithEntityFields", () => ({
  enrichListingWithEntityFields: vi.fn((listing: unknown) => listing),
  loadRenderEntityContext: vi.fn(async () => null),
}));

import { prepareCoverFramePack, applyCoverFrameResults } from "@/lib/coverAuto";

const TEMPLATE_JSON = JSON.stringify({
  canvas: { format: "REELS", width: 1080, height: 1920 },
  blocks: [],
  groups: [],
  videoSequence: [
    { id: "slot-a", maxDuration: 6 },
    { id: "slot-b", maxDuration: 6 },
    { id: "slot-c", maxDuration: 6 },
  ],
});

const ASSETS = [
  { id: "asset-a", url: "https://r2.example/rush-a.mp4", duration: 6 },
  { id: "asset-b", url: "https://r2.example/rush-b.mp4", duration: 6 },
  { id: "asset-c", url: "https://r2.example/rush-c.mp4", duration: 6 },
];

function packFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "pack-1",
    userId: "user-1",
    frameCount: 6,
    duration: null,
    extractAttempt: 2,
    status: "PROCESSING",
    sourceVideoUrl: "https://r2.example/final.mp4",
    usedTimestamps: "[]",
    config: JSON.stringify({ enabled: true, excludeZones: [], frameCount: 6 }),
    template: { jsonData: TEMPLATE_JSON },
    render: {
      usedAssets: JSON.stringify({
        videoAssets: { "slot-a": "asset-a", "slot-b": "asset-b", "slot-c": "asset-c" },
      }),
      slotDurations: null,
      listing: { jsonData: "{}" },
      publicationSlot: null,
    },
    publicationVersion: null,
    ...overrides,
  };
}

/** Réponse /api/extract-covers : une frame par timestamp demandé. */
function framesFor(body: FormData): unknown[] {
  const timestamps = JSON.parse(String(body.get("timestamps_json"))) as number[];
  return timestamps.map((timestamp) => ({ timestamp, url: `/outputs/covers/f-${timestamp}.jpg` }));
}

function lastUpdateWithStatus() {
  const calls = mockPackUpdate.mock.calls as Array<[{ data?: Record<string, unknown> }]>;
  return [...calls].reverse().find((call) => call[0]?.data?.status)?.[0];
}

/** Les candidats créés au plan, dans l'ordre. */
function createdCandidates() {
  return mockCandidateCreate.mock.calls.map(
    (call) => (call[0] as { data: Record<string, unknown> }).data,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRunpodConfigured.mockReturnValue(false);
  mockPackFindUnique.mockResolvedValue(packFixture());
  mockPackUpdate.mockResolvedValue({});
  mockMediaAssetFindMany.mockResolvedValue(ASSETS);
  mockCandidateUpdateMany.mockResolvedValue({ count: 1 });
  mockCandidateDeleteMany.mockResolvedValue({ count: 0 });
  mockCandidateFindMany.mockResolvedValue([]);
  let seq = 0;
  mockCandidateCreate.mockImplementation(async () => ({ id: `cand-${++seq}` }));
});

describe("planification — les candidats portent la provenance avant l'extraction", () => {
  it("crée une ligne par pick, avec sa source et son slot", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) =>
      new Response(JSON.stringify(framesFor(init.body as FormData)), { status: 200 }),
    ));

    await prepareCoverFramePack("pack-1");

    const created = createdCandidates();
    expect(created.length).toBeGreaterThan(0);
    // La provenance est en base dès le plan — c'est ce qui permet au webhook,
    // qui arrive dans un autre process, de la restituer sans snapshot JSON.
    expect(created.every((c) => c.imageUrl === null)).toBe(true);
    expect(created.some((c) => c.slotId === "slot-a")).toBe(true);
    expect(created.every((c) => typeof c.sourceUrl === "string")).toBe(true);
  });
});

describe("chemin local — un rush en échec ne fait pas tomber le pack", () => {
  function fetchWithDeadRushB() {
    return vi.fn(async (_url: string, init: RequestInit) => {
      const body = init.body as FormData;
      if (String(body.get("video_url")).includes("rush-b")) {
        return new Response(JSON.stringify({ detail: "moov atom not found" }), { status: 422 });
      }
      return new Response(JSON.stringify(framesFor(body)), { status: 200 });
    });
  }

  it("garde les frames des rushs valides et passe le pack en READY", async () => {
    vi.stubGlobal("fetch", fetchWithDeadRushB());
    mockCandidateFindMany.mockResolvedValue([
      { timestamp: 0.5, sourceUrl: "https://r2.example/rush-a.mp4" },
      { timestamp: 1.5, sourceUrl: "https://r2.example/rush-c.mp4" },
    ]);

    await prepareCoverFramePack("pack-1");

    expect(lastUpdateWithStatus()?.data?.status).toBe("READY");
    // Les picks jamais servis sont supprimés : ils ne doivent ni s'afficher dans le
    // picker, ni compter comme « déjà vus » au tirage suivant.
    expect(mockCandidateDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { packId: "pack-1", imageUrl: null } }),
    );
  });

  it("n'inscrit dans usedTimestamps que les sources réellement servies", async () => {
    vi.stubGlobal("fetch", fetchWithDeadRushB());
    mockCandidateFindMany.mockResolvedValue([
      { timestamp: 0.5, sourceUrl: "https://r2.example/rush-a.mp4" },
      { timestamp: 1.5, sourceUrl: "https://r2.example/rush-c.mp4" },
    ]);

    await prepareCoverFramePack("pack-1");

    const seen = JSON.parse(lastUpdateWithStatus()!.data!.usedTimestamps as string) as Array<{ sourceUrl: string }>;
    expect(seen.some((e) => e.sourceUrl.includes("rush-b"))).toBe(false);
    expect(seen.some((e) => e.sourceUrl.includes("rush-a"))).toBe(true);
  });

  it("échoue en nommant la cause quand TOUTES les sources échouent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ detail: "moov atom not found" }), { status: 422 }),
    ));

    await prepareCoverFramePack("pack-1").catch(() => undefined);

    const update = lastUpdateWithStatus();
    expect(update?.data?.status).toBe("FAILED");
    expect(update?.data?.errorMsg).toContain("moov atom not found");
  });

  it("découpe l'extraction en lots courts", async () => {
    // 36 frames en une requête, c'est plusieurs minutes sur un rush 4K HLG.
    const batchSizes: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = init.body as FormData;
      batchSizes.push((JSON.parse(String(body.get("timestamps_json"))) as number[]).length);
      return new Response(JSON.stringify(framesFor(body)), { status: 200 });
    }));

    await prepareCoverFramePack("pack-1");

    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(8);
  });
});

describe("déport RunPod", () => {
  beforeEach(() => {
    mockRunpodConfigured.mockReturnValue(true);
    process.env.RUNPOD_ENDPOINT_ID = "ep-1";
    process.env.RUNPOD_API_KEY = "key-1";
    mockSubmitRunpodJob.mockResolvedValue({ id: "runpod-job-1" });
  });

  it("soumet un seul job pour tout le pack, hors du chemin pod", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await prepareCoverFramePack("pack-1");

    expect(mockSubmitRunpodJob).toHaveBeenCalledOnce();
    const [, , payload, options] = mockSubmitRunpodJob.mock.calls[0] as [string, string, {
      input: { job_type: string; pack_id: string; attempt: number; key_prefix: string; sources: unknown[] };
    }, { serverlessOnly?: boolean }];

    expect(payload.input.job_type).toBe("cover_frames");
    expect(payload.input.pack_id).toBe("pack-1");
    // La clé porte le numéro de tirage : deux tirages du même pack sont disjoints.
    expect(payload.input.key_prefix).toBe("covers/user-1/pack-1/a2/");
    expect(payload.input.sources.length).toBe(3);
    // Le pod n'a qu'une GPU et un Semaphore(1) : une extraction de JPEG n'a rien
    // à y faire, elle y bloquerait un render.
    expect(options.serverlessOnly).toBe(true);
    // Le webhook prend le relais : aucune extraction locale n'a été tentée.
    expect(lastUpdateWithStatus()?.data?.status).not.toBe("READY");
  });

  it("retombe en local quand une source n'est pas joignable publiquement", async () => {
    // sourceVideoUrl vaut ${CAPTIONS_API}/outputs/... sur les pipelines locaux, et
    // c'est persisté en base : un worker RunPod ne pourrait jamais l'atteindre.
    mockMediaAssetFindMany.mockResolvedValue([]);
    mockPackFindUnique.mockResolvedValue(
      packFixture({ sourceVideoUrl: "/outputs/temp/api/render.mp4", duration: 12, render: null }),
    );
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) =>
      new Response(JSON.stringify(framesFor(init.body as FormData)), { status: 200 }),
    ));

    await prepareCoverFramePack("pack-1");

    expect(mockSubmitRunpodJob).not.toHaveBeenCalled();
    expect(lastUpdateWithStatus()?.data?.status).toBe("READY");
  });
});

describe("applyCoverFrameResults — gardes du webhook", () => {
  it("ignore un résultat dont le tirage a été invalidé entre-temps", async () => {
    // « Refaire un tirage » incrémente extractAttempt et purge les objets R2 : le
    // webhook du job précédent créerait des candidats en 404.
    mockPackFindUnique.mockResolvedValue({
      id: "pack-1", userId: "user-1", extractAttempt: 5, status: "PROCESSING",
      usedTimestamps: "[]", render: null, publicationVersion: null,
    });

    const outcome = await applyCoverFrameResults("pack-1", 3, [
      { candidateId: "cand-1", timestamp: 1, imageUrl: "https://r2/x.jpg", imageKey: "k" },
    ]);

    expect(outcome).toBe("stale");
    expect(mockCandidateUpdateMany).not.toHaveBeenCalled();
  });

  it("ignore un résultat quand le pack n'est plus en cours", async () => {
    mockPackFindUnique.mockResolvedValue({
      id: "pack-1", userId: "user-1", extractAttempt: 3, status: "QUEUED",
      usedTimestamps: "[]", render: null, publicationVersion: null,
    });

    expect(await applyCoverFrameResults("pack-1", 3, [])).toBe("stale");
  });
});
