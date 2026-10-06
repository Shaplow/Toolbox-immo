/**
 * Client des API publiques /api/export/[token]/* (page /export/[token]).
 *
 * Le visiteur garde la page ouverte des heures : un déploiement du serveur
 * (≈ 1 min d'indisponibilité), une coupure Wi-Fi ou un 429 ne doivent pas
 * interrompre un téléchargement de 150 Go. Chaque appel est donc réessayé avec
 * un backoff avant d'abandonner. Une 404 est définitive : le lien est révoqué
 * ou expiré (l'API répond la même 404 quelle qu'en soit la raison) — le moteur
 * s'arrête alors sur `LinkGoneError`.
 */

import { LinkGoneError } from "@/lib/clientExport/downloadEngine";
import type {
  ExportEventRequest,
  ExportManifest,
  ExportUrlsRequest,
  ExportUrlsResponse,
} from "@/lib/clientExport/types";

/** Attentes entre deux essais : 1 + 2 + 4 + 8 + 16 + 30 s, soit de quoi traverser un déploiement. */
export const RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

/** Un bilan perdu n'a pas de conséquence : deux réessais discrets suffisent. */
const EVENT_RETRY_DELAYS_MS: readonly number[] = [2_000, 10_000];

/** Plafond d'une attente dictée par `Retry-After` : on ne fait pas attendre le visiteur plus longtemps sur la foi du serveur. */
const MAX_RETRY_AFTER_MS = 90_000;

/**
 * Refs par requête. L'API en accepte davantage ; rester en dessous évite de
 * dépendre de sa limite exacte si le moteur envoie un lot trop gros.
 */
const URLS_BATCH_SIZE = 10;

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

export class ExportApiError extends Error {
  /** Statut HTTP, null pour une erreur réseau. */
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ExportApiError";
    this.status = status;
  }
}

export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

export interface ApiCallOptions {
  signal?: AbortSignal;
  /** Appelé avant chaque attente entre deux essais (la page affiche « nouvel essai en cours »). */
  onRetry?: (info: { attempt: number; delayMs: number; error: Error }) => void;
  /** Surcharges pour les tests. */
  retryDelaysMs?: readonly number[];
  fetchImpl?: typeof fetch;
}

function apiBase(token: string): string {
  return `/api/export/${encodeURIComponent(token)}`;
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Erreurs qui passent d'elles-mêmes : serveur indisponible, surchargé ou en cours de déploiement. */
function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** `Retry-After` en secondes (la forme date HTTP n'est pas émise par nos routes). */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown } | null;
    if (typeof body?.error === "string" && body.error) return body.error;
  } catch {
    // Corps absent ou non JSON (page d'erreur nginx pendant un déploiement).
  }
  return `Le serveur a répondu avec une erreur (${res.status}).`;
}

type Attempt<T> =
  | { done: true; value: T }
  | { done: false; error: Error; retryAfterMs: number | null };

interface RequestSpec<T> {
  url: string;
  init: RequestInit;
  /** Valide et convertit le corps JSON ; absent quand la route répond sans corps (204). */
  parse?: (data: unknown) => T;
}

async function attemptOnce<T>(spec: RequestSpec<T>, options: ApiCallOptions): Promise<Attempt<T>> {
  // Liaison tardive de `fetch` : un test peut remplacer le global après l'import.
  const doFetch = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  let res: Response;
  try {
    res = await doFetch(spec.url, { ...spec.init, cache: "no-store", signal: options.signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    return {
      done: false,
      error: new ExportApiError("Impossible de joindre le serveur. Vérifie ta connexion internet."),
      retryAfterMs: null,
    };
  }

  if (res.status === 404 || res.status === 410) throw new LinkGoneError();

  if (!res.ok) {
    const error = new ExportApiError(await readErrorMessage(res), res.status);
    if (!isTransientStatus(res.status)) throw error;
    return { done: false, error, retryAfterMs: parseRetryAfter(res.headers.get("retry-after")) };
  }

  if (!spec.parse) return { done: true, value: undefined as T };

  let data: unknown;
  try {
    data = await res.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
    // Du HTML à la place du JSON (redirection, page d'erreur) ne se corrige pas
    // en réessayant ; une connexion coupée en plein corps, si.
    if (error instanceof SyntaxError) throw new ExportApiError("Réponse inattendue du serveur.", res.status);
    return {
      done: false,
      error: new ExportApiError("La connexion a été coupée pendant la réponse du serveur."),
      retryAfterMs: null,
    };
  }
  return { done: true, value: spec.parse(data) };
}

async function request<T>(spec: RequestSpec<T>, options: ApiCallOptions): Promise<T> {
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    const outcome = await attemptOnce(spec, options);
    if (outcome.done) return outcome.value;

    const delay = delays[attempt];
    if (delay === undefined) throw outcome.error;

    const waitMs = Math.max(delay, Math.min(outcome.retryAfterMs ?? 0, MAX_RETRY_AFTER_MS));
    options.onRetry?.({ attempt: attempt + 1, delayMs: waitMs, error: outcome.error });
    await sleep(waitMs, options.signal);
  }
}

// ─── Validation des réponses ─────────────────────────────────────────────────

function unexpected(): ExportApiError {
  return new ExportApiError("Réponse inattendue du serveur.");
}

function parseManifest(data: unknown): ExportManifest {
  const m = data as Partial<ExportManifest> | null;
  if (
    !m ||
    typeof m !== "object" ||
    typeof m.linkId !== "string" ||
    typeof m.clientName !== "string" ||
    typeof m.rootName !== "string" ||
    !Array.isArray(m.files) ||
    !m.totals ||
    typeof m.totals !== "object"
  ) {
    throw unexpected();
  }
  return { ...m, skipped: Array.isArray(m.skipped) ? m.skipped : [] } as ExportManifest;
}

function parseUrlsResponse(data: unknown): ExportUrlsResponse {
  const r = data as Partial<ExportUrlsResponse> | null;
  if (!r || typeof r !== "object" || !r.urls || typeof r.urls !== "object") throw unexpected();
  return { urls: r.urls, missing: Array.isArray(r.missing) ? r.missing : [] };
}

// ─── API ─────────────────────────────────────────────────────────────────────

/** Liste des fichiers du lien. Peut prendre quelques secondes (tailles retrouvées côté serveur). */
export function fetchManifest(token: string, options: ApiCallOptions = {}): Promise<ExportManifest> {
  return request({ url: `${apiBase(token)}/manifest`, init: { method: "GET" }, parse: parseManifest }, options);
}

/**
 * URLs de téléchargement pour des refs du manifeste, demandées juste avant
 * usage. Une ref hors périmètre revient dans `missing`, jamais signée.
 */
export async function signUrls(
  token: string,
  refs: string[],
  options: ApiCallOptions = {},
): Promise<ExportUrlsResponse> {
  const merged: ExportUrlsResponse = { urls: {}, missing: [] };
  for (let i = 0; i < refs.length; i += URLS_BATCH_SIZE) {
    const body: ExportUrlsRequest = { refs: refs.slice(i, i + URLS_BATCH_SIZE) };
    const part = await request(
      {
        url: `${apiBase(token)}/urls`,
        init: { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) },
        parse: parseUrlsResponse,
      },
      options,
    );
    Object.assign(merged.urls, part.urls);
    merged.missing.push(...part.missing);
  }
  return merged;
}

/**
 * Bilan de session pour l'admin (« lancé », « terminé », « arrêté »). Au mieux :
 * ne rejette jamais et le téléchargement ne l'attend pas. `keepalive` laisse
 * partir le bilan final même si le visiteur ferme l'onglet juste après.
 */
export async function postEvent(
  token: string,
  event: ExportEventRequest,
  options: Pick<ApiCallOptions, "fetchImpl" | "retryDelaysMs"> = {},
): Promise<void> {
  try {
    await request<void>(
      {
        url: `${apiBase(token)}/events`,
        init: { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(event), keepalive: true },
      },
      { retryDelaysMs: EVENT_RETRY_DELAYS_MS, ...options },
    );
  } catch {
    // Lien révoqué, serveur absent : l'admin ne verra pas ce bilan, sans autre conséquence.
  }
}
