import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clientExportLink: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

import { Prisma } from "@prisma/client";
import { exportLinkStatus, recordExportEvent, verifyExportToken } from "@/lib/services/clientExport/exportLinks";
import { hashToken } from "@/lib/publications/clientValidation";

const TOKEN = "a".repeat(64);
const NOW = new Date("2026-10-06T12:00:00Z");

function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "link1",
    clientId: "client1",
    expiresAt: new Date("2026-10-13T12:00:00Z"),
    revokedAt: null,
    accountIds: ["acc1"],
    mediaLibraryIds: ["lib1"],
    dataLibraryIds: [],
    includePublications: true,
    firstOpenedAt: null,
    client: { name: "Agence Dupont" },
    ...overrides,
  };
}

describe("exportLinkStatus", () => {
  it("révoqué prime sur expiré", () => {
    expect(exportLinkStatus({ expiresAt: new Date("2026-01-01"), revokedAt: new Date() }, NOW)).toBe("revoked");
  });

  it("expiré dès l'échéance atteinte", () => {
    expect(exportLinkStatus({ expiresAt: NOW, revokedAt: null }, NOW)).toBe("expired");
    expect(exportLinkStatus({ expiresAt: new Date(NOW.getTime() + 1), revokedAt: null }, NOW)).toBe("active");
  });
});

describe("verifyExportToken", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it("rejette un jeton mal formé sans toucher la base", async () => {
    for (const raw of ["", "abc", "A".repeat(64), `${"a".repeat(63)}g`, "a".repeat(65)]) {
      expect(await verifyExportToken(raw)).toEqual({ valid: false, reason: "not_found" });
    }
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("cherche par hash, jamais par jeton brut", async () => {
    mockFindUnique.mockResolvedValue(null);
    await verifyExportToken(TOKEN);
    expect(mockFindUnique.mock.calls[0][0].where).toEqual({ tokenHash: hashToken(TOKEN) });
  });

  it("distingue inconnu, expiré et révoqué", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    expect(await verifyExportToken(TOKEN)).toEqual({ valid: false, reason: "not_found" });

    mockFindUnique.mockResolvedValueOnce(linkRow({ expiresAt: new Date("2026-10-01T00:00:00Z") }));
    expect(await verifyExportToken(TOKEN)).toEqual({ valid: false, reason: "expired" });

    mockFindUnique.mockResolvedValueOnce(linkRow({ revokedAt: new Date("2026-10-02T00:00:00Z") }));
    expect(await verifyExportToken(TOKEN)).toEqual({ valid: false, reason: "revoked" });
  });

  it("renvoie la sélection figée d'un lien actif", async () => {
    mockFindUnique.mockResolvedValueOnce(linkRow());
    const result = await verifyExportToken(TOKEN);
    expect(result).toMatchObject({
      valid: true,
      link: {
        id: "link1",
        clientName: "Agence Dupont",
        selection: {
          clientId: "client1",
          accountIds: ["acc1"],
          mediaLibraryIds: ["lib1"],
          dataLibraryIds: [],
          includePublications: true,
        },
      },
    });
  });
});

describe("recordExportEvent", () => {
  const report = { files: 40, bytes: 5_000, skipped: 2, failed: 0, missing: 0 };

  beforeEach(() => {
    mockUpdate.mockReset().mockResolvedValue({});
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  const dataOf = () => mockUpdate.mock.calls[0][0].data;

  it("un lancement pose le DERNIER départ et efface le bilan précédent", async () => {
    await recordExportEvent("link1", { type: "started", ...report });
    expect(dataOf()).toEqual({
      startCount: { increment: 1 },
      downloadStartedAt: NOW,
      lastReport: Prisma.DbNull,
    });
  });

  it("une fin sans échec pose « terminé » et le bilan", async () => {
    await recordExportEvent("link1", { type: "completed", ...report });
    expect(dataOf()).toEqual({ lastReport: report, downloadCompletedAt: NOW });
  });

  it("une fin avec échecs, ou un arrêt, ne pose que le bilan", async () => {
    await recordExportEvent("link1", { type: "completed", ...report, failed: 3 });
    expect(dataOf()).toEqual({ lastReport: { ...report, failed: 3 } });

    mockUpdate.mockClear();
    await recordExportEvent("link1", { type: "stopped", ...report });
    expect(dataOf()).toEqual({ lastReport: report });
  });
});
