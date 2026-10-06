/**
 * Appels navigateur vers les routes admin des liens de téléchargement client.
 *
 * Les routes répondent `{ error: string }` avec un statut 4xx/5xx : on en tire
 * le message tel quel (il est déjà en français et destiné à l'admin). Sans corps
 * exploitable, ou sans réseau, on retombe sur un message de secours — jamais le
 * « Failed to fetch » du navigateur.
 */

import type {
  CreateExportLinkRequest,
  ExportLinkAction,
  ExportLinksResponse,
  ExportLinkWithToken,
  ExportPreview,
} from "@/lib/clientExport/types";

const NETWORK_ERROR = "Connexion impossible. Vérifie ta connexion et réessaie.";

/** Un `AbortController.abort()` n'est pas une erreur : l'appelant l'ignore. */
export function isAbortError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

export function errorMessage(err: unknown, fallback = "Une erreur est survenue."): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function apiErrorMessage(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { error } = payload as { error?: unknown };
  return typeof error === "string" && error.trim() !== "" ? error : null;
}

async function request<T>(url: string, init: RequestInit | undefined, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new Error(NETWORK_ERROR);
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // Corps vide ou non JSON (page d'erreur du proxy) : le statut suffit.
  }

  if (!res.ok) throw new Error(apiErrorMessage(payload) ?? fallback);
  if (typeof payload !== "object" || payload === null) throw new Error(fallback);
  return payload as T;
}

function json(method: "POST" | "PATCH", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function clientBase(clientId: string): string {
  return `/api/admin/clients/${encodeURIComponent(clientId)}`;
}

/** Peut prendre quelques secondes au premier appel : le serveur retrouve les tailles manquantes. */
export function fetchExportPreview(clientId: string, signal?: AbortSignal): Promise<ExportPreview> {
  return request<ExportPreview>(
    `${clientBase(clientId)}/export-preview`,
    { signal },
    "Impossible de calculer les volumes",
  );
}

export function fetchExportLinks(clientId: string, signal?: AbortSignal): Promise<ExportLinksResponse> {
  return request<ExportLinksResponse>(
    `${clientBase(clientId)}/export-links`,
    { signal },
    "Impossible de charger les liens",
  );
}

export function createExportLink(
  clientId: string,
  body: CreateExportLinkRequest,
): Promise<ExportLinkWithToken> {
  return request<ExportLinkWithToken>(
    `${clientBase(clientId)}/export-links`,
    json("POST", body),
    "Impossible de créer le lien",
  );
}

export function updateExportLink(
  clientId: string,
  linkId: string,
  action: ExportLinkAction,
): Promise<ExportLinkWithToken> {
  return request<ExportLinkWithToken>(
    `${clientBase(clientId)}/export-links/${encodeURIComponent(linkId)}`,
    json("PATCH", action),
    "Impossible de modifier le lien",
  );
}
