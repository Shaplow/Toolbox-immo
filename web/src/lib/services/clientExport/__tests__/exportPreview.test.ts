import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    instagramAccount: { findMany: async () => [{ id: "acc1" }, { id: "acc2" }] },
    mediaLibrary: { findMany: async () => [{ id: "vid" }, { id: "aud" }, { id: "vide" }] },
    dataLibrary: { findMany: async () => [{ id: "data" }] },
  },
}));

vi.mock("@/lib/services/clientExport/exportScope", () => ({
  resolveExportScope: async () => ({
    accounts: [
      { id: "acc1", name: "Sarah", handle: "sarah" },
      { id: "acc2", name: "Paul", handle: "paul" },
    ],
    libraries: [
      { id: "vid", name: "Behind the scene", type: "video" },
      { id: "aud", name: "Musiques", type: "audio" },
      { id: "vide", name: "Bibliothèque sans rien pour ce client", type: "video" },
      { id: "data", name: "Chiffres", type: "data" },
    ],
    items: [],
    skipped: [
      { kind: "publication", accountId: "acc1", reason: "image_post", label: "" },
      { kind: "publication", accountId: "acc1", reason: "image_post", label: "" },
      { kind: "publication", accountId: "acc2", reason: "no_video", label: "" },
    ],
  }),
}));

vi.mock("@/lib/services/clientExport/exportSizes", () => ({
  ensureExportSizes: async () => ({
    items: [
      { kind: "media", ref: "m.a1.acc1", accountId: "acc1", libraryId: "vid", sizeBytes: 1000 },
      { kind: "media", ref: "m.a2.acc2", accountId: "acc2", libraryId: "vid", sizeBytes: 500 },
      { kind: "media", ref: "m.m1.c", accountId: null, libraryId: "aud", sizeBytes: 300 },
      { kind: "data", ref: "d.data.c", accountId: null, libraryId: "data", entryCount: 12 },
      { kind: "data", ref: "d.data.acc1", accountId: "acc1", libraryId: "data", entryCount: 3 },
      { kind: "publication", ref: "p.s1", accountId: "acc1", sizeBytes: 4000 },
    ],
    skipped: [
      { kind: "media", accountId: "acc2", reason: "missing", label: "" },
      { kind: "publication", accountId: "acc1", reason: "missing", label: "" },
    ],
  }),
}));

import { buildExportPreview } from "@/lib/services/clientExport/exportPreview";

describe("buildExportPreview", () => {
  it("agrège par bibliothèque et par compte, communs à part, bibliothèques vides masquées", async () => {
    const preview = await buildExportPreview("client1");
    expect(preview.libraries.map((l) => l.id)).toEqual(["vid", "aud", "data"]);
    const byId = Object.fromEntries(preview.libraries.map((l) => [l.id, l]));
    expect(byId.vid.perAccount).toEqual({ acc1: { files: 1, bytes: 1000 }, acc2: { files: 1, bytes: 500 } });
    expect(byId.vid.common).toBeNull();
    expect(byId.aud.common).toEqual({ files: 1, bytes: 300 });
    expect(byId.data.common).toEqual({ files: 12, bytes: 0 });
    expect(byId.data.perAccount).toEqual({ acc1: { files: 3, bytes: 0 } });
    expect(preview.publications.perAccount).toEqual({ acc1: { files: 1, bytes: 4000 } });
  });

  it("détaille les publications non exportables par compte et par motif", async () => {
    const preview = await buildExportPreview("client1");
    expect(preview.publications.unavailable).toEqual({
      acc1: { image_post: 2, missing: 1 },
      acc2: { no_video: 1 },
    });
  });

  it("ne compte comme fichiers introuvables que les médias (pas de double comptage)", async () => {
    const preview = await buildExportPreview("client1");
    expect(preview.missingFiles).toBe(1);
  });
});
