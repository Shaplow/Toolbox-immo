import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { ReferencedKeyRows } from "@/lib/r2Cleanup";

// ── Mocks ─────────────────────────────────────────────────────────────────────
// État partagé avec les factories vi.mock (hoistées au-dessus des imports) : un
// faux bucket R2 en mémoire et les lignes DB qui référencent des clés.
type FakeObject = { Key: string; LastModified: Date; Size: number };

const state = vi.hoisted(() => ({
  objects: [] as FakeObject[],
  /** Taille de page de ListObjectsV2 (le vrai en rend 1000). */
  pageSize: 1000,
  /** Clés pour lesquelles DeleteObject échoue. */
  failingDeletes: new Set<string>(),
  /** Clés réellement envoyées à DeleteObject, dans l'ordre. */
  deletes: [] as string[],
  rows: {
    rushes: [],
    versions: [],
    attachments: [],
    mediaAssets: [],
    covers: [],
    transcriptions: [],
    captions: [],
  } as ReferencedKeyRows,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    publicationRush: { findMany: async () => state.rows.rushes },
    publicationVersion: { findMany: async () => state.rows.versions },
    publicationBriefAttachment: { findMany: async () => state.rows.attachments },
    mediaAsset: { findMany: async () => state.rows.mediaAssets },
    coverFramePack: { findMany: async () => state.rows.covers },
    transcriptionJob: { findMany: async () => state.rows.transcriptions },
    captionJob: { findMany: async () => state.rows.captions },
  },
}));

vi.mock("@aws-sdk/client-s3", () => {
  class ListObjectsV2Command {
    constructor(public input: { Prefix?: string; ContinuationToken?: string }) {}
  }
  class DeleteObjectCommand {
    constructor(public input: { Key: string }) {}
  }
  class S3Client {
    async send(command: unknown) {
      if (command instanceof ListObjectsV2Command) {
        const { Prefix = "", ContinuationToken } = command.input;
        // Ordre lexicographique, comme S3 ; le jeton de continuation est un offset.
        const matching = state.objects
          .filter((o) => o.Key.startsWith(Prefix))
          .sort((a, b) => (a.Key < b.Key ? -1 : a.Key > b.Key ? 1 : 0));
        const start = ContinuationToken ? Number(ContinuationToken) : 0;
        const page = matching.slice(start, start + state.pageSize);
        const next = start + page.length;
        const truncated = next < matching.length;
        return {
          Contents: page,
          IsTruncated: truncated,
          NextContinuationToken: truncated ? String(next) : undefined,
        };
      }
      if (command instanceof DeleteObjectCommand) {
        if (state.failingDeletes.has(command.input.Key)) throw new Error("AccessDenied");
        state.deletes.push(command.input.Key);
        return {};
      }
      throw new Error("commande S3 inattendue dans ce test");
    }
  }
  return { S3Client, ListObjectsV2Command, DeleteObjectCommand };
});

import {
  cleanupOrphanR2Objects,
  collectReferencedKeys,
  keyClass,
  keyFromPublicUrl,
  parseCleanupParams,
  posterKeyForAsset,
  DEFAULT_MAX_DELETES,
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

describe("keyClass", () => {
  it("publications : un sous-dossier du slot par classe, tous slots confondus", () => {
    const cls = (key: string) => keyClass(key, "publications/");
    expect(cls("publications/s1/rushes/a.mp4")).toBe("publications/*/rushes/");
    expect(cls("publications/s2/rushes/b.mp4")).toBe("publications/*/rushes/");
    expect(cls("publications/s1/versions/v0-x.mp4")).toBe("publications/*/versions/");
    expect(cls("publications/s1/brief/b.pdf")).toBe("publications/*/brief/");
    expect(cls("publications/s1/cover-monteur/1.jpg")).toBe("publications/*/cover-monteur/");
    expect(cls("publications/s1/rushes/sous/dossier/a.mp4")).toBe("publications/*/rushes/");
  });

  it("publications : un fichier posé directement sous le slot a sa propre classe", () => {
    expect(keyClass("publications/s1/residu.bin", "publications/")).toBe("publications/*/");
  });

  it("content-library : audio, posters et videos sont des classes distinctes", () => {
    const cls = (key: string) => keyClass(key, "content-library/");
    expect(cls("content-library/audio/a.mp3")).toBe("content-library/audio/");
    expect(cls("content-library/posters/a1.jpg")).toBe("content-library/posters/");
    expect(cls("content-library/videos/a1.mov")).toBe("content-library/videos/");
    expect(cls("content-library/residu.bin")).toBe("content-library/");
  });

  it("transcription/ et inputs/captions/ sont rapportés tels quels", () => {
    expect(keyClass("transcription/u/1/segments.json", "transcription/")).toBe("transcription/");
    expect(keyClass("inputs/captions/u/1/video.mp4", "inputs/captions/")).toBe("inputs/captions/");
  });
});

describe("cleanupOrphanR2Objects", () => {
  const HOUR = 3_600_000;

  /** Dépose un objet dans le faux bucket : ancien de 48 h, ou de 1 h si `recent`. */
  function put(key: string, opts: { size?: number; recent?: boolean } = {}) {
    state.objects.push({
      Key: key,
      LastModified: new Date(Date.now() - (opts.recent ? 1 : 48) * HOUR),
      Size: opts.size ?? 100,
    });
  }

  beforeEach(() => {
    state.objects = [];
    state.pageSize = 1000;
    state.failingDeletes = new Set();
    state.deletes = [];
    state.rows = emptyRows();
    vi.stubEnv("R2_ACCOUNT_ID", "acc");
    vi.stubEnv("R2_ACCESS_KEY_ID", "key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
    vi.stubEnv("R2_BUCKET", "bucket");
    vi.stubEnv("R2_PUBLIC_URL", PUBLIC_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("refuse un passage réel au-delà de maxDeletes : rien n'est supprimé", async () => {
    for (const name of ["a", "b", "c"]) put(`publications/s1/rushes/${name}.mp4`);

    const result = await cleanupOrphanR2Objects({ dryRun: false, maxDeletes: 2 });

    expect(result.orphans).toBe(3);
    expect(result.deleted).toBe(0);
    expect(result.dryRun).toBe(false);
    expect(result.refused).toEqual({ reason: "too_many_orphans", maxDeletes: 2 });
    expect(state.deletes).toEqual([]);
  });

  it("supprime les orphelins tant que leur nombre ne dépasse pas maxDeletes (pile inclus)", async () => {
    for (const name of ["a", "b", "c"]) put(`publications/s1/rushes/${name}.mp4`);

    const result = await cleanupOrphanR2Objects({ dryRun: false, maxDeletes: 3 });

    expect(result).toMatchObject({ orphans: 3, deleted: 3, dryRun: false, refused: null });
    expect([...state.deletes].sort()).toEqual([
      "publications/s1/rushes/a.mp4",
      "publications/s1/rushes/b.mp4",
      "publications/s1/rushes/c.mp4",
    ]);
  });

  it("une suppression en échec n'arrête pas les suivantes et n'est pas comptée", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const name of ["a", "b", "c"]) put(`publications/s1/rushes/${name}.mp4`);
    state.failingDeletes.add("publications/s1/rushes/b.mp4");

    const result = await cleanupOrphanR2Objects({ dryRun: false, maxDeletes: 10 });

    expect(result.orphans).toBe(3);
    expect(result.deleted).toBe(2);
    expect(state.deletes).toEqual(["publications/s1/rushes/a.mp4", "publications/s1/rushes/c.mp4"]);
  });

  it("ne supprime rien en dry-run, et la fonction est un dry-run sans option", async () => {
    for (const name of ["a", "b", "c"]) put(`publications/s1/rushes/${name}.mp4`);

    // Plus d'orphelins que maxDeletes : le disjoncteur ne concerne que les passages réels.
    const explicit = await cleanupOrphanR2Objects({ dryRun: true, maxDeletes: 1 });
    expect(explicit).toMatchObject({ orphans: 3, deleted: 0, dryRun: true, refused: null });

    const implicit = await cleanupOrphanR2Objects();
    expect(implicit).toMatchObject({ orphans: 3, deleted: 0, dryRun: true });

    expect(state.deletes).toEqual([]);
  });

  it("plafonne les échantillons à 20 par classe sans rien perdre du décompte", async () => {
    const sizes = Array.from({ length: 25 }, (_, i) => 1000 + i);
    sizes.forEach((size, i) => {
      put(`publications/s1/rushes/r${String(i).padStart(2, "0")}.mp4`, { size });
    });
    // Trois pages : la pagination doit être parcourue jusqu'au bout.
    state.pageSize = 10;

    const result = await cleanupOrphanR2Objects({ dryRun: true });

    expect(result.scanned).toBe(25);
    expect(result.orphans).toBe(25);
    const report = result.byClass["publications/*/rushes/"];
    expect(report.orphans).toBe(25);
    expect(report.bytes).toBe(sizes.reduce((sum, size) => sum + size, 0));
    expect(report.samples).toHaveLength(20);
    expect(report.samples[0]).toBe("publications/s1/rushes/r00.mp4");
    expect(report.samples[19]).toBe("publications/s1/rushes/r19.mp4");
  });

  it("ventile par classe de clé : une classe fournie ne cache pas ses voisines", async () => {
    // 25 sons orphelins passent en premier dans l'ordre lexicographique : avec un
    // échantillon par préfixe scanné, ils masquaient les vignettes et les vidéos.
    for (let i = 0; i < 25; i++) put(`content-library/audio/a${String(i).padStart(2, "0")}.mp3`);
    for (let i = 0; i < 3; i++) put(`content-library/posters/p${i}.jpg`);
    put("content-library/videos/v.mp4");
    put("publications/s1/rushes/r.mp4");
    put("publications/s2/versions/v0-x.mp4");
    put("publications/s2/brief/b.pdf");
    put("publications/s3/cover-monteur/c.jpg");
    put("transcription/u/1/in.mp4");
    put("inputs/captions/u/1/video.mp4");

    const result = await cleanupOrphanR2Objects({ dryRun: true });

    expect(Object.keys(result.byClass).sort()).toEqual([
      "content-library/audio/",
      "content-library/posters/",
      "content-library/videos/",
      "inputs/captions/",
      "publications/*/brief/",
      "publications/*/cover-monteur/",
      "publications/*/rushes/",
      "publications/*/versions/",
      "transcription/",
    ]);
    expect(result.byClass["content-library/audio/"].samples).toHaveLength(20);
    expect(result.byClass["content-library/posters/"]).toEqual({
      orphans: 3,
      bytes: 300,
      samples: [
        "content-library/posters/p0.jpg",
        "content-library/posters/p1.jpg",
        "content-library/posters/p2.jpg",
      ],
    });
    // Chaque orphelin est dans exactement une classe.
    const total = Object.values(result.byClass).reduce((n, report) => n + report.orphans, 0);
    expect(total).toBe(result.orphans);
    expect(result.orphans).toBe(25 + 3 + 1 + 4 + 2);
  });

  it("ne compte jamais un objet récent ou référencé en DB, vignettes comprises", async () => {
    state.rows.mediaAssets = [
      { id: "a1", r2Key: "content-library/videos/a1.mp4", posterUrl: null },
      {
        id: "a2",
        r2Key: "content-library/videos/a2.mp4",
        posterUrl: `${PUBLIC_URL}/content-library/posters/a2-custom.webp?v=2`,
      },
    ];
    state.rows.rushes = [{ r2Key: "publications/s1/rushes/known.mp4" }];
    state.rows.covers = [{ finalCoverKey: "publications/s1/cover-monteur/c.jpg" }];
    state.rows.transcriptions = [{ inputKey: null, outputJsonKey: "transcription/u/1/segments.json" }];
    state.rows.captions = [{ inputKey: "inputs/captions/u/1/video.mp4", outputKey: null }];

    // Anciens mais référencés.
    put("content-library/videos/a1.mp4");
    put("content-library/posters/a1.jpg"); // vignette par convention (id de l'asset)
    put("content-library/videos/a2.mp4");
    put("content-library/posters/a2-custom.webp"); // vignette lue dans posterUrl
    put("publications/s1/rushes/known.mp4");
    put("publications/s1/cover-monteur/c.jpg");
    put("transcription/u/1/segments.json");
    put("inputs/captions/u/1/video.mp4");
    // Non référencés mais trop récents : pas encore candidats (upload en cours).
    put("publications/s9/rushes/just-uploaded.mp4", { recent: true });
    put("transcription/u/2/in.mp4", { recent: true });
    // Le seul vrai orphelin.
    put("publications/s9/versions/v0-zombie.mp4", { size: 42 });

    const result = await cleanupOrphanR2Objects({ dryRun: false, maxDeletes: 10 });

    expect(result.scanned).toBe(11);
    expect(result.orphans).toBe(1);
    expect(result.byClass).toEqual({
      "publications/*/versions/": {
        orphans: 1,
        bytes: 42,
        samples: ["publications/s9/versions/v0-zombie.mp4"],
      },
    });
    expect(state.deletes).toEqual(["publications/s9/versions/v0-zombie.mp4"]);
  });
});
