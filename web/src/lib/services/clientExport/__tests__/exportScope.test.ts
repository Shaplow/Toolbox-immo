import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks Prisma ──────────────────────────────────────────────────────────────
const mockAccounts = vi.fn();
const mockMediaLibraries = vi.fn();
const mockDataLibraries = vi.fn();
const mockMediaAssets = vi.fn();
const mockDataEntries = vi.fn();
const mockSlots = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    instagramAccount: { findMany: (...a: unknown[]) => mockAccounts(...a) },
    mediaLibrary: { findMany: (...a: unknown[]) => mockMediaLibraries(...a) },
    dataLibrary: { findMany: (...a: unknown[]) => mockDataLibraries(...a) },
    mediaAsset: { findMany: (...a: unknown[]) => mockMediaAssets(...a) },
    dataEntry: { findMany: (...a: unknown[]) => mockDataEntries(...a) },
    publicationSlot: { findMany: (...a: unknown[]) => mockSlots(...a) },
  },
}));

vi.mock("@/lib/storage", () => ({ isLocalStorage: () => false }));

import { NOT_GENERATED, resolveExportScope } from "@/lib/services/clientExport/exportScope";
import type { ExportSelection } from "@/lib/clientExport/types";

const SELECTION: ExportSelection = {
  clientId: "client1",
  accountIds: ["acc1", "acc2", "intrus"],
  mediaLibraryIds: ["vid", "aud"],
  dataLibraryIds: ["data"],
  includePublications: true,
};

function asset(id: string, libraryId: string, accesses: string[], extra: Record<string, unknown> = {}) {
  return {
    id,
    libraryId,
    filename: `${id}.mov`,
    r2Key: `content-library/videos/${id}.mov`,
    url: `https://cdn.toolboximmo.com/content-library/videos/${id}.mov`,
    setTag: null,
    sizeBytes: BigInt(1000),
    createdAt: new Date("2026-09-01T10:00:00Z"),
    editJobs: [],
    accesses: accesses.map((accountId) => ({ accountId })),
    ...extra,
  };
}

beforeEach(() => {
  vi.stubEnv("R2_PUBLIC_URL", "https://cdn.toolboximmo.com");
  for (const m of [mockAccounts, mockMediaLibraries, mockDataLibraries, mockMediaAssets, mockDataEntries, mockSlots]) {
    m.mockReset();
  }
  // La base ne renvoie que les comptes du client : « intrus » appartient à un autre.
  mockAccounts.mockResolvedValue([
    { id: "acc1", name: "Sarah", handle: "sarah" },
    { id: "acc2", name: "Paul", handle: "paul" },
  ]);
  mockMediaLibraries.mockResolvedValue([
    { id: "vid", name: "Behind the scene", type: "video" },
    { id: "aud", name: "Musiques", type: "audio" },
  ]);
  mockDataLibraries.mockResolvedValue([{ id: "data", name: "Chiffres marché" }]);
  mockMediaAssets.mockResolvedValue([]);
  mockDataEntries.mockResolvedValue([]);
  mockSlots.mockResolvedValue([]);
});

describe("resolveExportScope — comptes", () => {
  it("ne garde que les comptes du client, hors sentinelles", async () => {
    await resolveExportScope(SELECTION);
    const where = mockAccounts.mock.calls[0][0].where;
    expect(where.clientId).toBe("client1");
    expect(where.id.in).toEqual(["acc1", "acc2", "intrus"]);
    expect(where.id.notIn).toEqual(expect.arrayContaining(["__shared__"]));
  });

  it("ne lit rien d'autre si aucun compte ne reste", async () => {
    mockAccounts.mockResolvedValue([]);
    const scope = await resolveExportScope(SELECTION);
    expect(scope.items).toEqual([]);
    expect(mockMediaAssets).not.toHaveBeenCalled();
  });
});

describe("resolveExportScope — médias", () => {
  it("cherche les réservés des seuls comptes retenus, auto-save exclus (NULL compris)", async () => {
    await resolveExportScope(SELECTION);
    const reservedWhere = mockMediaAssets.mock.calls[0][0].where;
    expect(reservedWhere.AND).toEqual(
      expect.arrayContaining([
        { libraryId: { in: ["vid", "aud"] } },
        { accesses: { some: { accountId: { in: ["acc1", "acc2"] } } } },
        NOT_GENERATED,
      ]),
    );
    // NOT_GENERATED garde les assets historiques dont source est NULL.
    expect(NOT_GENERATED).toEqual({ OR: [{ source: null }, { source: { not: "generated" } }] });
    // Les accès renvoyés sont filtrés sur les comptes retenus.
    expect(mockMediaAssets.mock.calls[0][0].select.accesses.where).toEqual({
      accountId: { in: ["acc1", "acc2"] },
    });
  });

  it("copie un média réservé à deux comptes du client dans les deux dossiers", async () => {
    mockMediaAssets.mockResolvedValueOnce([asset("a1", "vid", ["acc1", "acc2"])]).mockResolvedValueOnce([]);
    const scope = await resolveExportScope(SELECTION);
    const media = scope.items.filter((i) => i.kind === "media");
    expect(media.map((i) => i.accountId).sort()).toEqual(["acc1", "acc2"]);
    expect(new Set(media.map((i) => i.ref)).size).toBe(2);
  });

  it("ne cherche les communs que dans les bibliothèques de sons", async () => {
    await resolveExportScope(SELECTION);
    const commonWhere = mockMediaAssets.mock.calls[1][0].where;
    expect(commonWhere.AND).toEqual(
      expect.arrayContaining([{ libraryId: { in: ["aud"] } }, { accesses: { none: {} } }, NOT_GENERATED]),
    );
  });

  it("range les sons communs dans « Commun » (accountId null)", async () => {
    mockMediaAssets
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([asset("m1", "aud", [], { r2Key: "content-library/audio/m1.mp3", filename: "m1.mp3" })]);
    const scope = await resolveExportScope(SELECTION);
    expect(scope.items).toEqual([
      expect.objectContaining({ kind: "media", assetId: "m1", accountId: null, libraryType: "audio" }),
    ]);
  });

  it("ramène les dossiers pack_ à la racine et signale les fichiers édités", async () => {
    mockMediaAssets
      .mockResolvedValueOnce([
        asset("a1", "vid", ["acc1"], { setTag: "pack_legacy", editJobs: [{ id: "j1" }] }),
        asset("a2", "vid", ["acc1"], { setTag: "Cuisine" }),
      ])
      .mockResolvedValueOnce([]);
    const scope = await resolveExportScope(SELECTION);
    const byId = Object.fromEntries(
      scope.items.filter((i) => i.kind === "media").map((i) => [i.kind === "media" ? i.assetId : "", i]),
    );
    expect(byId.a1).toMatchObject({ folder: null, edited: true });
    expect(byId.a2).toMatchObject({ folder: "Cuisine", edited: false });
  });
});

describe("resolveExportScope — données", () => {
  it("sépare fiches réservées et communes, ignore celles des autres comptes", async () => {
    mockDataEntries.mockResolvedValue([
      { libraryId: "data", accesses: [], _count: { accesses: 0 } }, // commune
      { libraryId: "data", accesses: [], _count: { accesses: 0 } }, // commune
      { libraryId: "data", accesses: [{ accountId: "acc1" }], _count: { accesses: 1 } }, // Sarah
      { libraryId: "data", accesses: [], _count: { accesses: 1 } }, // réservée à un autre compte
    ]);
    const scope = await resolveExportScope(SELECTION);
    const data = scope.items.filter((i) => i.kind === "data");
    expect(data).toHaveLength(2);
    expect(data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: null, entryCount: 2 }),
        expect.objectContaining({ accountId: "acc1", entryCount: 1 }),
      ]),
    );
  });
});

describe("resolveExportScope — publications", () => {
  function slot(id: string, extra: Record<string, unknown> = {}) {
    return {
      id,
      accountId: "acc1",
      title: "Visite T3",
      publishedAt: new Date("2026-09-14T08:00:00Z"),
      scheduledAt: null,
      createdAt: new Date("2026-09-01T08:00:00Z"),
      entity: { label: "Rue des Lilas" },
      patternBinding: null,
      patternTemplate: { label: "RVA3", clientLabel: null },
      currentVersion: null,
      render: null,
      captionJobs: [],
      ...extra,
    };
  }

  it("ne demande que les slots publiés (ou archivés après publication) des comptes retenus", async () => {
    await resolveExportScope(SELECTION);
    const where = mockSlots.mock.calls[0][0].where;
    expect(where.accountId).toEqual({ in: ["acc1", "acc2"] });
    expect(where.OR).toEqual([
      { status: "PUBLISHED" },
      { status: "ARCHIVED", OR: [{ publishedAt: { not: null } }, { publishedUrl: { not: null } }] },
    ]);
    const captionWhere = mockSlots.mock.calls[0][0].select.captionJobs.where;
    expect(captionWhere).toEqual({ status: "COMPLETED", staleSince: null, previewMode: false });
  });

  it("exporte la version courante et écarte une publication sans vidéo", async () => {
    mockSlots.mockResolvedValue([
      slot("s1", {
        currentVersion: {
          r2Key: "publications/s1/versions/v0-x.mp4",
          fileName: "montage final.mp4",
          fileUrl: "https://cdn.toolboximmo.com/publications/s1/versions/v0-x.mp4",
          fileSizeBytes: 5000,
          deletedAt: null,
        },
      }),
      slot("s2"),
    ]);
    const scope = await resolveExportScope(SELECTION);
    expect(scope.items).toEqual([
      expect.objectContaining({
        kind: "publication",
        slotId: "s1",
        source: "version",
        r2Key: "publications/s1/versions/v0-x.mp4",
        label: "Visite T3",
        entityLabel: "Rue des Lilas",
      }),
    ]);
    expect(scope.skipped).toEqual([
      expect.objectContaining({ kind: "publication", accountId: "acc1", reason: "no_video" }),
    ]);
  });

  it("ne lit pas les publications si la case n'est pas cochée", async () => {
    await resolveExportScope({ ...SELECTION, includePublications: false });
    expect(mockSlots).not.toHaveBeenCalled();
  });
});
