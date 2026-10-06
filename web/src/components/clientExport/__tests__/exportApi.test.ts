import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinkGoneError } from "@/lib/clientExport/downloadEngine";
import type { ExportEventRequest, ExportManifest } from "@/lib/clientExport/types";
import { ExportApiError, RETRY_DELAYS_MS, fetchManifest, isAbortError, postEvent, signUrls } from "../exportApi";

const TOKEN = "a".repeat(64);

const MANIFEST: ExportManifest = {
  linkId: "link_1",
  clientName: "Agence Dupont",
  rootName: "Agence Dupont",
  expiresAt: "2026-10-13T12:00:00.000Z",
  files: [{ ref: "m.a.b", kind: "media", path: ["Agence Dupont", "Sarah", "a.mov"], size: 10 }],
  skipped: [],
  totals: { files: 1, bytes: 10, accounts: 1 },
};

const EVENT: ExportEventRequest = { type: "started", files: 0, bytes: 0, skipped: 0, failed: 0, missing: 0 };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

/** Rattache tout de suite un handler : un rejet survenu pendant l'avance du temps ne doit pas rester « non géré ». */
function settle<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn<typeof fetch>();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchManifest", () => {
  it("lit le manifeste de /api/export/<jeton>/manifest sans cache", async () => {
    fetchMock.mockResolvedValueOnce(json(MANIFEST));

    const manifest = await fetchManifest(TOKEN, { fetchImpl: fetchMock });

    expect(manifest).toEqual(MANIFEST);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/export/${TOKEN}/manifest`);
    expect(init).toMatchObject({ method: "GET", cache: "no-store" });
  });

  it("complète `skipped` quand la réponse l'omet", async () => {
    const { skipped: _skipped, ...withoutSkipped } = MANIFEST;
    void _skipped;
    fetchMock.mockResolvedValueOnce(json(withoutSkipped));

    const manifest = await fetchManifest(TOKEN, { fetchImpl: fetchMock });

    expect(manifest.skipped).toEqual([]);
  });

  it("jette LinkGoneError sur une 404, sans réessayer", async () => {
    fetchMock.mockResolvedValue(json({ error: "Lien invalide ou expiré" }, 404));
    const onRetry = vi.fn();

    const outcome = await settle(fetchManifest(TOKEN, { fetchImpl: fetchMock, onRetry }));

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).toBeInstanceOf(LinkGoneError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("traite une 410 comme un lien disparu", async () => {
    fetchMock.mockResolvedValue(json({}, 410));

    const outcome = await settle(fetchManifest(TOKEN, { fetchImpl: fetchMock }));

    expect(!outcome.ok && outcome.error).toBeInstanceOf(LinkGoneError);
  });

  it("réessaie après un 5xx avec le premier délai du backoff", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "boom" }, 503)).mockResolvedValueOnce(json(MANIFEST));
    const onRetry = vi.fn();

    const pending = settle(fetchManifest(TOKEN, { fetchImpl: fetchMock, onRetry }));
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await pending;

    expect(outcome).toEqual({ ok: true, value: MANIFEST });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ attempt: 1, delayMs: RETRY_DELAYS_MS[0] });
  });

  it("réessaie après une erreur réseau", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(json(MANIFEST));

    const pending = settle(fetchManifest(TOKEN, { fetchImpl: fetchMock }));
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    const outcome = await pending;

    expect(outcome).toEqual({ ok: true, value: MANIFEST });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("abandonne après tout le backoff (≈ 1 min) avec le message du serveur", async () => {
    fetchMock.mockImplementation(async () => json({ error: "Impossible de préparer la liste." }, 500));

    const pending = settle(fetchManifest(TOKEN, { fetchImpl: fetchMock }));
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0));
    const outcome = await pending;

    expect(outcome.ok).toBe(false);
    const error = !outcome.ok ? outcome.error : null;
    expect(error).toBeInstanceOf(ExportApiError);
    expect((error as ExportApiError).message).toBe("Impossible de préparer la liste.");
    expect((error as ExportApiError).status).toBe(500);
    // 1 essai + un par attente du backoff.
    expect(fetchMock).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1);
  });

  it("couvre au moins une minute d'indisponibilité (un déploiement)", () => {
    expect(RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(60_000);
  });

  it("respecte Retry-After d'un 429 quand il dépasse le backoff", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ error: "Trop de requêtes" }, 429, { "Retry-After": "60" }))
      .mockResolvedValueOnce(json(MANIFEST));
    const onRetry = vi.fn();

    const pending = settle(fetchManifest(TOKEN, { fetchImpl: fetchMock, onRetry }));
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    const outcome = await pending;

    expect(outcome.ok).toBe(true);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ delayMs: 60_000 });
  });

  it("plafonne un Retry-After démesuré", async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 429, { "Retry-After": "86400" }))
      .mockResolvedValueOnce(json(MANIFEST));
    const onRetry = vi.fn();

    const pending = settle(fetchManifest(TOKEN, { fetchImpl: fetchMock, onRetry }));
    await vi.advanceTimersByTimeAsync(90_000);
    const outcome = await pending;

    expect(outcome.ok).toBe(true);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ delayMs: 90_000 });
  });

  it("ne réessaie pas une erreur 4xx autre que 404 / 408 / 429", async () => {
    fetchMock.mockResolvedValue(json({ error: "Requête invalide" }, 400));

    const outcome = await settle(fetchManifest(TOKEN, { fetchImpl: fetchMock }));

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).toMatchObject({ name: "ExportApiError", status: 400, message: "Requête invalide" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ne réessaie pas une réponse qui n'est pas du JSON (redirection, page HTML)", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Connexion</html>", { status: 200 }));

    const outcome = await settle(fetchManifest(TOKEN, { fetchImpl: fetchMock }));

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).toMatchObject({ name: "ExportApiError", message: "Réponse inattendue du serveur." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuse un manifeste de forme inattendue", async () => {
    fetchMock.mockResolvedValue(json({ clientName: "Agence", files: "nope" }));

    const outcome = await settle(fetchManifest(TOKEN, { fetchImpl: fetchMock }));

    expect(!outcome.ok && outcome.error).toMatchObject({ name: "ExportApiError", message: "Réponse inattendue du serveur." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("réessaie quand la connexion est coupée en plein corps de réponse", async () => {
    const truncated = new Response(JSON.stringify(MANIFEST), { status: 200 });
    vi.spyOn(truncated, "json").mockRejectedValueOnce(new TypeError("network error"));
    fetchMock.mockResolvedValueOnce(truncated).mockResolvedValueOnce(json(MANIFEST));

    const pending = settle(fetchManifest(TOKEN, { fetchImpl: fetchMock }));
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    const outcome = await pending;

    expect(outcome).toEqual({ ok: true, value: MANIFEST });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("s'interrompt pendant l'attente du backoff quand on l'annule", async () => {
    fetchMock.mockResolvedValue(json({ error: "boom" }, 503));
    const controller = new AbortController();

    const pending = settle(fetchManifest(TOKEN, { fetchImpl: fetchMock, signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    const outcome = await pending;

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && isAbortError(outcome.error)).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("n'appelle même pas le réseau si le signal est déjà annulé", async () => {
    fetchMock.mockImplementation(async (_input, init) => {
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return json(MANIFEST);
    });
    const controller = new AbortController();
    controller.abort();

    const outcome = await settle(fetchManifest(TOKEN, { fetchImpl: fetchMock, signal: controller.signal }));

    expect(!outcome.ok && isAbortError(outcome.error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("encode le jeton dans l'URL", async () => {
    fetchMock.mockResolvedValueOnce(json(MANIFEST));

    await fetchManifest("a/b c", { fetchImpl: fetchMock });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/export/a%2Fb%20c/manifest");
  });
});

describe("signUrls", () => {
  it("POST les refs en JSON et rend les URLs", async () => {
    fetchMock.mockResolvedValueOnce(json({ urls: { "m.a.b": "https://r2.example/a?sig=1" }, missing: ["m.x.y"] }));

    const result = await signUrls(TOKEN, ["m.a.b", "m.x.y"], { fetchImpl: fetchMock });

    expect(result).toEqual({ urls: { "m.a.b": "https://r2.example/a?sig=1" }, missing: ["m.x.y"] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/export/${TOKEN}/urls`);
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(init?.body))).toEqual({ refs: ["m.a.b", "m.x.y"] });
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("découpe un gros lot en requêtes de 10 refs et fusionne les réponses", async () => {
    fetchMock.mockImplementation(async (_input, init) => {
      const { refs } = JSON.parse(String(init?.body)) as { refs: string[] };
      return json({
        urls: Object.fromEntries(refs.filter((r) => r !== "r24").map((r) => [r, `https://r2.example/${r}`])),
        missing: refs.filter((r) => r === "r24"),
      });
    });
    const refs = Array.from({ length: 25 }, (_, i) => `r${i}`);

    const result = await signUrls(TOKEN, refs, { fetchImpl: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sizes = fetchMock.mock.calls.map(([, init]) => (JSON.parse(String(init?.body)) as { refs: string[] }).refs.length);
    expect(sizes).toEqual([10, 10, 5]);
    expect(Object.keys(result.urls)).toHaveLength(24);
    expect(result.missing).toEqual(["r24"]);
  });

  it("ne fait aucune requête sans ref", async () => {
    const result = await signUrls(TOKEN, [], { fetchImpl: fetchMock });

    expect(result).toEqual({ urls: {}, missing: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("jette LinkGoneError sur une 404 : le moteur s'arrête définitivement", async () => {
    fetchMock.mockResolvedValue(json({ error: "Lien invalide ou expiré" }, 404));

    const outcome = await settle(signUrls(TOKEN, ["m.a.b"], { fetchImpl: fetchMock }));

    expect(!outcome.ok && outcome.error).toBeInstanceOf(LinkGoneError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("prévient avant chaque nouvel essai (le bandeau « connexion interrompue »)", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(json({ urls: { a: "u" }, missing: [] }));
    const onRetry = vi.fn();

    const pending = settle(signUrls(TOKEN, ["a"], { fetchImpl: fetchMock, onRetry }));
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] + RETRY_DELAYS_MS[1]);
    const outcome = await pending;

    expect(outcome.ok).toBe(true);
    expect(onRetry.mock.calls.map(([info]) => info.attempt)).toEqual([1, 2]);
  });

  it("refuse une réponse sans `urls`", async () => {
    fetchMock.mockResolvedValue(json({ missing: [] }));

    const outcome = await settle(signUrls(TOKEN, ["a"], { fetchImpl: fetchMock }));

    expect(!outcome.ok && outcome.error).toMatchObject({ name: "ExportApiError" });
  });
});

describe("postEvent", () => {
  it("envoie le bilan en JSON avec keepalive", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await postEvent(TOKEN, EVENT, { fetchImpl: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/export/${TOKEN}/events`);
    expect(init).toMatchObject({ method: "POST", keepalive: true });
    expect(JSON.parse(String(init?.body))).toEqual(EVENT);
  });

  it("ne rejette jamais : lien révoqué (404)", async () => {
    fetchMock.mockResolvedValue(json({ error: "Lien invalide ou expiré" }, 404));

    await expect(postEvent(TOKEN, EVENT, { fetchImpl: fetchMock })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ne rejette jamais : requête refusée (400)", async () => {
    fetchMock.mockResolvedValue(json({ error: "invalide" }, 400));

    await expect(postEvent(TOKEN, EVENT, { fetchImpl: fetchMock })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("réessaie discrètement deux fois puis laisse tomber", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const pending = settle(postEvent(TOKEN, EVENT, { fetchImpl: fetchMock }));
    await vi.advanceTimersByTimeAsync(60_000);
    const outcome = await pending;

    expect(outcome).toEqual({ ok: true, value: undefined });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
