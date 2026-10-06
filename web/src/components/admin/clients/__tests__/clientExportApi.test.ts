import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createExportLink,
  errorMessage,
  fetchExportLinks,
  fetchExportPreview,
  isAbortError,
  updateExportLink,
} from "../clientExportApi";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("routes admin des liens de téléchargement", () => {
  it("lit l'aperçu et la liste en GET, signal transmis", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ accounts: [], libraries: [] }));
    const controller = new AbortController();

    await fetchExportPreview("c1", controller.signal);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/clients/c1/export-preview", {
      signal: controller.signal,
    });

    fetchMock.mockImplementation(async () => jsonResponse({ links: [] }));
    await expect(fetchExportLinks("c1")).resolves.toEqual({ links: [] });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/admin/clients/c1/export-links");
  });

  it("crée un lien en POST avec le corps JSON", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ link: { id: "l1" }, rawToken: "tok" }, 201));
    const body = {
      label: null,
      expiresInDays: 7 as const,
      accountIds: ["a1"],
      mediaLibraryIds: ["v1"],
      dataLibraryIds: [],
      includePublications: true,
    };

    await expect(createExportLink("c1", body)).resolves.toMatchObject({ rawToken: "tok" });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/admin/clients/c1/export-links");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });

  it("modifie un lien en PATCH, identifiants encodés", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ link: { id: "l 1" } }));

    await updateExportLink("c/1", "l 1", { action: "extend", days: 7 });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/admin/clients/c%2F1/export-links/l%201");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ action: "extend", days: 7 });
  });
});

describe("erreurs", () => {
  it("reprend le message du serveur", async () => {
    stubFetch(async () => jsonResponse({ error: "Réservé aux administrateurs." }, 403));
    await expect(fetchExportPreview("c1")).rejects.toThrow("Réservé aux administrateurs.");
  });

  it("retombe sur le message de secours sans corps exploitable", async () => {
    stubFetch(async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(fetchExportPreview("c1")).rejects.toThrow("Impossible de calculer les volumes");

    stubFetch(async () => jsonResponse({ error: "   " }, 500));
    await expect(fetchExportLinks("c1")).rejects.toThrow("Impossible de charger les liens");
  });

  it("refuse un succès sans objet JSON", async () => {
    stubFetch(async () => new Response("", { status: 200 }));
    await expect(createExportLink("c1", {
      label: null,
      expiresInDays: 7,
      accountIds: ["a1"],
      mediaLibraryIds: [],
      dataLibraryIds: [],
      includePublications: true,
    })).rejects.toThrow("Impossible de créer le lien");
  });

  it("traduit une panne réseau, mais laisse passer l'annulation", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchExportLinks("c1")).rejects.toThrow(
      "Connexion impossible. Vérifie ta connexion et réessaie.",
    );

    stubFetch(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    const error = await fetchExportLinks("c1").catch((err: unknown) => err);
    expect(isAbortError(error)).toBe(true);
  });

  it("errorMessage garde le message d'une Error, sinon le secours", () => {
    expect(errorMessage(new Error("Boum"))).toBe("Boum");
    expect(errorMessage("boum", "Secours")).toBe("Secours");
    expect(errorMessage(new Error(""), "Secours")).toBe("Secours");
  });
});
