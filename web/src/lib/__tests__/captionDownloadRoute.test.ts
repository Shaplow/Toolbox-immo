/**
 * GET /api/render/captions/[id]/download — le téléchargement enregistre l'activité.
 *
 * La purge à 60 jours (lib/captions/outputRetention.ts) ne voit que les accès passés
 * par cette route. Quatre invariants :
 * - l'accès est posé par un seul UPDATE gardé (`outputExpiredAt: null`) AVANT toute
 *   URL : si la purge a réclamé la ligne entre-temps, 410 et rien n'est servi ;
 * - seul le propriétaire (ou un admin) obtient le fichier ;
 * - une ancienne ligne sans `outputKey` est servie par la clé de son URL du CDN, et
 *   jamais par une URL d'une autre origine ;
 * - en stockage local, la redirection ne sort jamais du proxy /api/captions/.
 */

import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAPTION_RETENTION_COPY } from "@/lib/captions/outputRetention";
import { attachmentDisposition } from "@/lib/transcription/batches";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  r2Configured: vi.fn(),
  presign: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { captionJob: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } },
}));
vi.mock("@/lib/api/requireAuth", () => ({ requireUser: mocks.requireUser }));
// Le vrai module reste disponible pour le test du présigneur (importActual) ; la
// route, elle, ne voit que ces deux doublures.
vi.mock("@/lib/r2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/r2")>()),
  r2Configured: mocks.r2Configured,
  createPresignedDownloadUrl: mocks.presign,
}));
// Route de statut, testée plus bas pour le champ `expired`.
vi.mock("@/lib/runpod", () => ({
  resolveRunpodJobPhase: vi.fn(),
  runpodConfigured: () => false,
  isPodJobId: () => false,
}));
vi.mock("@/lib/services/slot/pipelineHooks", () => ({ onCaptionsCompleted: vi.fn() }));

import { GET } from "@/app/api/render/captions/[id]/download/route";
import { GET as getStatus } from "@/app/api/render/captions/[id]/route";

const OUTPUT_KEY = "outputs/captions/u1/1784555832902/full.mp4";
const PREVIEW_KEY = "outputs/captions/u1/1784555832902/preview.mp4";
const PRESIGNED =
  "https://acct.r2.cloudflarestorage.com/bucket/outputs/captions/u1/1784555832902/full.mp4?X-Amz-Signature=abc";
const LOCAL_URL = "/api/captions/outputs/captions/u1/1784555832902/full.mp4";

function job(overrides: Record<string, unknown> = {}) {
  return {
    userId: "u1",
    status: "COMPLETED",
    inputUrl: "Visite été.mp4",
    outputKey: OUTPUT_KEY,
    outputUrl: `https://cdn.toolboximmo.com/${OUTPUT_KEY}`,
    outputExpiredAt: null,
    ...overrides,
  };
}

function download() {
  return GET(new NextRequest("http://localhost/api/render/captions/j1/download"), {
    params: Promise.resolve({ id: "j1" }),
  });
}

/** Les cinq variables dont `requireR2()` a besoin pour signer sans réseau. */
function stubR2Env() {
  vi.stubEnv("R2_ACCOUNT_ID", "acct");
  vi.stubEnv("R2_ACCESS_KEY_ID", "AKIDEXAMPLE");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
  vi.stubEnv("R2_BUCKET", "bucket");
  vi.stubEnv("R2_PUBLIC_URL", "https://cdn.toolboximmo.com");
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue({ ctx: { effectiveUser: { id: "u1" }, canAdminBypass: false } });
  mocks.findUnique.mockResolvedValue(job());
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.r2Configured.mockReturnValue(true);
  mocks.presign.mockResolvedValue(PRESIGNED);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("accès à la route", () => {
  it("401 sans session : rien n'est lu", async () => {
    mocks.requireUser.mockResolvedValueOnce({
      response: NextResponse.json({ error: "Non autorisé" }, { status: 401 }),
    });

    const res = await download();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Non autorisé" });
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("404 pour un job inconnu", async () => {
    mocks.findUnique.mockResolvedValueOnce(null);

    const res = await download();

    expect(res.status).toBe(404);
    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "j1" } }));
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("403 pour le job d'un autre : aucune activité posée, aucune URL émise", async () => {
    mocks.findUnique.mockResolvedValueOnce(job({ userId: "u2" }));

    const res = await download();

    expect(res.status).toBe(403);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.presign).not.toHaveBeenCalled();
  });

  it("un admin télécharge le job d'un autre, et son accès compte comme activité", async () => {
    mocks.requireUser.mockResolvedValueOnce({ ctx: { effectiveUser: { id: "admin1" }, canAdminBypass: true } });
    mocks.findUnique.mockResolvedValueOnce(job({ userId: "u2" }));

    const res = await download();

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(PRESIGNED);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
  });

  it.each(["QUEUED", "PROCESSING", "FAILED"])("409 tant que le job est %s", async (status) => {
    mocks.findUnique.mockResolvedValueOnce(job({ status }));

    const res = await download();

    expect(res.status).toBe(409);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.presign).not.toHaveBeenCalled();
  });
});

describe("vidéo expirée", () => {
  const expiredBody = { error: CAPTION_RETENTION_COPY.expiredError, expired: true };

  it.each([
    // Suppression R2 encore en attente : la clé est là, le fichier ne doit pas être servi.
    ["suppression R2 en attente", { outputKey: OUTPUT_KEY }],
    ["suppression terminée", { outputKey: null, outputUrl: null }],
  ])("410 quand la purge a réclamé la ligne (%s)", async (_label, overrides) => {
    mocks.findUnique.mockResolvedValueOnce(job({ outputExpiredAt: new Date("2026-10-07T00:00:00Z"), ...overrides }));

    const res = await download();

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual(expiredBody);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.presign).not.toHaveBeenCalled();
  });

  it("410 quand la purge passe entre la lecture et l'enregistrement de l'accès", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await download();

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual(expiredBody);
    expect(mocks.presign).not.toHaveBeenCalled();
  });
});

describe("enregistrement de l'activité", () => {
  it("pose lastAccessedAt par un UPDATE gardé sur le statut et l'expiration", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T10:00:00Z"));

    await download();

    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "j1", status: "COMPLETED", outputExpiredAt: null },
      data: { lastAccessedAt: new Date("2026-10-07T10:00:00Z") },
    });
  });

  it("enregistre l'accès avant d'émettre l'URL", async () => {
    await download();

    const [bumpOrder] = mocks.updateMany.mock.invocationCallOrder;
    const [presignOrder] = mocks.presign.mock.invocationCallOrder;
    expect(bumpOrder).toBeLessThan(presignOrder);
  });
});

describe("redirection vers R2", () => {
  it("302 vers l'URL pré-signée, jamais en cache, avec le nom accentué encodé", async () => {
    const res = await download();

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(PRESIGNED);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.presign).toHaveBeenCalledWith(
      OUTPUT_KEY,
      "Visite été - sous-titres.mp4",
      900,
      `attachment; filename="Visite ete - sous-titres.mp4"; filename*=UTF-8''Visite%20%C3%A9t%C3%A9%20-%20sous-titres.mp4`,
    );
  });

  it("nomme l'aperçu 6 s « - aperçu.mp4 »", async () => {
    mocks.findUnique.mockResolvedValueOnce(job({ outputKey: PREVIEW_KEY }));

    await download();

    expect(mocks.presign).toHaveBeenCalledWith(
      PREVIEW_KEY,
      "Visite été - aperçu.mp4",
      900,
      expect.stringContaining("filename*=UTF-8''Visite%20%C3%A9t%C3%A9%20-%20aper%C3%A7u.mp4"),
    );
  });

  it.each([
    ["un nom de fichier brut, « + » compris", "SELLOUM NATACHA RVA2 + captions.mp4", "SELLOUM NATACHA RVA2 + captions - sous-titres.mp4"],
    [
      "une URL : dernier segment, query (et ses « / ») ignorée",
      "https://cdn.toolboximmo.com/inputs/captions/u1/17/video.mp4?X-Amz-Credential=a/b/c&X-Amz-Signature=z",
      "video - sous-titres.mp4",
    ],
    ["un nom brut avec « ? », conservé (nettoyé en « _ »)", "Visite ? finale.mp4", "Visite _ finale - sous-titres.mp4"],
    ["une URL sans nom de fichier", "https://cdn.toolboximmo.com/", "video - sous-titres.mp4"],
    ["une source vide", "", "video - sous-titres.mp4"],
    ["aucune source", null, "video - sous-titres.mp4"],
  ])("nom proposé pour %s", async (_label, inputUrl, expected) => {
    mocks.findUnique.mockResolvedValueOnce(job({ inputUrl }));

    await download();

    expect(mocks.presign).toHaveBeenCalledWith(OUTPUT_KEY, expected, 900, attachmentDisposition(expected));
  });

  it("l'URL réellement signée porte le Content-Disposition passé en 4e paramètre", async () => {
    stubR2Env();
    const real = await vi.importActual<typeof import("@/lib/r2")>("@/lib/r2");
    mocks.presign.mockImplementationOnce(real.createPresignedDownloadUrl);

    const res = await download();

    const signed = new URL(res.headers.get("location") ?? "");
    expect(signed.pathname).toContain(OUTPUT_KEY);
    expect(signed.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(signed.searchParams.get("response-content-disposition")).toBe(
      attachmentDisposition("Visite été - sous-titres.mp4"),
    );
  });

  it("createPresignedDownloadUrl garde son en-tête ASCII sans 4e paramètre", async () => {
    stubR2Env();
    const real = await vi.importActual<typeof import("@/lib/r2")>("@/lib/r2");

    const signed = new URL(await real.createPresignedDownloadUrl("a/b.mp4", 'vi"site.mp4', 60));

    expect(signed.searchParams.get("response-content-disposition")).toBe('attachment; filename="vi_site.mp4"');
    expect(signed.searchParams.get("X-Amz-Expires")).toBe("60");
  });
});

describe("ligne sans outputKey : clé tirée de l'URL du CDN", () => {
  const CDN = "https://cdn.toolboximmo.com";

  beforeEach(() => {
    // `isR2PublicUrl` n'est pas doublé : il compare l'URL à R2_PUBLIC_URL.
    vi.stubEnv("R2_PUBLIC_URL", CDN);
  });

  it("sert la clé de l'URL publique comme un outputKey : pré-signée, accès enregistré avant", async () => {
    mocks.findUnique.mockResolvedValueOnce(job({ outputKey: null, outputUrl: `${CDN}/${OUTPUT_KEY}` }));

    const res = await download();

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(PRESIGNED);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.presign).toHaveBeenCalledWith(
      OUTPUT_KEY,
      "Visite été - sous-titres.mp4",
      900,
      attachmentDisposition("Visite été - sous-titres.mp4"),
    );
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    const [bumpOrder] = mocks.updateMany.mock.invocationCallOrder;
    const [presignOrder] = mocks.presign.mock.invocationCallOrder;
    expect(bumpOrder).toBeLessThan(presignOrder);
  });

  it.each([
    ["la query", `${CDN}/${OUTPUT_KEY}?X-Amz-Signature=abc&v=2`],
    ["le fragment", `${CDN}/${OUTPUT_KEY}#t=10`],
  ])("la clé signée ne reprend pas %s de l'URL", async (_label, outputUrl) => {
    mocks.findUnique.mockResolvedValueOnce(job({ outputKey: null, outputUrl }));

    await download();

    expect(mocks.presign).toHaveBeenCalledWith(OUTPUT_KEY, expect.any(String), 900, expect.any(String));
  });

  it("nomme l'aperçu d'après la clé tirée de l'URL", async () => {
    mocks.findUnique.mockResolvedValueOnce(job({ outputKey: null, outputUrl: `${CDN}/${PREVIEW_KEY}` }));

    await download();

    expect(mocks.presign).toHaveBeenCalledWith(
      PREVIEW_KEY,
      "Visite été - aperçu.mp4",
      900,
      expect.stringContaining("aper%C3%A7u.mp4"),
    );
  });

  it("outputKey prime sur l'URL quand les deux existent", async () => {
    mocks.findUnique.mockResolvedValueOnce(job({ outputKey: PREVIEW_KEY, outputUrl: `${CDN}/${OUTPUT_KEY}` }));

    await download();

    expect(mocks.presign).toHaveBeenCalledWith(PREVIEW_KEY, expect.any(String), 900, expect.any(String));
  });

  it.each([
    ["une URL absolue hors de R2", "https://evil.example/outputs/captions/u1/1/full.mp4"],
    ["une origine qui ressemble à celle du CDN", `${CDN}.evil.example/outputs/captions/u1/1/full.mp4`],
    ["l'origine du CDN en http", "http://cdn.toolboximmo.com/outputs/captions/u1/1/full.mp4"],
    ["une URL protocole-relative", "//cdn.toolboximmo.com/outputs/captions/u1/1/full.mp4"],
    ["l'origine du CDN sans clé", `${CDN}/`],
  ])("404 sans rien enregistrer ni signer pour %s", async (_label, outputUrl) => {
    mocks.findUnique.mockResolvedValueOnce(job({ outputKey: null, outputUrl }));

    const res = await download();

    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.presign).not.toHaveBeenCalled();
  });

  it("R2 non configuré : 404, l'URL du CDN n'est ni signée ni suivie", async () => {
    mocks.r2Configured.mockReturnValue(false);
    mocks.findUnique.mockResolvedValueOnce(job({ outputKey: null, outputUrl: `${CDN}/${OUTPUT_KEY}` }));

    const res = await download();

    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.presign).not.toHaveBeenCalled();
  });
});

describe("stockage local", () => {
  it("302 vers le proxy /api/captions/, de même origine et jamais en cache", async () => {
    mocks.findUnique.mockResolvedValueOnce(job({ outputKey: null, outputUrl: LOCAL_URL }));

    const res = await download();

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`http://localhost${LOCAL_URL}`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.presign).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
  });

  it("R2 non configuré : retombe sur le proxy local même si une clé est renseignée", async () => {
    mocks.r2Configured.mockReturnValue(false);
    mocks.findUnique.mockResolvedValueOnce(job({ outputUrl: LOCAL_URL }));

    const res = await download();

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`http://localhost${LOCAL_URL}`);
    expect(mocks.presign).not.toHaveBeenCalled();
  });

  it.each([
    ["une URL absolue", "https://evil.example/x.mp4"],
    ["une URL protocole-relative", "//evil.example/x.mp4"],
    ["un chemin hors du proxy", "/outputs/captions/u1/1/full.mp4"],
    ["un chemin sans barre initiale", "api/captions/outputs/x.mp4"],
    ["aucune URL", null],
  ])("404 sans rien enregistrer pour %s", async (_label, outputUrl) => {
    mocks.findUnique.mockResolvedValueOnce(job({ outputKey: null, outputUrl }));

    const res = await download();

    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
    // Une requête qui ne sert rien n'est pas une activité.
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.presign).not.toHaveBeenCalled();
  });

  it("R2 non configuré et URL publique du CDN : 404, pas de redirection hors de l'app", async () => {
    mocks.r2Configured.mockReturnValue(false);

    const res = await download();

    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/render/captions/[id] : job terminé", () => {
  function status() {
    return getStatus(new NextRequest("http://localhost/api/render/captions/j1"), {
      params: Promise.resolve({ id: "j1" }),
    });
  }

  it("signale la vidéo expirée pour que le client n'affiche pas un lecteur sans source", async () => {
    mocks.findUnique.mockResolvedValueOnce({
      ...job({ outputExpiredAt: new Date("2026-10-07T00:00:00Z"), outputKey: null, outputUrl: null }),
      srtContent: "1\n00:00:00,000 --> 00:00:01,000\nBonjour",
      presetId: "p1",
    });

    const body = await (await status()).json();

    expect(body).toEqual({
      status: "COMPLETED",
      videoUrl: null,
      srtContent: "1\n00:00:00,000 --> 00:00:01,000\nBonjour",
      presetId: "p1",
      expired: true,
    });
  });

  it("expired vaut false tant que la vidéo existe", async () => {
    mocks.findUnique.mockResolvedValueOnce({ ...job(), srtContent: null, presetId: null });

    const body = await (await status()).json();

    expect(body.expired).toBe(false);
    expect(body.videoUrl).toBe(`https://cdn.toolboximmo.com/${OUTPUT_KEY}`);
  });
});
