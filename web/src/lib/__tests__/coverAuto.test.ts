import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────
// On mock toutes les dépendances effectuant des I/O pour que les tests restent
// purement synchrones / sans DB.

const mockRenderFindUnique = vi.fn();
const mockTemplateFindUnique = vi.fn();
const mockCoverFramePackFindUnique = vi.fn();
const mockCoverFramePackCreate = vi.fn();
const mockTemplateCoverPresetFindUnique = vi.fn();

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
    templateCoverPreset: {
      findUnique: (...args: unknown[]) => mockTemplateCoverPresetFindUnique(...args),
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

/** Config pattern Phase 2.0 : coverPresetName au lieu de overlayGroupIds bruts */
const PATTERN_CONFIG_WITH_PRESET = {
  enabled: true,
  coverPresetName: "Default",
};

/** Config preset en DB (c'est lui qui porte les overlayGroupIds, frameCount, etc.) */
const PRESET_CONFIG = {
  enabled: true,
  frameCount: 12,
  excludeZones: [],
  overlayGroupIds: ["group-overlay-1"],
  offsetX: 0,
  offsetY: 0,
};

const MOCK_PRESET = {
  id: "preset-1",
  templateId: "tpl-1",
  name: "Default",
  config: PRESET_CONFIG,
  sortOrder: 0,
};

function mockTemplateExists() {
  mockTemplateFindUnique.mockResolvedValueOnce({ id: "tpl-1" });
}

function mockPresetExists(preset = MOCK_PRESET) {
  mockTemplateCoverPresetFindUnique.mockResolvedValueOnce(preset);
}

// ── Tests : triggerAutoCoverPackForRender ─────────────────────────────────────

describe("triggerAutoCoverPackForRender — Phase 2.0 : résolution via coverPresetName", () => {
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

    expect(mockCoverFramePackCreate).not.toHaveBeenCalled();
  });

  it("ne crée pas de pack si pattern.coverMode !== 'auto'", async () => {
    mockTemplateExists();
    mockRenderFindUnique.mockResolvedValueOnce({
      publicationSlot: {
        pattern: { id: "pat-1", coverMode: "manual", coverConfig: PATTERN_CONFIG_WITH_PRESET, templateId: "tpl-1" },
      },
    });

    await triggerAutoCoverPackForRender("render-1", "tpl-1", "http://video.mp4", "user-1");

    expect(mockCoverFramePackCreate).not.toHaveBeenCalled();
  });

  it("ne crée pas de pack si pattern.coverConfig est null", async () => {
    mockTemplateExists();
    mockRenderFindUnique.mockResolvedValueOnce({
      publicationSlot: {
        pattern: { id: "pat-1", coverMode: "auto", coverConfig: null, templateId: "tpl-1" },
      },
    });

    await triggerAutoCoverPackForRender("render-1", "tpl-1", "http://video.mp4", "user-1");

    expect(mockCoverFramePackCreate).not.toHaveBeenCalled();
  });

  it("ne crée pas de pack si config.enabled est false", async () => {
    mockTemplateExists();
    mockRenderFindUnique.mockResolvedValueOnce({
      publicationSlot: {
        pattern: {
          id: "pat-1",
          coverMode: "auto",
          coverConfig: { enabled: false, coverPresetName: "Default" },
          templateId: "tpl-1",
        },
      },
    });

    await triggerAutoCoverPackForRender("render-1", "tpl-1", "http://video.mp4", "user-1");

    expect(mockCoverFramePackCreate).not.toHaveBeenCalled();
    // Le preset ne doit pas être cherché si enabled=false
    expect(mockTemplateCoverPresetFindUnique).not.toHaveBeenCalled();
  });

  it("warn + skip si coverPresetName est absent (pattern non migré)", async () => {
    mockTemplateExists();
    mockRenderFindUnique.mockResolvedValueOnce({
      publicationSlot: {
        pattern: {
          id: "pat-unmigrated",
          coverMode: "auto",
          coverConfig: { enabled: true }, // pas de coverPresetName
          templateId: "tpl-1",
        },
      },
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await triggerAutoCoverPackForRender("render-1", "tpl-1", "http://video.mp4", "user-1");

    expect(mockCoverFramePackCreate).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no coverPresetName"));
    warnSpy.mockRestore();
  });

  it("warn + skip si le preset référencé n'existe pas en DB", async () => {
    mockTemplateExists();
    mockRenderFindUnique.mockResolvedValueOnce({
      publicationSlot: {
        pattern: {
          id: "pat-1",
          coverMode: "auto",
          coverConfig: { enabled: true, coverPresetName: "Inexistant" },
          templateId: "tpl-1",
        },
      },
    });
    // Preset introuvable
    mockTemplateCoverPresetFindUnique.mockResolvedValueOnce(null);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await triggerAutoCoverPackForRender("render-1", "tpl-1", "http://video.mp4", "user-1");

    expect(mockCoverFramePackCreate).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("introuvable"));
    warnSpy.mockRestore();
  });

  it("crée un pack en utilisant preset.config quand coverPresetName est valide", async () => {
    mockTemplateExists();
    mockRenderFindUnique.mockResolvedValueOnce({
      publicationSlot: {
        pattern: {
          id: "pat-1",
          coverMode: "auto",
          coverConfig: PATTERN_CONFIG_WITH_PRESET,
          templateId: "tpl-1",
        },
      },
    });
    mockPresetExists();

    await triggerAutoCoverPackForRender("render-1", "tpl-1", "http://video.mp4", "user-1");

    expect(mockCoverFramePackCreate).toHaveBeenCalledOnce();
    const createCall = mockCoverFramePackCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    // La config stockée dans le pack doit venir du preset, pas du pattern
    const storedConfig = JSON.parse(createCall.data.config as string) as { overlayGroupIds?: string[] };
    expect(storedConfig.overlayGroupIds).toEqual(PRESET_CONFIG.overlayGroupIds);
    expect(createCall.data.frameCount).toBe(PRESET_CONFIG.frameCount);
  });

  it("le preset est résolu avec le templateId du pattern si disponible", async () => {
    mockTemplateExists();
    mockRenderFindUnique.mockResolvedValueOnce({
      publicationSlot: {
        pattern: {
          id: "pat-1",
          coverMode: "auto",
          coverConfig: PATTERN_CONFIG_WITH_PRESET,
          templateId: "tpl-pattern", // templateId du pattern (peut différer du render)
        },
      },
    });
    mockPresetExists({ ...MOCK_PRESET, templateId: "tpl-pattern" });

    await triggerAutoCoverPackForRender("render-1", "tpl-1", "http://video.mp4", "user-1");

    expect(mockTemplateCoverPresetFindUnique).toHaveBeenCalledWith({
      where: { templateId_name: { templateId: "tpl-pattern", name: "Default" } },
    });
    expect(mockCoverFramePackCreate).toHaveBeenCalledOnce();
  });

  it("skip si un pack existe déjà pour ce render", async () => {
    mockTemplateExists();
    mockRenderFindUnique.mockResolvedValueOnce({
      publicationSlot: {
        pattern: {
          id: "pat-1",
          coverMode: "auto",
          coverConfig: PATTERN_CONFIG_WITH_PRESET,
          templateId: "tpl-1",
        },
      },
    });
    mockPresetExists();
    // Override : pack déjà existant pour ce render
    mockCoverFramePackFindUnique.mockResolvedValueOnce({ id: "existing-pack" });

    await triggerAutoCoverPackForRender("render-1", "tpl-1", "http://video.mp4", "user-1");

    expect(mockCoverFramePackCreate).not.toHaveBeenCalled();
  });

  it("snapshote les données du render dans le pack créé", async () => {
    mockTemplateExists();
    mockRenderFindUnique.mockResolvedValueOnce({
      publicationSlot: {
        pattern: {
          id: "pat-X",
          coverMode: "auto",
          coverConfig: PATTERN_CONFIG_WITH_PRESET,
          templateId: "tpl-99",
        },
      },
    });
    mockPresetExists({ ...MOCK_PRESET, templateId: "tpl-99" });

    await triggerAutoCoverPackForRender("render-42", "tpl-99", "http://video.example.com/rush.mp4", "user-X");

    expect(mockCoverFramePackCreate).toHaveBeenCalledOnce();
    const createCall = mockCoverFramePackCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createCall.data.renderId).toBe("render-42");
    expect(createCall.data.templateId).toBe("tpl-99");
    expect(createCall.data.sourceVideoUrl).toBe("http://video.example.com/rush.mp4");
    expect(createCall.data.userId).toBe("user-X");
    expect(createCall.data.status).toBe("QUEUED");
  });

  it("ne crée pas de pack si preset.config.enabled est false", async () => {
    mockTemplateExists();
    mockRenderFindUnique.mockResolvedValueOnce({
      publicationSlot: {
        pattern: {
          id: "pat-1",
          coverMode: "auto",
          coverConfig: PATTERN_CONFIG_WITH_PRESET,
          templateId: "tpl-1",
        },
      },
    });
    // Preset existant mais disabled
    mockTemplateCoverPresetFindUnique.mockResolvedValueOnce({
      ...MOCK_PRESET,
      config: { ...PRESET_CONFIG, enabled: false },
    });

    await triggerAutoCoverPackForRender("render-1", "tpl-1", "http://video.mp4", "user-1");

    expect(mockCoverFramePackCreate).not.toHaveBeenCalled();
  });
});
