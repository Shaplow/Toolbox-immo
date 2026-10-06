import { describe, expect, it } from "vitest";
import {
  createExportLinkSchema,
  exportEventSchema,
  exportLinkActionSchema,
  exportUrlsSchema,
} from "../schemas";

const VALID = {
  label: "Fin de contrat",
  expiresInDays: 7,
  accountIds: ["acc1"],
  mediaLibraryIds: ["lib1"],
  dataLibraryIds: [],
  includePublications: false,
};

describe("createExportLinkSchema", () => {
  it("accepte un corps complet, libellé facultatif ou null", () => {
    expect(createExportLinkSchema.safeParse(VALID).success).toBe(true);
    expect(createExportLinkSchema.safeParse({ ...VALID, label: null }).success).toBe(true);
    const withoutLabel: Partial<typeof VALID> = { ...VALID };
    delete withoutLabel.label;
    expect(createExportLinkSchema.safeParse(withoutLabel).success).toBe(true);
  });

  it("n'accepte que les durées proposées", () => {
    for (const days of [1, 3, 7, 14, 30]) {
      expect(createExportLinkSchema.safeParse({ ...VALID, expiresInDays: days }).success).toBe(true);
    }
    for (const days of [0, 2, 31, 365, 7.5]) {
      expect(createExportLinkSchema.safeParse({ ...VALID, expiresInDays: days }).success).toBe(false);
    }
  });

  it("exige au moins un compte et au moins un contenu", () => {
    expect(createExportLinkSchema.safeParse({ ...VALID, accountIds: [] }).success).toBe(false);
    expect(
      createExportLinkSchema.safeParse({ ...VALID, mediaLibraryIds: [], dataLibraryIds: [], includePublications: false })
        .success,
    ).toBe(false);
    expect(
      createExportLinkSchema.safeParse({ ...VALID, mediaLibraryIds: [], dataLibraryIds: [], includePublications: true })
        .success,
    ).toBe(true);
  });

  it("refuse une clé inconnue (corps strict)", () => {
    expect(createExportLinkSchema.safeParse({ ...VALID, clientId: "autre" }).success).toBe(false);
  });
});

describe("exportLinkActionSchema", () => {
  it("connaît revoke, rotate et extend (avec une durée proposée)", () => {
    expect(exportLinkActionSchema.safeParse({ action: "revoke" }).success).toBe(true);
    expect(exportLinkActionSchema.safeParse({ action: "rotate" }).success).toBe(true);
    expect(exportLinkActionSchema.safeParse({ action: "extend", days: 7 }).success).toBe(true);
    expect(exportLinkActionSchema.safeParse({ action: "extend", days: 8 }).success).toBe(false);
    expect(exportLinkActionSchema.safeParse({ action: "extend" }).success).toBe(false);
    expect(exportLinkActionSchema.safeParse({ action: "delete" }).success).toBe(false);
  });
});

describe("schémas publics", () => {
  it("urls : 1 à 20 refs", () => {
    expect(exportUrlsSchema.safeParse({ refs: ["m.a.b"] }).success).toBe(true);
    expect(exportUrlsSchema.safeParse({ refs: [] }).success).toBe(false);
    expect(exportUrlsSchema.safeParse({ refs: Array.from({ length: 21 }, (_, i) => `p.${i}`) }).success).toBe(false);
    expect(exportUrlsSchema.safeParse({ refs: ["x".repeat(201)] }).success).toBe(false);
  });

  it("events : bilan d'entiers positifs bornés", () => {
    const report = { files: 3, bytes: 1024, skipped: 1, failed: 0, missing: 0 };
    expect(exportEventSchema.safeParse({ type: "started", ...report }).success).toBe(true);
    expect(exportEventSchema.safeParse({ type: "finished", ...report }).success).toBe(false);
    expect(exportEventSchema.safeParse({ type: "completed", ...report, failed: -1 }).success).toBe(false);
    expect(exportEventSchema.safeParse({ type: "completed", ...report, bytes: 1e15 }).success).toBe(false);
  });
});
