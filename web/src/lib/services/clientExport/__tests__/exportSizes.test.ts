import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUpdateMany = vi.fn();
const mockStat = vi.fn();
const mockHead = vi.fn();
const mockList = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { mediaAsset: { updateMany: (...a: unknown[]) => mockUpdateMany(...a) } },
}));
vi.mock("@/lib/storage", () => ({
  isLocalStorage: () => false,
  localFileSizeForUrl: vi.fn(),
}));
vi.mock("@/lib/r2", () => ({
  headR2Object: (...a: unknown[]) => mockHead(...a),
  listR2ObjectSizes: (...a: unknown[]) => mockList(...a),
}));
vi.mock("@/lib/services/mediaAsset/assetSize", () => ({
  statMediaAssetFile: (...a: unknown[]) => mockStat(...a),
}));

import { ensureExportSizes } from "@/lib/services/clientExport/exportSizes";
import type { MediaExportItem } from "@/lib/clientExport/types";

function media(assetId: string, sizeBytes: number | null = null): MediaExportItem {
  return {
    kind: "media",
    ref: `m.${assetId}.acc1`,
    accountId: "acc1",
    assetId,
    libraryId: "lib",
    libraryType: "video",
    folder: null,
    filename: `${assetId}.mov`,
    r2Key: `content-library/videos/${assetId}.mov`,
    url: `https://cdn.toolboximmo.com/content-library/videos/${assetId}.mov`,
    edited: false,
    sizeBytes,
    createdAt: "2026-09-01T00:00:00.000Z",
  };
}

const label = () => "libellé";

beforeEach(() => {
  for (const m of [mockUpdateMany, mockStat, mockHead, mockList]) m.mockReset();
  mockUpdateMany.mockResolvedValue({ count: 1 });
});

describe("ensureExportSizes — médias", () => {
  it("complète une taille inconnue sans écraser une taille posée entre-temps", async () => {
    mockStat.mockResolvedValue(4096);
    const { items, skipped } = await ensureExportSizes([media("s1")], label);

    expect(items).toEqual([expect.objectContaining({ assetId: "s1", sizeBytes: 4096 })]);
    expect(skipped).toEqual([]);
    // updateMany conditionné à sizeBytes null : un media_edit concurrent garde sa taille.
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "s1", sizeBytes: null },
      data: { sizeBytes: BigInt(4096) },
    });
  });

  it("écarte un fichier introuvable et ne le recherche plus pendant l'heure suivante", async () => {
    mockStat.mockResolvedValue(null);
    const first = await ensureExportSizes([media("ghost1")], label);
    expect(first.items).toEqual([]);
    expect(first.skipped).toEqual([{ kind: "media", accountId: "acc1", reason: "missing", label: "libellé" }]);
    expect(mockStat).toHaveBeenCalledTimes(1);

    const second = await ensureExportSizes([media("ghost1")], label);
    expect(second.skipped).toHaveLength(1);
    expect(mockStat).toHaveBeenCalledTimes(1);
  });

  it("garde un fichier à taille inconnue si le stockage ne répond pas (le téléchargement tranchera)", async () => {
    mockStat.mockRejectedValue(new Error("timeout"));
    const { items, skipped } = await ensureExportSizes([media("flaky1")], label);
    expect(items).toEqual([expect.objectContaining({ assetId: "flaky1", sizeBytes: null })]);
    expect(skipped).toEqual([]);
  });

  it("ne mesure pas les tailles déjà connues", async () => {
    const { items } = await ensureExportSizes([media("known1", 777)], label);
    expect(items[0]).toMatchObject({ sizeBytes: 777 });
    expect(mockStat).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("au-delà de 150 tailles inconnues, liste le stockage une fois au lieu d'un HEAD par fichier", async () => {
    const many = Array.from({ length: 151 }, (_, i) => media(`bulk${i}`));
    mockList.mockResolvedValue(new Map([[many[0].r2Key, 10]]));
    const { items, skipped } = await ensureExportSizes(many, label);
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockStat).not.toHaveBeenCalled();
    expect(items).toHaveLength(1);
    expect(skipped).toHaveLength(150);
  });
});
