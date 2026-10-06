import { describe, it, expect, vi } from "vitest";

// Le module importe Prisma au chargement : on le neutralise, seuls les helpers
// purs sont testés ici.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  collectReferencedKeys,
  keyFromPublicUrl,
  parseCleanupParams,
  posterKeyForAsset,
  DEFAULT_MAX_DELETES,
  type ReferencedKeyRows,
} from "@/lib/r2Cleanup";

const PUBLIC_URL = "https://cdn.toolboximmo.com";

function emptyRows(): ReferencedKeyRows {
  return {
    rushes: [],
    versions: [],
    attachments: [],
    mediaAssets: [],
    covers: [],
    transcriptions: [],
    captions: [],
  };
}

describe("collectReferencedKeys", () => {
  it("protège la vignette de chaque asset, même sans posterUrl", () => {
    const rows = emptyRows();
    rows.mediaAssets = [{ id: "a1", r2Key: "content-library/videos/a1.mov", posterUrl: null }];

    const keys = collectReferencedKeys(rows, PUBLIC_URL);

    expect(keys.has("content-library/videos/a1.mov")).toBe(true);
    expect(keys.has("content-library/posters/a1.jpg")).toBe(true);
  });

  it("protège aussi la clé lue dans posterUrl (query retirée)", () => {
    const rows = emptyRows();
    rows.mediaAssets = [
      {
        id: "a2",
        r2Key: "content-library/videos/a2.mp4",
        posterUrl: `${PUBLIC_URL}/content-library/posters/autre-format.webp?v=3`,
      },
    ];

    const keys = collectReferencedKeys(rows, PUBLIC_URL);

    expect(keys.has("content-library/posters/autre-format.webp")).toBe(true);
    expect(keys.has("content-library/posters/a2.jpg")).toBe(true);
  });

  it("garde les sorties persistantes des transcriptions et des sous-titres", () => {
    const rows = emptyRows();
    rows.transcriptions = [{ inputKey: null, outputJsonKey: "transcription/u/1/segments.json" }];
    rows.captions = [{ inputKey: "inputs/captions/u/1/video.mp4", outputKey: null }];
    rows.covers = [{ finalCoverKey: "publications/s1/cover-monteur/1.jpg" }, { finalCoverKey: null }];

    const keys = collectReferencedKeys(rows, PUBLIC_URL);

    expect(keys.has("transcription/u/1/segments.json")).toBe(true);
    expect(keys.has("inputs/captions/u/1/video.mp4")).toBe(true);
    expect(keys.has("publications/s1/cover-monteur/1.jpg")).toBe(true);
    expect(keys.size).toBe(3);
  });

  it("reprend rushes, versions et pièces jointes telles quelles", () => {
    const rows = emptyRows();
    rows.rushes = [{ r2Key: "publications/s1/rushes/a.mp4" }];
    rows.versions = [{ r2Key: "publications/s1/versions/v0-x.mp4" }];
    rows.attachments = [{ r2Key: "publications/s1/brief/b.pdf" }];

    expect([...collectReferencedKeys(rows, PUBLIC_URL)].sort()).toEqual([
      "publications/s1/brief/b.pdf",
      "publications/s1/rushes/a.mp4",
      "publications/s1/versions/v0-x.mp4",
    ]);
  });
});

describe("keyFromPublicUrl", () => {
  it("n'accepte que le préfixe exact du bucket public", () => {
    expect(keyFromPublicUrl(`${PUBLIC_URL}/a/b.jpg`, PUBLIC_URL)).toBe("a/b.jpg");
    expect(keyFromPublicUrl(`${PUBLIC_URL}/a/b.jpg#x`, `${PUBLIC_URL}/`)).toBe("a/b.jpg");
    expect(keyFromPublicUrl("https://cdn.toolboximmo.com.evil.com/a.jpg", PUBLIC_URL)).toBeNull();
    expect(keyFromPublicUrl("/uploads/a_poster.jpg", PUBLIC_URL)).toBeNull();
    expect(keyFromPublicUrl(`${PUBLIC_URL}/a.jpg`, undefined)).toBeNull();
    expect(keyFromPublicUrl(null, PUBLIC_URL)).toBeNull();
  });
});

describe("posterKeyForAsset", () => {
  it("suit le format des routes poster et backfill-posters", () => {
    expect(posterKeyForAsset("abc")).toBe("content-library/posters/abc.jpg");
  });
});

describe("parseCleanupParams", () => {
  const parse = (qs: string) => parseCleanupParams(new URLSearchParams(qs));

  it("est un dry-run par défaut", () => {
    expect(parse("")).toEqual({ dryRun: true, maxDeletes: DEFAULT_MAX_DELETES });
  });

  it("ne supprime qu'avec apply=1", () => {
    expect(parse("apply=1").dryRun).toBe(false);
    expect(parse("apply=true").dryRun).toBe(true);
    expect(parse("dryRun=false").dryRun).toBe(true);
  });

  it("reste en dry-run si dryRun=true est aussi présent", () => {
    expect(parse("apply=1&dryRun=true").dryRun).toBe(true);
  });

  it("lit un plafond entier positif, sinon garde le défaut", () => {
    expect(parse("apply=1&maxDeletes=2000").maxDeletes).toBe(2000);
    expect(parse("maxDeletes=0").maxDeletes).toBe(DEFAULT_MAX_DELETES);
    expect(parse("maxDeletes=-3").maxDeletes).toBe(DEFAULT_MAX_DELETES);
    expect(parse("maxDeletes=1.5").maxDeletes).toBe(DEFAULT_MAX_DELETES);
    expect(parse("maxDeletes=abc").maxDeletes).toBe(DEFAULT_MAX_DELETES);
  });
});
