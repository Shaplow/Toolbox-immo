import { describe, expect, it } from "vitest";
import { r2KeyFromPublicUrl, resolveSlotFinalVideo, type SlotFinalVideoInput } from "../finalVideo";

const PUBLIC_URL = "https://cdn.toolboximmo.com";
const R2 = { publicUrl: PUBLIC_URL, localStorage: false };
const LOCAL = { publicUrl: null, localStorage: true };

function input(over: Partial<SlotFinalVideoInput> = {}): SlotFinalVideoInput {
  return { captionJobs: [], currentVersion: null, render: null, ...over };
}

const version = (over: Partial<NonNullable<SlotFinalVideoInput["currentVersion"]>> = {}) => ({
  r2Key: "publications/slot1/versions/montage.mp4",
  fileName: "Montage final.mov",
  fileUrl: `${PUBLIC_URL}/publications/slot1/versions/montage.mp4`,
  fileSizeBytes: 123_456,
  deletedAt: null,
  ...over,
});

const render = (over: Partial<NonNullable<SlotFinalVideoInput["render"]>> = {}) => ({
  status: "DONE",
  videoUrl: `${PUBLIC_URL}/renders/slot1/out.mp4`,
  pngUrl: null,
  ...over,
});

describe("r2KeyFromPublicUrl", () => {
  it("extrait la clé d'une URL du bucket", () => {
    expect(r2KeyFromPublicUrl(`${PUBLIC_URL}/a/b/c.mp4`, PUBLIC_URL)).toBe("a/b/c.mp4");
  });

  it("tolère des / de queue sur l'origine", () => {
    expect(r2KeyFromPublicUrl(`${PUBLIC_URL}/a.mp4`, `${PUBLIC_URL}/`)).toBe("a.mp4");
    expect(r2KeyFromPublicUrl(`${PUBLIC_URL}/a.mp4`, `${PUBLIC_URL}///`)).toBe("a.mp4");
  });

  it("retire la query et le fragment", () => {
    expect(r2KeyFromPublicUrl(`${PUBLIC_URL}/a.mp4?v=3`, PUBLIC_URL)).toBe("a.mp4");
    expect(r2KeyFromPublicUrl(`${PUBLIC_URL}/a.mp4#t=10`, PUBLIC_URL)).toBe("a.mp4");
    expect(r2KeyFromPublicUrl(`${PUBLIC_URL}/a.mp4#t=10?x`, PUBLIC_URL)).toBe("a.mp4");
    expect(r2KeyFromPublicUrl(`${PUBLIC_URL}/a.mp4?x=1#y`, PUBLIC_URL)).toBe("a.mp4");
  });

  it("préfixe strict : un domaine qui commence pareil est refusé", () => {
    expect(r2KeyFromPublicUrl("https://cdn.toolboximmo.com.evil.com/a.mp4", PUBLIC_URL)).toBeNull();
    expect(r2KeyFromPublicUrl("https://cdn.toolboximmo.comevil/a.mp4", PUBLIC_URL)).toBeNull();
    expect(r2KeyFromPublicUrl("http://cdn.toolboximmo.com/a.mp4", PUBLIC_URL)).toBeNull();
    expect(r2KeyFromPublicUrl("https://evil.com/https://cdn.toolboximmo.com/a.mp4", PUBLIC_URL)).toBeNull();
  });

  it("respecte un chemin dans l'origine", () => {
    expect(r2KeyFromPublicUrl("https://x.com/bucket/a.mp4", "https://x.com/bucket")).toBe("a.mp4");
    expect(r2KeyFromPublicUrl("https://x.com/autre/a.mp4", "https://x.com/bucket")).toBeNull();
    expect(r2KeyFromPublicUrl("https://x.com/bucketeer/a.mp4", "https://x.com/bucket")).toBeNull();
  });

  it("refuse ce qui n'est pas une URL du bucket", () => {
    expect(r2KeyFromPublicUrl("/uploads/a.mp4", PUBLIC_URL)).toBeNull();
    expect(r2KeyFromPublicUrl(null, PUBLIC_URL)).toBeNull();
    expect(r2KeyFromPublicUrl(undefined, PUBLIC_URL)).toBeNull();
    expect(r2KeyFromPublicUrl("", PUBLIC_URL)).toBeNull();
    expect(r2KeyFromPublicUrl(`${PUBLIC_URL}/a.mp4`, null)).toBeNull();
    expect(r2KeyFromPublicUrl(`${PUBLIC_URL}/a.mp4`, undefined)).toBeNull();
    expect(r2KeyFromPublicUrl(`${PUBLIC_URL}/a.mp4`, "")).toBeNull();
  });

  it("une origine vide ou réduite à des / n'accepte pas n'importe quel chemin absolu", () => {
    expect(r2KeyFromPublicUrl("/uploads/a.mp4", "/")).toBeNull();
    expect(r2KeyFromPublicUrl("/uploads/a.mp4", "///")).toBeNull();
  });

  it("une URL sans clé donne null", () => {
    expect(r2KeyFromPublicUrl(`${PUBLIC_URL}/`, PUBLIC_URL)).toBeNull();
    expect(r2KeyFromPublicUrl(`${PUBLIC_URL}/?v=1`, PUBLIC_URL)).toBeNull();
    expect(r2KeyFromPublicUrl(PUBLIC_URL, PUBLIC_URL)).toBeNull();
  });

  it("reste linéaire sur une origine faite de milliers de /", () => {
    const started = Date.now();
    expect(r2KeyFromPublicUrl("/a.mp4", `${"/".repeat(200_000)}x`)).toBeNull();
    expect(r2KeyFromPublicUrl(`${PUBLIC_URL}/a.mp4`, `${PUBLIC_URL}${"/".repeat(200_000)}`)).toBe("a.mp4");
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("resolveSlotFinalVideo — ordre des sources", () => {
  it("1. sous-titrée : outputKey d'abord", () => {
    expect(
      resolveSlotFinalVideo(
        input({
          captionJobs: [{ outputKey: "captions/out.mp4", outputUrl: `${PUBLIC_URL}/captions/autre.mp4` }],
          currentVersion: version(),
          render: render(),
        }),
        R2,
      ),
    ).toEqual({ ok: true, source: "caption", r2Key: "captions/out.mp4", localUrl: null, fileName: null, sizeBytes: null });
  });

  it("1. sous-titrée : sinon la clé est déduite de outputUrl", () => {
    expect(
      resolveSlotFinalVideo(input({ captionJobs: [{ outputKey: null, outputUrl: `${PUBLIC_URL}/captions/out.mp4?v=2` }] }), R2),
    ).toEqual({ ok: true, source: "caption", r2Key: "captions/out.mp4", localUrl: null, fileName: null, sizeBytes: null });
  });

  it("1. sous-titrée : une clé vide ne compte pas", () => {
    expect(
      resolveSlotFinalVideo(
        input({ captionJobs: [{ outputKey: "", outputUrl: `${PUBLIC_URL}/captions/out.mp4` }] }),
        R2,
      ),
    ).toMatchObject({ ok: true, source: "caption", r2Key: "captions/out.mp4" });
  });

  it("1. sous-titrée : le premier job dont la clé est connue gagne (les plus récents d'abord)", () => {
    const result = resolveSlotFinalVideo(
      input({
        captionJobs: [
          { outputKey: null, outputUrl: null },
          { outputKey: null, outputUrl: "https://ailleurs.example/x.mp4" },
          { outputKey: "captions/deux.mp4", outputUrl: null },
          { outputKey: "captions/un.mp4", outputUrl: null },
        ],
      }),
      R2,
    );
    expect(result).toMatchObject({ ok: true, source: "caption", r2Key: "captions/deux.mp4" });
  });

  it("2. version courante : clé, nom, taille ; pas d'URL locale hors stockage local", () => {
    expect(resolveSlotFinalVideo(input({ currentVersion: version(), render: render() }), R2)).toEqual({
      ok: true,
      source: "version",
      r2Key: "publications/slot1/versions/montage.mp4",
      localUrl: null,
      fileName: "Montage final.mov",
      sizeBytes: 123_456,
    });
  });

  it("2. version courante : en stockage local, l'URL locale est fileUrl", () => {
    const result = resolveSlotFinalVideo(
      input({ currentVersion: version({ fileUrl: "/uploads/publications/slot1/versions/montage.mp4" }) }),
      LOCAL,
    );
    expect(result).toEqual({
      ok: true,
      source: "version",
      r2Key: "publications/slot1/versions/montage.mp4",
      localUrl: "/uploads/publications/slot1/versions/montage.mp4",
      fileName: "Montage final.mov",
      sizeBytes: 123_456,
    });
  });

  it("2. version courante : taille inconnue → null", () => {
    expect(resolveSlotFinalVideo(input({ currentVersion: version({ fileSizeBytes: null }) }), R2)).toMatchObject({
      ok: true,
      sizeBytes: null,
    });
  });

  it("2. version supprimée : ignorée (date ou chaîne)", () => {
    for (const deletedAt of [new Date("2026-09-01T00:00:00Z"), "2026-09-01T00:00:00.000Z"]) {
      expect(resolveSlotFinalVideo(input({ currentVersion: version({ deletedAt }) }), R2)).toEqual({
        ok: false,
        reason: "no_video",
      });
    }
  });

  it("2. version supprimée : on passe au rendu", () => {
    expect(
      resolveSlotFinalVideo(input({ currentVersion: version({ deletedAt: new Date() }), render: render() }), R2),
    ).toMatchObject({ ok: true, source: "render" });
  });

  it("2. version sans clé hors stockage local : « not_on_r2 »", () => {
    expect(resolveSlotFinalVideo(input({ currentVersion: version({ r2Key: "" }) }), R2)).toEqual({
      ok: false,
      reason: "not_on_r2",
    });
  });

  it("3. rendu terminé sur l'origine R2", () => {
    expect(resolveSlotFinalVideo(input({ render: render() }), R2)).toEqual({
      ok: true,
      source: "render",
      r2Key: "renders/slot1/out.mp4",
      localUrl: null,
      fileName: null,
      sizeBytes: null,
    });
  });

  it("3. rendu terminé : query retirée de la clé", () => {
    expect(
      resolveSlotFinalVideo(input({ render: render({ videoUrl: `${PUBLIC_URL}/renders/out.mp4?v=9` }) }), R2),
    ).toMatchObject({ ok: true, r2Key: "renders/out.mp4" });
  });

  it("3. rendu pas encore terminé : ignoré", () => {
    for (const status of ["PENDING", "PROCESSING", "FAILED", "done"]) {
      expect(resolveSlotFinalVideo(input({ render: render({ status }) }), R2), status).toEqual({
        ok: false,
        reason: "no_video",
      });
    }
  });

  it("3. rendu terminé hors R2 : « not_on_r2 »", () => {
    expect(
      resolveSlotFinalVideo(input({ render: render({ videoUrl: "https://cdn.toolboximmo.com.evil.com/out.mp4" }) }), R2),
    ).toEqual({ ok: false, reason: "not_on_r2" });
    expect(resolveSlotFinalVideo(input({ render: render({ videoUrl: "/uploads/out.mp4" }) }), LOCAL)).toEqual({
      ok: false,
      reason: "not_on_r2",
    });
  });
});

describe("resolveSlotFinalVideo — priorités", () => {
  const caption = { outputKey: "captions/out.mp4", outputUrl: null };

  it("sous-titrée > version > rendu", () => {
    const all = input({ captionJobs: [caption], currentVersion: version(), render: render() });
    expect(resolveSlotFinalVideo(all, R2)).toMatchObject({ source: "caption" });
    expect(resolveSlotFinalVideo({ ...all, captionJobs: [] }, R2)).toMatchObject({ source: "version" });
    expect(resolveSlotFinalVideo({ ...all, captionJobs: [], currentVersion: null }, R2)).toMatchObject({ source: "render" });
  });

  it("un job sous-titré hors R2 n'empêche pas la version", () => {
    const result = resolveSlotFinalVideo(
      input({ captionJobs: [{ outputKey: null, outputUrl: "/uploads/captions/out.mp4" }], currentVersion: version() }),
      LOCAL,
    );
    expect(result).toMatchObject({ ok: true, source: "version" });
  });

  it("en stockage local, une sortie sans clé R2 est ignorée au profit de la version", () => {
    const result = resolveSlotFinalVideo(
      input({
        captionJobs: [{ outputKey: null, outputUrl: "/uploads/captions/out.mp4" }],
        currentVersion: version({ fileUrl: "/uploads/v.mp4" }),
      }),
      LOCAL,
    );
    expect(result).toMatchObject({ ok: true, source: "version", localUrl: "/uploads/v.mp4" });
  });
});

describe("resolveSlotFinalVideo — raisons d'échec", () => {
  it("rien du tout → « no_video »", () => {
    expect(resolveSlotFinalVideo(input(), R2)).toEqual({ ok: false, reason: "no_video" });
    expect(resolveSlotFinalVideo(input({ captionJobs: [{ outputKey: null, outputUrl: null }] }), R2)).toEqual({
      ok: false,
      reason: "no_video",
    });
    expect(resolveSlotFinalVideo(input({ render: render({ videoUrl: null }) }), R2)).toEqual({
      ok: false,
      reason: "no_video",
    });
  });

  it("image seule (png sans vidéo) → « image_post »", () => {
    expect(
      resolveSlotFinalVideo(
        input({ render: { status: "DONE", videoUrl: null, pngUrl: `${PUBLIC_URL}/renders/out.png` } }),
        R2,
      ),
    ).toEqual({ ok: false, reason: "image_post" });
  });

  it("une vignette png à côté d'une vidéo n'en fait pas une image", () => {
    expect(
      resolveSlotFinalVideo(input({ render: render({ pngUrl: `${PUBLIC_URL}/renders/out.png` }) }), R2),
    ).toMatchObject({ ok: true, source: "render" });
    expect(
      resolveSlotFinalVideo(
        input({ render: render({ videoUrl: "https://ailleurs.example/out.mp4", pngUrl: "https://ailleurs.example/out.png" }) }),
        R2,
      ),
    ).toEqual({ ok: false, reason: "not_on_r2" });
  });

  it("vidéo sous-titrée hors R2 → « not_on_r2 »", () => {
    expect(
      resolveSlotFinalVideo(
        input({ captionJobs: [{ outputKey: null, outputUrl: "https://ailleurs.example/out.mp4" }] }),
        R2,
      ),
    ).toEqual({ ok: false, reason: "not_on_r2" });
  });

  it("une version supprimée ne compte pas comme « une vidéo existait »", () => {
    expect(
      resolveSlotFinalVideo(input({ currentVersion: version({ r2Key: "", deletedAt: new Date() }) }), R2),
    ).toEqual({ ok: false, reason: "no_video" });
  });

  it("sans publicUrl (R2 non configuré), toute URL est hors R2", () => {
    expect(
      resolveSlotFinalVideo(input({ render: render() }), { publicUrl: null, localStorage: false }),
    ).toEqual({ ok: false, reason: "not_on_r2" });
  });

  it("un job sous-titré ne masque pas un job plus ancien exportable", () => {
    const result = resolveSlotFinalVideo(
      input({
        captionJobs: [
          { outputKey: null, outputUrl: "https://ailleurs.example/recent.mp4" },
          { outputKey: "captions/ancien.mp4", outputUrl: null },
        ],
      }),
      R2,
    );
    expect(result).toMatchObject({ ok: true, source: "caption", r2Key: "captions/ancien.mp4" });
  });
});
