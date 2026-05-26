import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────
// On mock toutes les dépendances effectuant des I/O pour que les tests restent
// purement synchrones / sans DB.

const mockRenderFindUnique = vi.fn();
const mockTemplateFindUnique = vi.fn();
const mockCoverFramePackFindUnique = vi.fn();
const mockCoverFramePackCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    render: {
      findUnique: (...args: unknown[]) => mockRenderFindUnique(...args),
    },
    template: {
      findUnique: (...args: unknown[]) => mockTemplateFindUnique(...args),
    },
    coverFramePack: {
      findUnique: (...args: unknown[]) => mockCoverFramePackFindUnique(...args),
      create: (...args: unknown[]) => mockCoverFramePackCreate(...args),
    },
  },
}));

// Mocks des dépendances I/O non-DB
vi.mock("@/lib/r2", () => ({
  r2Configured: () => false,
  uploadToR2: vi.fn(),
  deleteFromR2: vi.fn(),
}));

vi.mock("@/lib/renderer/buildHTML", () => ({
  buildHTML: vi.fn(),
}));

vi.mock("@/lib/renderer/renderPNG", () => ({
  renderPNG: vi.fn(),
}));

vi.mock("@/lib/triggerAutoCaptionFromTranscription", () => ({
  resolveSlotExcludeZones: vi.fn(() => []),
  resolveZone: vi.fn((zone: { startSec: number; endSec?: number }) => zone),
}));

// Import APRÈS les mocks
import { triggerAutoCoverPackForRender } from "@/lib/coverAuto";

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_CONFIG = {
  enabled: true,
  frameCount: 12,
  excludeZones: [],
  overlayGroupIds: ["group-pattern"],
};

const TEMPLATE_CONFIG = {
  enabled: true,
  frameCount: 6,
  excludeZones: [],
  overlayGroupIds: ["group-template"],
};

function mockTemplateExists() {
  mockTemplateFindUnique.mockResolvedValueOnce({ id: "tpl-1" });
}

// ── Tests : triggerAutoCoverPackForRender ─────────────────────────────────────

describe("triggerAutoCoverPackForRender — Pattern.coverConfig priorité", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Par défaut : pas de pack existant, create retourne un id de pack
    mockCoverFramePackFindUnique.mockResolvedValue(null);
    mockCoverFramePackCreate.mockResolvedValue({ id: "pack-new" });
  });

  it("ne crée pas de pack si templateId est absent", async () => {
    await triggerAutoCoverPackForRender("render-1", null, "http://video.mp4", "user-1");
    expect(mockTemplateFindUnique).not.toHaveBeenCalled();
    expect(mockCoverFramePackCreate).not.toHaveBeenCalled();
  });

  it("ne crée pas de pack si sourceVideoUrl est absent", async () => {
    await triggerAutoCoverPackForRender("render-1", "tpl-1", "", "user-1");
    expect(mockTemplateFindUnique).not.toHaveBeenCalled();
    expect(mockCoverFramePackCreate).not.toHaveBeenCalled();
  });

  it("ne crée pas de pack si le template n'existe pas en DB", async () => {
    mockTemplateFindUnique.mockResolvedValueOnce(null);
    await triggerAutoCoverPackForRender("render-1", "tpl-1", "http://video.mp4", "user-1");
    expect(mockCoverFramePackCreate).not.toHaveBeenCalled();
  });

  it("ne crée pas de pack si le slot n'a pas de pattern", async () => {
    mockTemplateExists();
    mockRenderFindUnique.mockResolvedValueOnce({ publicationSlot: null });

    await triggerAutoCoverPackForRender("render-1", "tpl-1", "http://video.mp4", "user-1");

    // Pas de config → enabled=false → pas de pack
    expect(mockCoverFramePackCreate).not.toHaveBeenCalled();
  });

  it("ne crée pas de pack si pattern.coverMode !== 'auto'", async () => {
    mockTemplateExists();
    mockRenderFindUnique.mockResolvedValueOnce({
      publicationSlot: {
        pattern: { coverMode: "manual", coverConfig: BASE_CONFIG },
      },
    });

    await triggerAutoCoverPackForRender("render-1", "tpl-1", "http://video.mp4", "user-1");

    expect(mockCoverFramePackCreate).not.toHaveBeenCalled();
  });

  it("ne crée pas de pack si pattern.coverConfig est null", async () => {
    mockTemplateExists();
    mockRenderFindUnique.mockResolvedValueOnce({
      publicationSlot: {
        pattern: { coverMode: "auto", coverConfig: null },
      },
    });

    await triggerAutoCoverPackForRender("render-1", "tpl-1", "http://video.mp4", "user-1");

    expect(mockCoverFramePackCreate).not.toHaveBeenCalled();
  });

  it("crée un pack avec le config du pattern quand coverMode=auto et coverConfig non-null", async () => {
    mockTemplateExists();
    mockRenderFindUnique.mockResolvedValueOnce({
      publicationSlot: {
        pattern: { coverMode: "auto", coverConfig: BASE_CONFIG },
      },
    });

    await triggerAutoCoverPackForRender("render-1", "tpl-1", "http://video.mp4", "user-1");

    expect(mockCoverFramePackCreate).toHaveBeenCalledOnce();
    const createCall = mockCoverFramePackCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    // La config sérialisée dans le pack doit contenir les overlayGroupIds du pattern
    const storedConfig = JSON.parse(createCall.data.config as string) as { overlayGroupIds?: string[] };
    expect(storedConfig.overlayGroupIds).toEqual(BASE_CONFIG.overlayGroupIds);
    // Le frameCount du pattern doit être respecté
    expect(createCall.data.frameCount).toBe(BASE_CONFIG.frameCount);
  });

  it("utilise la config du pattern (pas celle du template) quand les deux existent", async () => {
    // Scenario : le pattern a coverConfig + coverMode=auto.
    // Le template aurait TEMPLATE_CONFIG mais ne doit PAS être lu.
    mockTemplateExists();
    mockRenderFindUnique.mockResolvedValueOnce({
      publicationSlot: {
        pattern: {
          coverMode: "auto",
          coverConfig: BASE_CONFIG, // overlayGroupIds: ["group-pattern"]
        },
      },
    });

    await triggerAutoCoverPackForRender("render-1", "tpl-1", "http://video.mp4", "user-1");

    expect(mockCoverFramePackCreate).toHaveBeenCalledOnce();
    const createCall = mockCoverFramePackCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    const storedConfig = JSON.parse(createCall.data.config as string) as { overlayGroupIds?: string[] };

    // Le pack doit contenir "group-pattern" (config du pattern), PAS "group-template"
    expect(storedConfig.overlayGroupIds).toContain("group-pattern");
    expect(storedConfig.overlayGroupIds).not.toContain("group-template");
  });

  it("skip si un pack existe déjà pour ce render", async () => {
    mockTemplateExists();
    mockRenderFindUnique.mockResolvedValueOnce({
      publicationSlot: {
        pattern: { coverMode: "auto", coverConfig: BASE_CONFIG },
      },
    });
    // Override : pack déjà existant pour ce render
    mockCoverFramePackFindUnique.mockResolvedValueOnce({ id: "existing-pack" });

    await triggerAutoCoverPackForRender("render-1", "tpl-1", "http://video.mp4", "user-1");

    expect(mockCoverFramePackCreate).not.toHaveBeenCalled();
  });

  it("ne crée pas de pack si config.enabled est false", async () => {
    mockTemplateExists();
    mockRenderFindUnique.mockResolvedValueOnce({
      publicationSlot: {
        pattern: {
          coverMode: "auto",
          coverConfig: { ...BASE_CONFIG, enabled: false },
        },
      },
    });

    await triggerAutoCoverPackForRender("render-1", "tpl-1", "http://video.mp4", "user-1");

    expect(mockCoverFramePackCreate).not.toHaveBeenCalled();
  });

  it("snapshote les données du render dans le pack créé", async () => {
    mockTemplateExists();
    mockRenderFindUnique.mockResolvedValueOnce({
      publicationSlot: {
        pattern: { coverMode: "auto", coverConfig: BASE_CONFIG },
      },
    });

    await triggerAutoCoverPackForRender("render-42", "tpl-99", "http://video.example.com/rush.mp4", "user-X");

    expect(mockCoverFramePackCreate).toHaveBeenCalledOnce();
    const createCall = mockCoverFramePackCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createCall.data.renderId).toBe("render-42");
    expect(createCall.data.templateId).toBe("tpl-99");
    expect(createCall.data.sourceVideoUrl).toBe("http://video.example.com/rush.mp4");
    expect(createCall.data.userId).toBe("user-X");
    expect(createCall.data.status).toBe("QUEUED");
  });
});
