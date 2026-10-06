/**
 * Moteur de téléchargement navigateur (File System Access).
 *
 * Écrit l'arborescence du manifeste directement dans le dossier choisi par le
 * client, fichier par fichier, depuis des URLs signées. Pas de ZIP : 150 Go ne
 * passent ni par Node (un ZIP streamé a déjà été codé puis retiré, trop lent)
 * ni par un Blob en mémoire.
 *
 * Chaque règle ci-dessous répond à un comportement vérifié de Chromium :
 *
 * - **Reprise par la TAILLE.** `getFileHandle({ create: true })` crée tout de
 *   suite un fichier VIDE au nom final : la présence ne prouve rien. Un fichier
 *   n'est sauté que si sa taille sur disque égale celle du manifeste. Les
 *   fichiers de taille inconnue (.xlsx générés à la volée) sont toujours réécrits.
 * - **Pas de reprise à l'intérieur d'un fichier.** `createWritable()` écrit dans
 *   un `.crswap` que seul `close()` renomme (après avoir relu tout le fichier
 *   pour un SHA-256) ; sans close(), Chrome le jette. Un fichier interrompu
 *   recommence donc à zéro, et `close()` n'est appelé que sur un fichier dont la
 *   taille est vérifiée : une cible existante n'est jamais remplacée par un
 *   fichier tronqué.
 * - **URLs demandées au dernier moment.** Une URL signée n'attend jamais assez
 *   pour expirer, et une révocation coupe le téléchargement au fichier suivant.
 *   Pour ménager la route (600 appels/min/IP, 20 refs par appel) sur une
 *   bibliothèque de milliers de petits sons, les fichiers légers qui suivent dans
 *   la file sont signés avec le fichier courant (≤ 5 refs par appel), au rythme
 *   plafonné d'un appel toutes les 600 ms.
 *
 * Aucune dépendance serveur : le module est chargé dans le navigateur et se
 * teste en Node avec de faux handles et un `fetch` injecté.
 */

import { formatMaxSize } from "@/lib/upload/limits";
// Même clé que le serveur pour comparer des noms : APFS et NTFS ignorent la
// casse, et « é » a deux formes Unicode.
import { nameKey } from "./naming";
import type { ExportReport, ExportUrlsResponse, ManifestFile } from "./types";

/** Le lien n'est plus valide (404 sur l'API) : arrêt définitif. */
export class LinkGoneError extends Error {
  constructor(message = "Lien invalide ou expiré") {
    super(message);
    this.name = "LinkGoneError";
  }
}

export type EngineFilePhase = "downloading" | "finalizing";

export interface EngineActiveFile {
  ref: string;
  /** Chemin du manifeste tel quel (dossier racine inclus). */
  path: string[];
  received: number;
  size: number | null;
  phase: EngineFilePhase;
}

export interface EngineProgress {
  totalFiles: number;
  /** Somme des tailles connues. */
  totalBytes: number;
  /** Fichiers terminés : écrits pendant la session + déjà présents (sautés). */
  doneFiles: number;
  /** Fichiers déjà présents à la bonne taille, sautés. */
  skippedFiles: number;
  failedFiles: number;
  missingFiles: number;
  /** Octets écrits pendant cette session. */
  writtenBytes: number;
  /** Octets des fichiers terminés (écrits + sautés) — base de la barre globale. */
  completedBytes: number;
  active: EngineActiveFile[];
  /** Débit glissant en octets/s (≈ 10 dernières secondes). */
  bytesPerSecond: number;
}

export type EngineStopReason =
  /** Tout est passé (avec d'éventuels échecs ou manquants listés). */
  | "done"
  /** Arrêt demandé (bouton « Arrêter », AbortSignal). */
  | "aborted"
  /** QuotaExceededError : disque plein. */
  | "disk_full"
  /** NotAllowedError : accès au dossier perdu (onglet longtemps en arrière-plan…). */
  | "permission_lost"
  /** L'API répond 404 : lien révoqué ou expiré. */
  | "link_gone";

export interface EngineResult {
  reason: EngineStopReason;
  report: ExportReport;
  /** `path` = chemin du manifeste tel quel (dossier racine inclus). */
  failures: Array<{ ref: string; path: string[]; error: string }>;
  missing: Array<{ ref: string; path: string[] }>;
}

export interface DownloadEngineOptions {
  /** Dossier racine déjà résolu par la page (c'est le dossier <Client>). */
  root: FileSystemDirectoryHandle;
  /** Fichiers du manifeste ; path[0] (= rootName) est ignoré, le reste est écrit sous root. */
  files: ManifestFile[];
  /** URLs pour un lot de refs, demandées juste avant usage. Throw LinkGoneError si le lien n'est plus valide. */
  signUrls: (refs: string[]) => Promise<ExportUrlsResponse>;
  /** Fichiers en parallèle (défaut 3). */
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: EngineProgress) => void;
  /** Injections pour les tests. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Aucun octet reçu pendant ce délai → abandon et nouvel essai (défaut 60 s). */
  stallTimeoutMs?: number;
  /** Délais entre essais d'un même fichier (défaut [2000, 8000, 30000]). */
  retryDelaysMs?: number[];
}

// ─── Réglages ────────────────────────────────────────────────────────────────

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_STALL_TIMEOUT_MS = 60_000;
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [2_000, 8_000, 30_000];

/** Plafond d'un setTimeout navigateur (au-delà, il se déclenche aussitôt). */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Au plus 4 appels `onProgress` par seconde : un chunk réseau arrive ~1 600 fois
 * par seconde à 100 Mo/s, un rendu React à chaque chunk étoufferait la page.
 */
const PROGRESS_MIN_INTERVAL_MS = 250;
/** Fenêtre du débit glissant. */
const SPEED_WINDOW_MS = 10_000;
/**
 * Un battement par seconde même sans événement : le débit décroît pendant un
 * blocage, et un « Finalisation… » long (relecture SHA-256 de 2 Gio) s'affiche.
 */
const PROGRESS_HEARTBEAT_MS = 1_000;

/** Refs par appel `signUrls` (la route en accepte 20). */
const SIGN_BATCH_MAX = 5;
/**
 * On ne signe d'avance que des fichiers légers : un gros fichier met des minutes
 * à passer, son URL attendrait pour rien. Un gros fichier arrête la prévision.
 */
const SIGN_LOOKAHEAD_MAX_FILE_BYTES = 64 * 1024 ** 2;
/** Une URL signée d'avance mais pas utilisée dans ce délai est redemandée. */
const SIGNED_URL_MAX_AGE_MS = 3 * 60_000;
/**
 * Appels `signUrls` : rafale de 10 puis un toutes les 600 ms (≤ 100/min), très en
 * dessous de la limite serveur (600/min/IP). Les gros fichiers n'y touchent
 * jamais ; seuls les petits sons, très rapides, en ont besoin.
 */
const SIGN_BURST = 10;
const SIGN_REFILL_MS = 600;
/**
 * `signUrls` n'est pas annulable (pas de signal dans sa signature) : une connexion
 * qui ne répond plus (Wi-Fi coupé sans reset TCP) figerait un worker pour toujours.
 * Passé ce délai l'essai est compté raté, comme n'importe quelle autre erreur.
 * Volontairement au-dessus des ~2 min de backoff qu'une fermeture `signUrls` peut
 * faire pour survivre à un redéploiement du serveur : on ne coupe pas ce backoff.
 */
const SIGN_TIMEOUT_MS = 150_000;

// ─── Utilitaires ─────────────────────────────────────────────────────────────

/**
 * Horloge monotone réelle. Le chien de garde et le rythme de signature s'en
 * servent plutôt que de `options.now` : une horloge de test figée ne doit jamais
 * empêcher un téléchargement bloqué d'être abandonné.
 */
function monotonicNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function errorName(err: unknown): string {
  if (typeof err === "object" && err !== null && "name" in err) {
    const name = (err as { name: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

function errorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "message" in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

function isLinkGone(err: unknown): boolean {
  return err instanceof LinkGoneError || errorName(err) === "LinkGoneError";
}

function isPermissionError(err: unknown): boolean {
  const name = errorName(err);
  return name === "NotAllowedError" || name === "SecurityError";
}

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

/** « 1,5 Go reçus sur 2 Go attendus » — en octets exacts quand l'arrondi masquerait l'écart. */
function describeSizes(received: number, expected: number): string {
  const short = [formatMaxSize(received), formatMaxSize(expected)];
  return short[0] === short[1]
    ? `${received} o reçus sur ${expected} o attendus`
    : `${short[0]} reçus sur ${short[1]} attendus`;
}

/**
 * Longueur annoncée par le serveur. Ignorée si le corps est encodé : le flux
 * livre les octets décodés alors que Content-Length compte les octets envoyés
 * (cas d'une route Next compressée en gzip, comme le .xlsx).
 */
function declaredLength(response: Response): number | null {
  const encoding = response.headers.get("content-encoding")?.trim().toLowerCase();
  if (encoding && encoding !== "identity") return null;
  const raw = response.headers.get("content-length")?.trim();
  return raw && /^\d+$/.test(raw) ? Number(raw) : null;
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    /* flux déjà verrouillé ou fermé */
  }
}

async function abortQuietly(writable: FileSystemWritableFileStream): Promise<void> {
  try {
    await writable.abort();
  } catch {
    /* déjà fermé, aborté ou en erreur : rien de plus à défaire */
  }
}

/**
 * Retire le fichier VIDE que `getFileHandle({ create: true })` vient de poser au
 * nom final quand le téléchargement n'a pas abouti — sans quoi le client trouve
 * des fichiers de 0 octet qui ressemblent à des vidéos cassées. Ne touche jamais
 * à un fichier non vide.
 */
async function removePlaceholder(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    if (file.size === 0) await dir.removeEntry(name);
  } catch {
    /* au mieux : la reprise réécrit de toute façon un fichier de taille fausse */
  }
}

/** Rejette si `promise` ne se règle pas dans `ms` (la promesse d'origine continue, son résultat est ignoré). */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Chien de garde d'un fichier : se déclenche quand plus aucun octet n'arrive
 * pendant `timeoutMs`. Un seul timer, réarmé paresseusement pour le temps
 * restant (un `clearTimeout` + `setTimeout` par chunk coûterait ~1 600 appels/s).
 */
function createStallWatchdog(timeoutMs: number, onStall: () => void): { touch(): void; stop(): void } {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return { touch() {}, stop() {} };

  let lastByteAt = monotonicNow();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const arm = (delay: number) => {
    timer = setTimeout(check, Math.min(delay, MAX_TIMER_MS));
  };
  const check = () => {
    timer = null;
    if (stopped) return;
    const idle = monotonicNow() - lastByteAt;
    if (idle >= timeoutMs) {
      stopped = true;
      onStall();
      return;
    }
    arm(timeoutMs - idle);
  };
  arm(timeoutMs);

  return {
    touch() {
      lastByteAt = monotonicNow();
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

// ─── Erreurs internes ────────────────────────────────────────────────────────

/** Arrêt global en cours : jamais un échec de fichier. */
class StoppedError extends Error {
  constructor() {
    super("Téléchargement interrompu");
    this.name = "StoppedError";
  }
}

/** Échec définitif d'un fichier : inutile de réessayer (nom refusé, dossier au même nom…). */
class FatalFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalFileError";
  }
}

/** Essai raté, à retenter. `immediate` : inutile d'attendre (il faut juste une nouvelle URL). */
class AttemptError extends Error {
  readonly immediate: boolean;
  constructor(message: string, immediate = false) {
    super(message);
    this.name = "AttemptError";
    this.immediate = immediate;
  }
}

/**
 * Un `TypeError` levé par getDirectoryHandle/getFileHandle signifie « nom refusé
 * par le navigateur » (caractère interdit, nom réservé…) : réessayer ne change
 * rien. Ne s'applique QU'À ces appels — un `fetch` qui échoue lève lui aussi un
 * TypeError, mais c'est une coupure réseau, à retenter.
 */
function handleError(err: unknown, name: string, kind: "dossier" | "fichier"): unknown {
  switch (errorName(err)) {
    case "TypeError":
      return new FatalFileError(`Le navigateur refuse ce nom de ${kind} : « ${name} ».`);
    case "TypeMismatchError":
      return new FatalFileError(
        kind === "dossier"
          ? `Un fichier porte déjà le nom du dossier « ${name} ».`
          : `Un dossier porte déjà le nom du fichier « ${name} ».`,
      );
    default:
      return err;
  }
}

interface FailureDescription {
  message: string;
  fatal: boolean;
  immediate: boolean;
}

/** Message FR lisible (le client le voit dans la liste des échecs) et nature de l'échec. */
function describeFailure(err: unknown): FailureDescription {
  if (err instanceof FatalFileError) return { message: err.message, fatal: true, immediate: false };
  if (err instanceof AttemptError) return { message: err.message, fatal: false, immediate: err.immediate };

  const detail = errorMessage(err);
  let message: string;
  switch (errorName(err)) {
    case "TypeError":
      message = "Connexion interrompue pendant le téléchargement.";
      break;
    case "NotFoundError":
      message = "Le dossier de destination est introuvable (déplacé ou supprimé ?).";
      break;
    case "NoModificationAllowedError":
      message = "Le fichier est utilisé par un autre programme ou protégé en écriture.";
      break;
    default:
      message = `Erreur inattendue${detail ? ` (${detail})` : ""}.`;
  }
  return { message, fatal: false, immediate: false };
}

type AttemptOutcome = { kind: "written"; bytes: number } | { kind: "skipped" } | { kind: "missing" };

interface DownloadContext {
  index: number;
  file: ManifestFile;
  dir: FileSystemDirectoryHandle;
  name: string;
  url: string;
  /** Un fichier portait déjà ce nom avant l'essai (donc le fichier vide créé n'est pas de notre fait). */
  existed: boolean;
}

// ─── Exécution ───────────────────────────────────────────────────────────────

class DownloadRun {
  private readonly files: ManifestFile[];
  private readonly concurrency: number;
  private readonly stallTimeoutMs: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;
  private readonly totalBytes: number;

  // Arrêt global : un seul mécanisme, les contrôleurs de fichier s'y abonnent.
  private stopped = false;
  private stopReason: EngineStopReason | null = null;
  private readonly stopListeners = new Set<() => void>();

  private nextIndex = 0;
  /** Dossiers déjà créés, par chemin : la promesse est partagée entre les workers (pas de course). */
  private readonly dirCache = new Map<string, Promise<FileSystemDirectoryHandle>>();

  // Signature des URLs
  private readonly urlCache = new Map<string, { url: string | null; at: number }>();
  private readonly urlInflight = new Map<string, Promise<void>>();
  private signTokens = SIGN_BURST;
  private signRefilledAt = monotonicNow();

  // Bilan
  private doneFiles = 0;
  private skippedFiles = 0;
  private failedFiles = 0;
  private missingFiles = 0;
  private writtenBytes = 0;
  private completedBytes = 0;
  private readonly activeFiles = new Map<number, EngineActiveFile>();
  private readonly failures: EngineResult["failures"] = [];
  private readonly missing: EngineResult["missing"] = [];

  // Progression
  private networkBytes = 0;
  private readonly samples: Array<{ t: number; bytes: number }> = [];
  private lastEmitAt = Number.NEGATIVE_INFINITY;
  private trailingTimer: ReturnType<typeof setTimeout> | null = null;
  private finished = false;

  constructor(private readonly options: DownloadEngineOptions) {
    this.files = options.files;
    this.concurrency = positiveInt(options.concurrency, DEFAULT_CONCURRENCY);
    this.stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
    this.retryDelaysMs = (options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS).map((delay) =>
      Number.isFinite(delay) && delay > 0 ? delay : 0,
    );
    // `fetch` appelé comme méthode d'un objet lève « Illegal invocation » : on l'enveloppe.
    this.doFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? monotonicNow;
    this.totalBytes = options.files.reduce((sum, file) => sum + (file.size ?? 0), 0);
  }

  async execute(): Promise<EngineResult> {
    const { signal, onProgress } = this.options;

    const onAbort = () => this.stop("aborted");
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    const heartbeat = onProgress ? setInterval(() => this.scheduleEmit(), PROGRESS_HEARTBEAT_MS) : null;

    try {
      const workers = Array.from({ length: Math.min(this.concurrency, this.files.length) }, () => this.worker());
      await Promise.all(workers);
    } finally {
      this.finished = true;
      if (heartbeat !== null) clearInterval(heartbeat);
      if (this.trailingTimer !== null) clearTimeout(this.trailingTimer);
      this.trailingTimer = null;
      signal?.removeEventListener("abort", onAbort);
    }

    this.emitNow();
    return {
      reason: this.stopReason ?? "done",
      report: {
        files: this.doneFiles,
        bytes: this.writtenBytes,
        skipped: this.skippedFiles,
        failed: this.failedFiles,
        missing: this.missingFiles,
      },
      failures: this.failures,
      missing: this.missing,
    };
  }

  // ─── Arrêt global ──────────────────────────────────────────────────────────

  /** Première cause d'arrêt retenue ; coupe tout ce qui est en vol (les fichiers partiels sont abandonnés, jamais commités). */
  private stop(reason: EngineStopReason): void {
    if (this.stopReason === null) this.stopReason = reason;
    if (this.stopped) return;
    this.stopped = true;
    for (const listener of [...this.stopListeners]) listener();
  }

  /** Abonnement à l'arrêt ; renvoie le désabonnement. Appelé aussitôt si on est déjà arrêté. */
  private onStop(listener: () => void): () => void {
    if (this.stopped) {
      listener();
      return () => {};
    }
    this.stopListeners.add(listener);
    return () => {
      this.stopListeners.delete(listener);
    };
  }

  private throwIfStopped(): void {
    if (this.stopped) throw new StoppedError();
  }

  /** Attend `promise`, mais rend la main tout de suite à l'arrêt (signUrls n'est pas annulable). */
  private raceStop<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const detach = this.onStop(() => reject(new StoppedError()));
      promise.then(
        (value) => {
          detach();
          resolve(value);
        },
        (err) => {
          detach();
          reject(err);
        },
      );
    });
  }

  /** Pause interrompue par l'arrêt (l'appelant vérifie `stopped` ensuite). */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.stopped) {
        resolve();
        return;
      }
      const timer = setTimeout(
        () => {
          detach();
          resolve();
        },
        Math.min(ms, MAX_TIMER_MS),
      );
      const detach = this.onStop(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  // ─── Boucle de travail ─────────────────────────────────────────────────────

  private async worker(): Promise<void> {
    while (!this.stopped) {
      const index = this.nextIndex;
      if (index >= this.files.length) return;
      this.nextIndex += 1;
      const file = this.files[index];
      try {
        await this.processFile(index, file);
      } catch (err) {
        // Filet de sécurité : un bug ne doit ni rejeter runDownload ni laisser les autres workers tourner sans suivi.
        this.activeFiles.delete(index);
        this.recordFailure(file, `Erreur inattendue (${errorMessage(err) || errorName(err) || "inconnue"}).`);
      }
    }
  }

  /** Un fichier, avec ses essais. Ne lève jamais pour une erreur de fichier. */
  private async processFile(index: number, file: ManifestFile): Promise<void> {
    const segments = file.path.slice(1);
    const name = segments[segments.length - 1];
    if (!name) {
      this.recordFailure(file, "Chemin de fichier invalide.");
      return;
    }
    const directories = segments.slice(0, -1);

    for (let attempt = 0; ; attempt += 1) {
      try {
        const outcome = await this.attemptFile(index, file, directories, name);
        // Compteurs et retrait de « en cours » d'un seul bloc synchrone : aucun
        // instantané de progression ne voit le fichier ni en cours ni terminé.
        this.recordOutcome(file, outcome);
        this.activeFiles.delete(index);
        this.scheduleEmit();
        return;
      } catch (err) {
        this.activeFiles.delete(index);
        if (this.stopped) return;

        if (isLinkGone(err)) {
          this.stop("link_gone");
          return;
        }
        if (errorName(err) === "QuotaExceededError") {
          this.stop("disk_full");
          return;
        }
        if (isPermissionError(err)) {
          this.stop("permission_lost");
          return;
        }

        const failure = describeFailure(err);
        if (failure.fatal || attempt >= this.retryDelaysMs.length) {
          this.recordFailure(file, failure.message);
          return;
        }
        if (!failure.immediate) await this.sleep(this.retryDelaysMs[attempt]);
        if (this.stopped) return;
      }
    }
  }

  private recordOutcome(file: ManifestFile, outcome: AttemptOutcome): void {
    switch (outcome.kind) {
      case "written":
        this.doneFiles += 1;
        this.writtenBytes += outcome.bytes;
        this.completedBytes += file.size ?? 0;
        break;
      case "skipped":
        this.doneFiles += 1;
        this.skippedFiles += 1;
        this.completedBytes += file.size ?? 0;
        break;
      case "missing":
        this.missingFiles += 1;
        this.missing.push({ ref: file.ref, path: file.path });
        break;
    }
    this.urlCache.delete(file.ref);
  }

  private recordFailure(file: ManifestFile, error: string): void {
    this.failedFiles += 1;
    this.failures.push({ ref: file.ref, path: file.path, error });
    this.urlCache.delete(file.ref);
    this.scheduleEmit();
  }

  // ─── Un essai ──────────────────────────────────────────────────────────────

  private async attemptFile(
    index: number,
    file: ManifestFile,
    directories: string[],
    name: string,
  ): Promise<AttemptOutcome> {
    const dir = await this.resolveDirectory(directories);

    // La reprise se décide AVANT de demander une URL : sauter ne coûte aucun appel API.
    const existing = await this.probeExisting(dir, name, file.size);
    if (existing.complete) return { kind: "skipped" };
    this.throwIfStopped();

    const url = await this.signFor(file.ref);
    if (url === null) return { kind: "missing" };
    this.throwIfStopped();

    return this.download({ index, file, dir, name, url, existed: existing.exists });
  }

  /** Dossier du chemin, créé au besoin ; une promesse par chemin, partagée par tous les workers. */
  private resolveDirectory(segments: string[]): Promise<FileSystemDirectoryHandle> {
    if (segments.length === 0) return Promise.resolve(this.options.root);

    const key = segments.join("\u0000");
    const cached = this.dirCache.get(key);
    if (cached) return cached;

    const name = segments[segments.length - 1];
    const parent = this.resolveDirectory(segments.slice(0, -1));
    const created: Promise<FileSystemDirectoryHandle> = parent
      .then((handle) => handle.getDirectoryHandle(name, { create: true }))
      .catch((err: unknown) => {
        // Un échec n'est pas mémorisé : l'essai suivant (ou un autre fichier du dossier) retente.
        if (this.dirCache.get(key) === created) this.dirCache.delete(key);
        throw handleError(err, name, "dossier");
      });
    this.dirCache.set(key, created);
    return created;
  }

  /**
   * Le fichier est-il déjà là, et complet ? « Complet » = taille identique à celle
   * du manifeste, rien d'autre (un fichier vide au nom final est un reste d'essai,
   * pas un fichier terminé). Taille inconnue : jamais complet, on réécrit.
   */
  private async probeExisting(
    dir: FileSystemDirectoryHandle,
    name: string,
    expectedSize: number | null,
  ): Promise<{ exists: boolean; complete: boolean }> {
    let handle: FileSystemFileHandle;
    try {
      handle = await dir.getFileHandle(name);
    } catch (err) {
      if (errorName(err) === "NotFoundError") return { exists: false, complete: false };
      throw handleError(err, name, "fichier");
    }
    if (expectedSize === null) return { exists: true, complete: false };

    try {
      const file = await handle.getFile();
      return { exists: true, complete: file.size === expectedSize };
    } catch (err) {
      if (isPermissionError(err)) throw err;
      return { exists: true, complete: false };
    }
  }

  private async download(ctx: DownloadContext): Promise<AttemptOutcome> {
    const { index, file, dir, name, url } = ctx;

    const entry: EngineActiveFile = {
      ref: file.ref,
      path: file.path,
      received: 0,
      size: file.size,
      phase: "downloading",
    };
    this.activeFiles.set(index, entry);
    this.scheduleEmit();

    // Contrôleur propre au fichier : le chien de garde peut abandonner CE fichier
    // sans toucher aux autres ; l'arrêt global les coupe tous.
    const controller = new AbortController();
    const detachStop = this.onStop(() => controller.abort());
    let stalled = false;
    const watchdog = createStallWatchdog(this.stallTimeoutMs, () => {
      stalled = true;
      controller.abort();
    });

    let writable: FileSystemWritableFileStream | null = null;
    let createdPlaceholder = false;
    let committed = false;

    try {
      let response: Response;
      try {
        response = await this.doFetch(url, {
          mode: "cors",
          cache: "no-store",
          credentials: "omit",
          signal: controller.signal,
        });
      } catch {
        throw new AttemptError("Connexion impossible ou interrompue avant le début du téléchargement.");
      }

      if (response.status === 404) {
        await discardBody(response);
        return { kind: "missing" };
      }
      if (response.status === 403) {
        // URL expirée ou refusée : inutile d'attendre, il suffit d'en redemander une.
        await discardBody(response);
        throw new AttemptError("Accès refusé : l'adresse de téléchargement n'est plus valable.", true);
      }
      if (!response.ok) {
        await discardBody(response);
        throw new AttemptError(`Le serveur de fichiers a répondu avec une erreur (${response.status}).`);
      }

      const declared = declaredLength(response);
      // Une taille annoncée différente de celle du manifeste ne pourra jamais passer
      // le contrôle final : inutile de télécharger des Go pour le constater.
      if (declared !== null && file.size !== null && declared !== file.size) {
        await discardBody(response);
        throw new AttemptError(`Taille inattendue : ${describeSizes(declared, file.size)}.`);
      }
      const body = response.body;
      if (body === null && file.size !== 0 && declared !== 0) {
        throw new AttemptError("Le serveur de fichiers n'a renvoyé aucune donnée.");
      }

      // Le fichier n'est créé qu'une fois la réponse acquise : un 404 ou un 403
      // ne laisse donc aucun fichier vide derrière lui.
      let fileHandle: FileSystemFileHandle;
      try {
        fileHandle = await dir.getFileHandle(name, { create: true });
      } catch (err) {
        throw handleError(err, name, "fichier");
      }
      createdPlaceholder = !ctx.existed;
      writable = await fileHandle.createWritable();
      watchdog.touch();

      let received = 0;
      const counter = new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, streamController) => {
          received += chunk.byteLength;
          entry.received = received;
          this.networkBytes += chunk.byteLength;
          watchdog.touch();
          streamController.enqueue(chunk);
          this.scheduleEmit();
        },
      });
      if (body !== null) {
        await body.pipeThrough(counter).pipeTo(writable, { preventClose: true, signal: controller.signal });
      }

      // Plus aucun octet n'est attendu : close() peut relire longtemps (SHA-256) sans que ce soit un blocage.
      watchdog.stop();

      if (declared !== null && received !== declared) {
        throw new AttemptError(
          received < declared
            ? `Fichier incomplet : ${describeSizes(received, declared)}.`
            : `Taille inattendue : ${describeSizes(received, declared)}.`,
        );
      }
      if (file.size !== null && received !== file.size) {
        throw new AttemptError(`Taille inattendue : ${describeSizes(received, file.size)}.`);
      }

      // Même si l'arrêt est demandé à cet instant : le fichier est complet et vérifié,
      // le commiter évite de le retélécharger à la reprise.
      entry.phase = "finalizing";
      this.scheduleEmit();
      await writable.close();
      committed = true;
      return { kind: "written", bytes: received };
    } catch (err) {
      if (stalled && !this.stopped) {
        throw new AttemptError(
          `Aucune donnée reçue depuis ${Math.max(1, Math.round(this.stallTimeoutMs / 1000))} s.`,
        );
      }
      throw err;
    } finally {
      watchdog.stop();
      detachStop();
      if (!committed) {
        // abort() jette le .crswap : la cible existante reste intacte.
        if (writable) await abortQuietly(writable);
        if (createdPlaceholder) await removePlaceholder(dir, name);
      }
    }
  }

  // ─── Signature des URLs ────────────────────────────────────────────────────

  /**
   * URL d'un fichier : celle signée d'avance avec un fichier précédent si elle est
   * encore fraîche, sinon un nouvel appel groupé. `null` = fichier introuvable.
   * Une URL n'est donnée qu'une fois : un nouvel essai en redemande une.
   */
  private async signFor(ref: string): Promise<string | null> {
    for (;;) {
      this.throwIfStopped();

      const cached = this.urlCache.get(ref);
      if (cached) {
        this.urlCache.delete(ref);
        if (monotonicNow() - cached.at <= SIGNED_URL_MAX_AGE_MS) return cached.url;
        continue;
      }

      const pending = this.urlInflight.get(ref);
      if (pending) {
        // Un autre worker a déjà ce fichier dans son lot : on attend son résultat
        // (même s'il échoue : on retentera alors seuls).
        await this.raceStop(pending.catch(() => undefined));
        continue;
      }

      await this.raceStop(this.signBatch([ref, ...this.lookAheadRefs()]));
      const signed = this.urlCache.get(ref);
      if (!signed) throw new AttemptError("Le serveur n'a pas fourni d'adresse de téléchargement pour ce fichier.");
      this.urlCache.delete(ref);
      return signed.url;
    }
  }

  /** Fichiers légers qui suivent dans la file, à signer avec le courant (dans l'ordre, sans doublon). */
  private lookAheadRefs(): string[] {
    const refs: string[] = [];
    for (let i = this.nextIndex; i < this.files.length && refs.length < SIGN_BATCH_MAX - 1; i += 1) {
      const next = this.files[i];
      if (next.size !== null && next.size > SIGN_LOOKAHEAD_MAX_FILE_BYTES) break;
      if (this.urlCache.has(next.ref) || this.urlInflight.has(next.ref)) continue;
      refs.push(next.ref);
    }
    return refs;
  }

  private async signBatch(refs: string[]): Promise<void> {
    const unique = [...new Set(refs)];

    const call = (async () => {
      await this.paceSigning();
      let response: ExportUrlsResponse;
      try {
        response = await withTimeout(this.options.signUrls(unique), SIGN_TIMEOUT_MS, "le serveur ne répond pas");
      } catch (err) {
        if (isLinkGone(err)) throw err;
        const detail = errorMessage(err);
        throw new AttemptError(
          `Impossible d'obtenir l'adresse de téléchargement${detail ? ` (${detail})` : ""}.`,
        );
      }
      const at = monotonicNow();
      const missing = new Set(response.missing ?? []);
      for (const ref of unique) {
        const url = response.urls?.[ref];
        if (missing.has(ref)) this.urlCache.set(ref, { url: null, at });
        else if (typeof url === "string" && url !== "") this.urlCache.set(ref, { url, at });
      }
    })();

    for (const ref of unique) this.urlInflight.set(ref, call);
    try {
      await call;
    } finally {
      for (const ref of unique) {
        if (this.urlInflight.get(ref) === call) this.urlInflight.delete(ref);
      }
    }

    // Les URLs prévues pour des fichiers finalement sautés ne servent à personne : on les purge.
    const t = monotonicNow();
    for (const [ref, entry] of this.urlCache) {
      if (t - entry.at > SIGNED_URL_MAX_AGE_MS) this.urlCache.delete(ref);
    }
  }

  /** Seau à jetons : rafale de SIGN_BURST puis un appel toutes les SIGN_REFILL_MS. */
  private async paceSigning(): Promise<void> {
    for (;;) {
      const t = monotonicNow();
      this.signTokens = Math.min(SIGN_BURST, this.signTokens + Math.max(0, t - this.signRefilledAt) / SIGN_REFILL_MS);
      this.signRefilledAt = t;
      if (this.signTokens >= 1) {
        this.signTokens -= 1;
        return;
      }
      await this.sleep(Math.ceil((1 - this.signTokens) * SIGN_REFILL_MS));
      this.throwIfStopped();
    }
  }

  // ─── Progression ───────────────────────────────────────────────────────────

  /**
   * Demande un instantané de progression en respectant ≤ 4 appels/s : tout de
   * suite si le dernier est assez ancien, sinon un seul appel différé qui porte
   * l'état le plus récent (un changement de phase ne reste jamais sans écho).
   */
  private scheduleEmit(): void {
    if (!this.options.onProgress || this.finished) return;
    const wait = PROGRESS_MIN_INTERVAL_MS - (this.now() - this.lastEmitAt);
    if (wait <= 0) {
      if (this.trailingTimer !== null) clearTimeout(this.trailingTimer);
      this.trailingTimer = null;
      this.emitNow();
      return;
    }
    if (this.trailingTimer === null) {
      this.trailingTimer = setTimeout(() => {
        this.trailingTimer = null;
        this.scheduleEmit();
      }, Math.min(wait, MAX_TIMER_MS));
    }
  }

  private emitNow(): void {
    const { onProgress } = this.options;
    if (!onProgress) return;

    const t = this.now();
    this.lastEmitAt = t;

    // Débit glissant : octets reçus entre le plus ancien échantillon de la fenêtre et maintenant.
    this.samples.push({ t, bytes: this.networkBytes });
    while (this.samples.length > 1 && this.samples[0].t < t - SPEED_WINDOW_MS) this.samples.shift();
    const oldest = this.samples[0];
    const elapsed = t - oldest.t;
    const bytesPerSecond = elapsed > 0 ? Math.round(((this.networkBytes - oldest.bytes) * 1000) / elapsed) : 0;

    try {
      onProgress({
        totalFiles: this.files.length,
        totalBytes: this.totalBytes,
        doneFiles: this.doneFiles,
        skippedFiles: this.skippedFiles,
        failedFiles: this.failedFiles,
        missingFiles: this.missingFiles,
        writtenBytes: this.writtenBytes,
        completedBytes: this.completedBytes,
        active: Array.from(this.activeFiles.values(), (active) => ({ ...active })),
        bytesPerSecond,
      });
    } catch {
      /* un callback d'interface qui plante ne doit pas faire échouer des téléchargements */
    }
  }
}

/**
 * Télécharge les fichiers du manifeste dans `root`. Ne rejette pas : toute issue
 * (fin normale, arrêt demandé, disque plein, accès perdu, lien invalide) se lit
 * dans `reason`, et le bilan couvre ce qui a été écrit jusque-là.
 */
export async function runDownload(options: DownloadEngineOptions): Promise<EngineResult> {
  return new DownloadRun(options).execute();
}

/**
 * Dossier racine où écrire : le dossier choisi s'il porte déjà le nom attendu
 * (comparaison sans casse, NFC — le client a suivi la consigne « crée un
 * dossier <Client> »), sinon un sous-dossier <rootName> créé dedans.
 */
export async function resolveExportRoot(
  picked: FileSystemDirectoryHandle,
  rootName: string,
): Promise<FileSystemDirectoryHandle> {
  if (nameKey(picked.name) === nameKey(rootName)) return picked;
  return picked.getDirectoryHandle(rootName, { create: true });
}

/**
 * Accès en écriture à un dossier mémorisé : queryPermission, puis
 * requestPermission (à appeler dans un geste utilisateur). false si refusé.
 *
 * Un navigateur qui n'expose aucune de ces méthodes ne peut rien nous dire :
 * on laisse passer, l'accès sera vérifié (et un refus signalé) à l'écriture.
 */
export async function ensureWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const descriptor = { mode: "readwrite" } as const;
  try {
    if (typeof handle.queryPermission === "function") {
      if ((await handle.queryPermission(descriptor)) === "granted") return true;
    } else if (typeof handle.requestPermission !== "function") {
      return true;
    }
    // Droit non accordé (ou invérifiable) : on ne peut que le demander.
    if (typeof handle.requestPermission !== "function") return false;
    return (await handle.requestPermission(descriptor)) === "granted";
  } catch {
    // requestPermission rejette hors geste utilisateur (SecurityError) : pas d'accès.
    return false;
  }
}
