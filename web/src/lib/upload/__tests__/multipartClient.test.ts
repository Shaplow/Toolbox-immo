/**
 * Tests sur `createUploadHeartbeat`.
 *
 * Enjeu réel : ce heartbeat est ce qui empêche le sweep admin de tuer un upload
 * de plusieurs heures. Deux façons de tout casser — ne pas émettre assez (le job
 * meurt), ou émettre à chaque partie (des milliers de requêtes sur un rush de
 * 100 Go, soit ~800 parties × N appels de progression). Les deux sont couvertes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createUploadHeartbeat } from "@/lib/upload/multipartClient";

const URL = "/api/transcription/job-1/upload-heartbeat";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-11T10:00:00Z"));
  fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Avance l'horloge simulée sans dépendre de timers réels. */
function advance(ms: number) {
  vi.setSystemTime(new Date(Date.now() + ms));
}

describe("createUploadHeartbeat", () => {
  it("n'émet rien juste après la création (le prepare vient de toucher updatedAt)", () => {
    const beat = createUploadHeartbeat(URL, new AbortController().signal, 120_000);
    beat();
    beat();
    beat();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("émet une fois l'intervalle écoulé", () => {
    const beat = createUploadHeartbeat(URL, new AbortController().signal, 120_000);
    advance(120_001);
    beat();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(URL, expect.objectContaining({ method: "POST" }));
  });

  it("throttle : des centaines d'appels de progression ne produisent qu'une requête par intervalle", async () => {
    const beat = createUploadHeartbeat(URL, new AbortController().signal, 120_000);

    advance(120_001);
    for (let i = 0; i < 500; i++) beat();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Intervalle suivant : exactement une requête de plus, pas 500.
    advance(120_001);
    for (let i = 0; i < 500; i++) beat();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("n'émet plus rien après annulation de l'upload", () => {
    const controller = new AbortController();
    const beat = createUploadHeartbeat(URL, controller.signal, 120_000);
    controller.abort();
    advance(600_000);
    beat();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("n'empile pas de requête concurrente pendant l'intervalle en cours", () => {
    // fetch qui ne se résout jamais : simule un serveur qui ne répond pas.
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const beat = createUploadHeartbeat(URL, new AbortController().signal, 120_000);

    advance(120_001);
    beat();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Dans le même intervalle, on n'inonde pas un serveur déjà lent.
    advance(60_000);
    beat();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ne se bloque pas définitivement si une requête reste pendante", () => {
    // Régression : avec une garde booléenne non expirable, un fetch pendant à vie
    // empêchait tout heartbeat ultérieur — et le job finissait sweepé, soit
    // précisément le bug que ce mécanisme est censé prévenir.
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const beat = createUploadHeartbeat(URL, new AbortController().signal, 120_000);

    advance(120_001);
    beat();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Au-delà d'un intervalle, la requête est considérée perdue : on réessaie.
    advance(120_001);
    beat();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("avale les échecs réseau sans rejeter (un heartbeat ne doit pas casser l'upload)", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("network down")));
    const beat = createUploadHeartbeat(URL, new AbortController().signal, 120_000);

    advance(120_001);
    expect(() => beat()).not.toThrow();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Et l'échec ne bloque pas les battements suivants (garde in-flight relâchée).
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 200 })));
    advance(120_001);
    beat();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
