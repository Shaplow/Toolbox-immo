/**
 * Page serveur /export/[token] et son 404, avec `verifyExportToken` simulé :
 * pas de base de données ici (le parcours complet, jeton réel compris, est
 * couvert par e2e/client-export.spec.ts).
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/clientExport/exportLinks", () => ({ verifyExportToken: vi.fn() }));

import ExportPage, { metadata } from "@/app/export/[token]/page";
import ExportNotFound from "@/app/export/[token]/not-found";
import { verifyExportToken } from "@/lib/services/clientExport/exportLinks";

const verify = vi.mocked(verifyExportToken);
const TOKEN = "c".repeat(64);

function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await ExportPage({ params: Promise.resolve({ token: TOKEN }) }));
}

beforeEach(() => {
  verify.mockReset();
});

describe("métadonnées de la page", () => {
  it("n'est pas indexée, ne fuit pas le jeton en Referer et porte un titre clair", () => {
    expect(metadata.title).toBe("Téléchargement de tes contenus");
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
  });
});

describe("ExportPage", () => {
  it("répond 404 pour un jeton inconnu ou mal formé", async () => {
    verify.mockResolvedValue({ valid: false, reason: "not_found" });

    await expect(renderPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(verify).toHaveBeenCalledWith(TOKEN);
  });

  it("explique un lien expiré, sans aucune donnée du client", async () => {
    verify.mockResolvedValue({ valid: false, reason: "expired" });

    const text = textOf(await renderPage());

    expect(text).toContain("Ce lien a expiré");
    expect(text).toContain("Demande un nouveau lien à ton interlocuteur.");
    expect(text).not.toContain("Agence Dupont");
  });

  it("explique un lien désactivé, sans aucune donnée du client", async () => {
    verify.mockResolvedValue({ valid: false, reason: "revoked" });

    const text = textOf(await renderPage());

    expect(text).toContain("Ce lien a été désactivé");
    expect(text).toContain("Demande un nouveau lien à ton interlocuteur.");
    expect(text).not.toContain("Agence Dupont");
  });

  it("affiche le téléchargeur d'un lien valide, avec l'expiration à l'heure de Paris", async () => {
    verify.mockResolvedValue({
      valid: true,
      link: {
        id: "link_1",
        clientId: "client_1",
        clientName: "Agence Dupont",
        expiresAt: new Date("2026-10-13T12:34:00.000Z"),
        firstOpenedAt: null,
        selection: {
          clientId: "client_1",
          accountIds: [],
          mediaLibraryIds: [],
          dataLibraryIds: [],
          includePublications: false,
        },
      },
    });

    const html = await renderPage();
    const text = textOf(html);

    expect(html).toMatch(/<h1[^>]*>Agence Dupont<\/h1>/);
    expect(text).toContain("Téléchargement de tes contenus");
    expect(text).toContain("13 octobre 2026 à 14:34");
  });

  it("ne consulte que la vérification du jeton (aucune écriture au GET, pour les robots d'aperçu)", async () => {
    verify.mockResolvedValue({ valid: false, reason: "expired" });

    await renderPage();

    expect(verify).toHaveBeenCalledTimes(1);
  });
});

describe("ExportNotFound", () => {
  const html = renderToStaticMarkup(createElement(ExportNotFound));

  it("dit que le lien n'est plus valide, en français et sans le détailler", () => {
    const text = textOf(html);
    expect(text).toContain("Ce lien n'est plus valide");
    expect(text).toContain("incorrect, expiré ou désactivé");
    expect(text).toContain("Demande un nouveau lien à ton interlocuteur.");
  });

  it("ne renvoie nulle part : ni lien, ni connexion", () => {
    expect(html).not.toContain("<a ");
    expect(html.toLowerCase()).not.toContain("login");
    expect(html.toLowerCase()).not.toContain("connexion");
  });
});
