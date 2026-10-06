import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clientExportLink: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

import { exportLinkStatus, verifyExportToken } from "@/lib/services/clientExport/exportLinks";
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
