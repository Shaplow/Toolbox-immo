import { describe, it, expect } from "vitest";
import { sanitizeFilename, rushKey, versionKey, briefAttachmentKey } from "@/lib/r2Keys";

// ─── sanitizeFilename ──────────────────────────────────────────────────────────

describe("sanitizeFilename", () => {
  it("préserve l'extension en minuscule", () => {
    expect(sanitizeFilename("video.MP4").ext).toBe("mp4");
    expect(sanitizeFilename("photo.JPEG").ext).toBe("jpeg");
    expect(sanitizeFilename("doc.PDF").ext).toBe("pdf");
  });

  it("remplace les caractères spéciaux du stem par des tirets", () => {
    const { stem } = sanitizeFilename("mon fichier (1).mp4");
    expect(stem).toMatch(/^[a-zA-Z0-9-]+$/);
    expect(stem).not.toContain(" ");
    expect(stem).not.toContain("(");
    expect(stem).not.toContain(")");
  });

  it("supprime les tirets consécutifs", () => {
    const { stem } = sanitizeFilename("mon---fichier.mp4");
    expect(stem).not.toContain("--");
  });

  it("supprime les tirets de début et de fin", () => {
    const { stem } = sanitizeFilename("  espaces  .mp4");
    expect(stem).not.toMatch(/^-/);
    expect(stem).not.toMatch(/-$/);
  });

  it("gère un fichier sans extension", () => {
    const { stem, ext } = sanitizeFilename("noextension");
    expect(stem).toBeTruthy();
    expect(ext).toBe("bin");
  });

  it("gère un nom vide ou uniquement des caractères spéciaux", () => {
    const { stem } = sanitizeFilename("!!@#$.mp4");
    expect(stem).toBe("file");
  });

  it("préserve les caractères alphanumériques et tirets existants", () => {
    const { stem, ext } = sanitizeFilename("RPI-2026-01-15.mp4");
    expect(stem).toBe("RPI-2026-01-15");
    expect(ext).toBe("mp4");
  });
});

// ─── rushKey ───────────────────────────────────────────────────────────────────

describe("rushKey", () => {
  it("préfixe correctement avec publications/{slotId}/rushes/", () => {
    const key = rushKey("slot-abc", "video.mp4");
    expect(key).toMatch(/^publications\/slot-abc\/rushes\//);
  });

  it("préserve l'extension du fichier source", () => {
    expect(rushKey("slot-1", "clip.MOV")).toMatch(/\.mov$/);
    expect(rushKey("slot-1", "photo.JPEG")).toMatch(/\.jpeg$/);
    expect(rushKey("slot-1", "video.mp4")).toMatch(/\.mp4$/);
  });

  it("génère des clés uniques sur deux appels successifs", () => {
    const k1 = rushKey("slot-1", "video.mp4");
    const k2 = rushKey("slot-1", "video.mp4");
    // Les clés contiennent un random token, très peu de chance de collision
    expect(k1).not.toBe(k2);
  });

  it("isole par slotId", () => {
    const k1 = rushKey("slot-A", "v.mp4");
    const k2 = rushKey("slot-B", "v.mp4");
    expect(k1).toContain("slot-A");
    expect(k2).toContain("slot-B");
    expect(k1).not.toContain("slot-B");
  });
});

// ─── versionKey ───────────────────────────────────────────────────────────────

describe("versionKey", () => {
  it("préfixe correctement avec publications/{slotId}/versions/", () => {
    const key = versionKey("slot-xyz", 3, "montage.mp4");
    expect(key).toMatch(/^publications\/slot-xyz\/versions\//);
  });

  it("inclut le numéro de version dans la clé", () => {
    const key = versionKey("slot-1", 5, "montage.mp4");
    expect(key).toContain("v5-");
  });

  it("préserve l'extension", () => {
    expect(versionKey("slot-1", 1, "montage.MOV")).toMatch(/\.mov$/);
    expect(versionKey("slot-1", 1, "video.mp4")).toMatch(/\.mp4$/);
  });

  it("isole par slotId et versionNumber", () => {
    const k1 = versionKey("slot-A", 1, "v.mp4");
    const k2 = versionKey("slot-A", 2, "v.mp4");
    expect(k1).toContain("v1-");
    expect(k2).toContain("v2-");
  });
});

// ─── briefAttachmentKey ───────────────────────────────────────────────────────

describe("briefAttachmentKey", () => {
  it("préfixe correctement avec publications/{slotId}/brief/", () => {
    const key = briefAttachmentKey("slot-abc", "cahier-des-charges.pdf");
    expect(key).toMatch(/^publications\/slot-abc\/brief\//);
  });

  it("préserve l'extension du fichier source", () => {
    expect(briefAttachmentKey("slot-1", "brief.PDF")).toMatch(/\.pdf$/);
    expect(briefAttachmentKey("slot-1", "photo.webp")).toMatch(/\.webp$/);
  });

  it("génère des clés uniques", () => {
    const k1 = briefAttachmentKey("slot-1", "doc.pdf");
    const k2 = briefAttachmentKey("slot-1", "doc.pdf");
    expect(k1).not.toBe(k2);
  });
});
