/**
 * prepareCoverFramePack — tolérance par source.
 *
 * Un pack cover extrait ses frames rush par rush (un appel /api/extract-covers
 * par clip). Avant, la boucle n'avait ni try/catch ni retry : un seul rush
 * illisible faisait basculer le pack entier en FAILED, alors que les frames des
 * autres clips étaient parfaitement exploitables. C'est ce qui transformait une
 * flakiness marginale en « ça rate très souvent ».
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPackFindUnique = vi.fn();
const mockPackUpdate = vi.fn();
const mockCandidateCreateMany = vi.fn();
const mockMediaAssetFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    coverFramePack: {
      findUnique: (...args: unknown[]) => mockPackFindUnique(...args),
      update: (...args: unknown[]) => mockPackUpdate(...args),
    },
    coverFrameCandidate: {
      createMany: (...args: unknown[]) => mockCandidateCreateMany(...args),
      findMany: vi.fn(async () => []),
    },
    mediaAsset: {
      findMany: (...args: unknown[]) => mockMediaAssetFindMany(...args),
    },
  },
}));

vi.mock("@/lib/r2", () => ({
  // R2 non configuré : persistFrame retombe sur l'URL proxy, aucun I/O réseau.
  r2Configured: () => false,
  uploadToR2: vi.fn(),
  deleteFromR2: vi.fn(),
  deleteR2Prefix: vi.fn(),
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

import { prepareCoverFramePack } from "@/lib/coverAuto";

// Template minimal : 3 slots de séquence, chacun alimenté par un asset de bibliothèque.
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

function packFixture() {
  return {
    id: "pack-1",
    userId: "user-1",
    frameCount: 6,
    duration: null,
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
  };
}

/** Réponse /api/extract-covers : une frame par timestamp demandé. */
function framesFor(body: FormData): unknown[] {
  const timestamps = JSON.parse(String(body.get("timestamps_json"))) as number[];
  return timestamps.map((timestamp) => ({ timestamp, url: `/outputs/covers/f-${timestamp}.jpg` }));
}

/** Dernier appel à coverFramePack.update dont le status est renseigné. */
type PackUpdateArg = { data?: { status?: string; errorMsg?: string; usedTimestamps?: string } };
function lastStatusUpdate(): PackUpdateArg | undefined {
  const calls = mockPackUpdate.mock.calls as Array<[PackUpdateArg]>;
  return [...calls].reverse().find((call) => call[0]?.data?.status)?.[0];
}

describe("prepareCoverFramePack — un rush en échec ne fait pas tomber le pack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPackFindUnique.mockResolvedValue(packFixture());
    mockPackUpdate.mockResolvedValue({});
    mockCandidateCreateMany.mockResolvedValue({ count: 0 });
    mockMediaAssetFindMany.mockResolvedValue(ASSETS);
  });

  it("garde les frames des rushs valides quand un seul rush échoue", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = init.body as FormData;
      const sourceUrl = String(body.get("video_url"));
      if (sourceUrl.includes("rush-b")) {
        // Le render-engine remonte désormais la vraie cause en 422.
        return new Response(JSON.stringify({ detail: "moov atom not found" }), { status: 422 });
      }
      return new Response(JSON.stringify(framesFor(body)), { status: 200 });
    }));

    await prepareCoverFramePack("pack-1");

    const update = lastStatusUpdate();
    expect(update?.data?.status).toBe("READY");
    expect(mockCandidateCreateMany).toHaveBeenCalledOnce();

    const created = mockCandidateCreateMany.mock.calls[0][0].data as Array<{ slotId: string | null }>;
    expect(created.length).toBeGreaterThan(0);
    // Aucune frame ne doit provenir du rush en échec.
    expect(created.some((frame) => frame.slotId === "slot-b")).toBe(false);
    expect(created.some((frame) => frame.slotId === "slot-a")).toBe(true);
  });

  it("n'inscrit dans usedTimestamps que les picks réellement servis", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = init.body as FormData;
      const sourceUrl = String(body.get("video_url"));
      if (sourceUrl.includes("rush-b")) {
        return new Response(JSON.stringify({ detail: "moov atom not found" }), { status: 422 });
      }
      return new Response(JSON.stringify(framesFor(body)), { status: 200 });
    }));

    await prepareCoverFramePack("pack-1");

    const seen = JSON.parse(lastStatusUpdate()!.data!.usedTimestamps as string) as Array<{ sourceUrl: string }>;
    expect(seen.length).toBeGreaterThan(0);
    // Le rush en échec n'a rien servi : le marquer « vu » le condamnerait sans
    // qu'aucune de ses frames n'ait jamais été proposée.
    expect(seen.some((entry) => entry.sourceUrl.includes("rush-b"))).toBe(false);
    expect(seen.some((entry) => entry.sourceUrl.includes("rush-a"))).toBe(true);
  });

  it("découpe l'extraction en lots et garde les frames des lots qui passent", async () => {
    // 36 frames en une seule requête, c'est plusieurs minutes sur un rush 4K HLG —
    // au-delà de tout budget de fetch raisonnable. On découpe, et un lot trop lent
    // ne coûte que ses frames.
    const batchSizes: number[] = [];
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = init.body as FormData;
      const timestamps = JSON.parse(String(body.get("timestamps_json"))) as number[];
      batchSizes.push(timestamps.length);
      call += 1;
      // Le 2e lot tombe en timeout, les autres passent.
      if (call === 2) return new Response("", { status: 504 });
      return new Response(JSON.stringify(framesFor(body)), { status: 200 });
    }));

    await prepareCoverFramePack("pack-1");

    // Aucun lot ne dépasse la taille par défaut (8).
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(8);
    expect(batchSizes.length).toBeGreaterThan(1);

    const update = lastStatusUpdate();
    expect(update?.data?.status).toBe("READY");
    const created = mockCandidateCreateMany.mock.calls[0][0].data as unknown[];
    expect(created.length).toBeGreaterThan(0);
  });

  it("échoue en nommant la cause quand TOUTES les sources échouent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ detail: "moov atom not found" }), { status: 422 }),
    ));

    await prepareCoverFramePack("pack-1").catch(() => undefined);

    const update = lastStatusUpdate();
    expect(update?.data?.status).toBe("FAILED");
    expect(update?.data?.errorMsg).toContain("moov atom not found");
    // L'ancien message générique ne disait rien de la cause réelle.
    expect(update?.data?.errorMsg).not.toBe("Le render-engine n'a extrait aucune frame");
  });
});
