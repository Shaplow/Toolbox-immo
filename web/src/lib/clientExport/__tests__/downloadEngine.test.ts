import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureWritePermission,
  LinkGoneError,
  resolveExportRoot,
  runDownload,
  type DownloadEngineOptions,
  type EngineProgress,
} from "../downloadEngine";
import type { ExportUrlsResponse, ManifestFile } from "../types";

// ─── Faux système de fichiers, calqué sur Chromium ───────────────────────────
//
// Ce qui compte pour le moteur et que le faux reproduit :
// - getFileHandle({ create: true }) crée AUSSITÔT un fichier vide au nom final ;
// - createWritable() écrit à part, seul close() remplace le contenu (commit) ;
//   abort() ou une erreur pendant l'écriture laissent la cible intacte ;
// - un nom refusé lève un TypeError, un nom pris par l'autre type TypeMismatchError.

const microtask = () => Promise.resolve();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function domError(name: string, message = name): DOMException {
  return new DOMException(message, name);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const joinPath = (parent: string, name: string) => (parent ? `${parent}/${name}` : name);

interface FsHooks {
  beforeCreateWritable?: (path: string) => void;
  onWrite?: (path: string) => void;
}

class MemFile {
  readonly kind = "file" as const;
  data: Uint8Array = new Uint8Array(0);

  constructor(
    private readonly fs: MemFs,
    readonly name: string,
    readonly path: string,
  ) {}

  async getFile(): Promise<{ size: number; name: string }> {
    await microtask();
    return { size: this.data.byteLength, name: this.name };
  }

  async createWritable(): Promise<WritableStream<Uint8Array>> {
    await microtask();
    this.fs.hooks.beforeCreateWritable?.(this.path);
    const chunks: Uint8Array[] = [];
    return new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.fs.hooks.onWrite?.(this.path);
        chunks.push(chunk);
      },
      close: () => {
        this.data = concat(chunks);
        this.fs.commits.push(this.path);
      },
      abort: () => {
        this.fs.aborts.push(this.path);
      },
    });
  }
}

class MemDir {
  readonly kind = "directory" as const;
  readonly entries = new Map<string, MemDir | MemFile>();

  constructor(
    private readonly fs: MemFs,
    readonly name: string,
    readonly path: string,
  ) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemDir> {
    this.fs.checkName(name, Boolean(options?.create));
    await microtask();
    const existing = this.entries.get(name);
    if (existing) {
      if (existing.kind !== "directory") throw domError("TypeMismatchError");
      return existing;
    }
    if (!options?.create) throw domError("NotFoundError");
    // Latence d'un aller-retour vers le processus navigateur : deux appels concurrents
    // non mémoïsés créeraient deux fois le dossier, et dirCreates le montrerait.
    await microtask();
    const dir = new MemDir(this.fs, name, joinPath(this.path, name));
    this.entries.set(name, dir);
    this.fs.dirCreates[dir.path] = (this.fs.dirCreates[dir.path] ?? 0) + 1;
    return dir;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemFile> {
    this.fs.checkName(name, Boolean(options?.create));
    await microtask();
    const existing = this.entries.get(name);
    if (existing) {
      if (existing.kind !== "file") throw domError("TypeMismatchError");
      return existing;
    }
    if (!options?.create) throw domError("NotFoundError");
    const file = new MemFile(this.fs, name, joinPath(this.path, name));
    this.entries.set(name, file);
    return file;
  }

  async removeEntry(name: string): Promise<void> {
    await microtask();
    const entry = this.entries.get(name);
    if (!entry) throw domError("NotFoundError");
    this.entries.delete(name);
    this.fs.removed.push(joinPath(this.path, name));
  }
}

class MemFs {
  readonly commits: string[] = [];
  readonly aborts: string[] = [];
  readonly removed: string[] = [];
  readonly dirCreates: Record<string, number> = {};
  readonly hooks: FsHooks = {};
  /** Noms refusés partout (TypeError), comme un caractère interdit. */
  readonly refusedNames = new Set<string>();
  /** Noms refusés seulement à la création. */
  readonly refusedOnCreate = new Set<string>();
  readonly root = new MemDir(this, "Client", "");

  checkName(name: string, create: boolean): void {
    const invalid = name === "" || name === "." || name === ".." || /[/\\]/.test(name);
    if (invalid || this.refusedNames.has(name) || (create && this.refusedOnCreate.has(name))) {
      throw new TypeError("Name is not allowed.");
    }
  }

  find(path: string): MemDir | MemFile | undefined {
    let current: MemDir | MemFile | undefined = this.root;
    for (const part of path.split("/")) {
      if (!current || current.kind !== "directory") return undefined;
      current = current.entries.get(part);
    }
    return current;
  }

  /** Fichier déjà présent sur le disque avant le téléchargement. */
  put(path: string, content: string): void {
    const parts = path.split("/");
    const name = parts.pop() as string;
    let dir = this.root;
    for (const part of parts) {
      let next = dir.entries.get(part);
      if (!next) {
        next = new MemDir(this, part, joinPath(dir.path, part));
        dir.entries.set(part, next);
      }
      dir = next as MemDir;
    }
    const file = new MemFile(this, name, joinPath(dir.path, name));
    file.data = encoder.encode(content);
    dir.entries.set(name, file);
  }

  exists(path: string): boolean {
    return this.find(path) !== undefined;
  }

  text(path: string): string {
    const entry = this.find(path);
    if (!entry || entry.kind !== "file") throw new Error(`Pas de fichier ${path}`);
    return decoder.decode(entry.data);
  }

  /** Tous les fichiers présents (y compris vides), triés. */
  files(): string[] {
    const out: string[] = [];
    const walk = (dir: MemDir) => {
      for (const entry of dir.entries.values()) {
        if (entry.kind === "directory") walk(entry);
        else out.push(entry.path);
      }
    };
    walk(this.root);
    return out.sort();
  }

  get handle(): FileSystemDirectoryHandle {
    return this.root as unknown as FileSystemDirectoryHandle;
  }
}

// ─── Faux serveur : signUrls + fetch ─────────────────────────────────────────

interface Plan {
  /** Statut HTTP (défaut 200). */
  status?: number;
  /** Octets réellement livrés avant de fermer le flux (défaut : tout). */
  serve?: number;
  /** Content-Length annoncé : undefined = taille du contenu, null = absent. */
  contentLength?: number | null;
  contentEncoding?: string;
  chunkSize?: number;
  chunkDelayMs?: number;
  /** Le flux se fige après N octets, jusqu'à l'abort. */
  hangAfter?: number;
  /** Le flux échoue après N octets (coupure réseau). */
  failAfter?: number;
  /** Le flux ne se ferme qu'une fois cette promesse résolue. */
  gate?: Promise<void>;
  /** Réponse 200 sans corps du tout (body === null). */
  emptyBody?: boolean;
  onChunk?: (index: number) => void;
}

const EMPTY_PLAN: Plan = {};

class FakeServer {
  readonly contents = new Map<string, Uint8Array>();
  readonly plans = new Map<string, Plan[]>();
  readonly fetchCalls: Array<{ ref: string; init: RequestInit | undefined }> = [];
  readonly signCalls: string[][] = [];
  /** Refs que signUrls déclare introuvables. */
  readonly missingRefs = new Set<string>();
  signHook?: (refs: string[]) => void | Promise<void>;
  inFlight = 0;
  maxInFlight = 0;
  private readonly attempts = new Map<string, number>();

  readonly signUrls = async (refs: string[]): Promise<ExportUrlsResponse> => {
    this.signCalls.push([...refs]);
    await this.signHook?.(refs);
    const urls: Record<string, string> = {};
    const missing: string[] = [];
    for (const ref of refs) {
      if (this.missingRefs.has(ref)) missing.push(ref);
      else urls[ref] = `https://r2.test/${ref}`;
    }
    return { urls, missing };
  };

  readonly fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const ref = decodeURIComponent(new URL(String(input)).pathname.slice(1));
    this.fetchCalls.push({ ref, init });
    const attempt = this.attempts.get(ref) ?? 0;
    this.attempts.set(ref, attempt + 1);
    const plans = this.plans.get(ref) ?? [];
    const plan = plans[Math.min(attempt, plans.length - 1)] ?? EMPTY_PLAN;
    const signal = init?.signal as AbortSignal;

    if (signal.aborted) throw domError("AbortError");
    const status = plan.status ?? 200;
    if (status !== 200) return new Response(null, { status });

    const data = this.contents.get(ref);
    if (!data) throw new Error(`Aucun contenu pour ${ref}`);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    const body = makeBody(data, plan, signal, () => {
      this.inFlight -= 1;
    });

    const headers = new Headers();
    const length = plan.contentLength === undefined ? data.byteLength : plan.contentLength;
    if (length !== null) headers.set("content-length", String(length));
    if (plan.contentEncoding) headers.set("content-encoding", plan.contentEncoding);
    if (plan.emptyBody) {
      body.cancel().catch(() => {});
      return new Response(null, { status: 200, headers });
    }
    return new Response(body, { status: 200, headers });
  }) as typeof fetch;
}

function makeBody(
  data: Uint8Array,
  plan: Plan,
  signal: AbortSignal,
  onFinish: () => void,
): ReadableStream<Uint8Array> {
  const chunkSize = plan.chunkSize ?? 4;
  const served = Math.min(plan.serve ?? data.byteLength, data.byteLength);
  const limit = Math.min(served, plan.hangAfter ?? Infinity, plan.failAfter ?? Infinity);
  let offset = 0;
  let index = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onFinish();
  };
  signal.addEventListener("abort", finish, { once: true });

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (plan.chunkDelayMs) await sleep(plan.chunkDelayMs);
      if (signal.aborted) {
        finish();
        controller.error(domError("AbortError"));
        return;
      }
      if (offset < limit) {
        const end = Math.min(offset + chunkSize, limit);
        try {
          controller.enqueue(data.slice(offset, end));
        } catch {
          return; // flux déjà annulé par le consommateur
        }
        offset = end;
        plan.onChunk?.(index);
        index += 1;
        return;
      }
      if (plan.hangAfter !== undefined && limit === plan.hangAfter) {
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        finish();
        controller.error(domError("AbortError"));
        return;
      }
      if (plan.failAfter !== undefined && limit === plan.failAfter) {
        finish();
        controller.error(new TypeError("network error"));
        return;
      }
      if (plan.gate) await plan.gate;
      finish();
      controller.close();
    },
    cancel() {
      finish();
    },
  });
}

// ─── Montage d'un test ───────────────────────────────────────────────────────

function manifestFile(ref: string, relPath: string, size: number | null): ManifestFile {
  return { ref, kind: "media", path: ["Client", ...relPath.split("/")], size };
}

const BIG = 100 * 1024 ** 2; // au-delà du plafond de signature d'avance (64 Mio)

function harness() {
  const fs = new MemFs();
  const server = new FakeServer();
  const files: ManifestFile[] = [];

  return {
    fs,
    server,
    files,
    /** Fichier de taille connue égale à son contenu. */
    add(ref: string, relPath: string, content: string, ...plans: Plan[]): ManifestFile {
      const bytes = encoder.encode(content);
      server.contents.set(ref, bytes);
      server.plans.set(ref, plans);
      const file = manifestFile(ref, relPath, bytes.byteLength);
      files.push(file);
      return file;
    },
    /** Fichier de taille inconnue d'avance (.xlsx généré à la volée). */
    addUnknownSize(ref: string, relPath: string, content: string, ...plans: Plan[]): ManifestFile {
      server.contents.set(ref, encoder.encode(content));
      server.plans.set(ref, plans);
      const file = manifestFile(ref, relPath, null);
      files.push(file);
      return file;
    },
    /** Gros fichier annoncé, jamais livré : sert à observer les appels de signature. */
    addBig(ref: string, relPath: string, ...plans: Plan[]): ManifestFile {
      server.plans.set(ref, plans.length > 0 ? plans : [{ status: 404 }]);
      const file = manifestFile(ref, relPath, BIG);
      files.push(file);
      return file;
    },
    run(extra: Partial<DownloadEngineOptions> = {}) {
      return runDownload({
        root: fs.handle,
        files,
        signUrls: server.signUrls,
        fetchImpl: server.fetchImpl,
        retryDelaysMs: [1, 1, 1],
        stallTimeoutMs: 5_000,
        ...extra,
      });
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── runDownload ─────────────────────────────────────────────────────────────

describe("runDownload — écriture", () => {
  it("écrit l'arborescence, dossiers compris, et rend le bilan", async () => {
    const t = harness();
    t.add("m.a.1", "Sarah/Cuisine/a.mp4", "AAAA");
    t.add("m.b.1", "Sarah/Cuisine/b.mp4", "BBBBBB");
    t.add("m.c.1", "Sarah/Sons/c.mp3", "CC");

    const result = await t.run();

    expect(result.reason).toBe("done");
    expect(result.report).toEqual({ files: 3, bytes: 12, skipped: 0, failed: 0, missing: 0 });
    expect(result.failures).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(t.fs.text("Sarah/Cuisine/a.mp4")).toBe("AAAA");
    expect(t.fs.text("Sarah/Cuisine/b.mp4")).toBe("BBBBBB");
    expect(t.fs.text("Sarah/Sons/c.mp3")).toBe("CC");
    expect(t.fs.commits).toHaveLength(3);
  });

  it("appelle fetch avec les options attendues (CORS, sans cache, sans cookies)", async () => {
    const t = harness();
    t.add("m.a.1", "A/a.bin", "AAAA");
    await t.run();
    expect(t.server.fetchCalls[0].init).toMatchObject({ mode: "cors", cache: "no-store", credentials: "omit" });
    expect(t.server.fetchCalls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("n'écrit rien quand le manifeste est vide", async () => {
    const t = harness();
    const result = await t.run();
    expect(result.reason).toBe("done");
    expect(result.report).toEqual({ files: 0, bytes: 0, skipped: 0, failed: 0, missing: 0 });
  });

  it("crée chaque dossier une seule fois, même quand plusieurs fichiers arrivent ensemble", async () => {
    const t = harness();
    for (let i = 0; i < 6; i += 1) t.add(`ref.${i}`, `Compte/Biblio/Dossier/${i}.bin`, "DATA", { chunkDelayMs: 2 });

    await t.run({ concurrency: 6 });

    expect(t.fs.dirCreates).toEqual({
      Compte: 1,
      "Compte/Biblio": 1,
      "Compte/Biblio/Dossier": 1,
    });
    expect(t.fs.files()).toHaveLength(6);
  });

  it("respecte la concurrence demandée", async () => {
    const t = harness();
    for (let i = 0; i < 8; i += 1) t.add(`ref.${i}`, `A/${i}.bin`, "0123456789", { chunkSize: 2, chunkDelayMs: 3 });

    await t.run({ concurrency: 2 });

    expect(t.server.maxInFlight).toBe(2);
    expect(t.fs.commits).toHaveLength(8);
  });

  it("télécharge 3 fichiers en parallèle par défaut", async () => {
    const t = harness();
    for (let i = 0; i < 8; i += 1) t.add(`ref.${i}`, `A/${i}.bin`, "0123456789", { chunkSize: 2, chunkDelayMs: 3 });

    await t.run();

    expect(t.server.maxInFlight).toBe(3);
  });
});

describe("runDownload — reprise par la taille", () => {
  it("saute un fichier déjà complet, sans demander d'URL ni le télécharger", async () => {
    const t = harness();
    t.fs.put("A/a.bin", "AAAA");
    t.add("ref.a", "A/a.bin", "AAAA");
    t.add("ref.b", "A/b.bin", "BBBB");

    const result = await t.run();

    expect(result.report).toEqual({ files: 2, bytes: 4, skipped: 1, failed: 0, missing: 0 });
    expect(t.server.fetchCalls.map((call) => call.ref)).toEqual(["ref.b"]);
    expect(t.server.signCalls.flat()).not.toContain("ref.a");
    expect(t.fs.commits).toEqual(["A/b.bin"]);
  });

  it("compte un fichier sauté dans la progression (terminé, octets comptés, pas écrits)", async () => {
    const t = harness();
    t.fs.put("A/a.bin", "AAAA");
    t.add("ref.a", "A/a.bin", "AAAA");
    const events: EngineProgress[] = [];

    await t.run({ onProgress: (progress) => events.push(progress) });

    const last = events[events.length - 1];
    expect(last).toMatchObject({
      totalFiles: 1,
      totalBytes: 4,
      doneFiles: 1,
      skippedFiles: 1,
      completedBytes: 4,
      writtenBytes: 0,
    });
  });

  it("re-télécharge un fichier VIDE au nom final (reste d'un essai interrompu)", async () => {
    const t = harness();
    t.fs.put("A/a.bin", "");
    t.add("ref.a", "A/a.bin", "AAAA");

    const result = await t.run();

    expect(result.report).toMatchObject({ files: 1, bytes: 4, skipped: 0 });
    expect(t.server.fetchCalls).toHaveLength(1);
    expect(t.fs.text("A/a.bin")).toBe("AAAA");
  });

  it("re-télécharge un fichier de taille différente", async () => {
    const t = harness();
    t.fs.put("A/a.bin", "AA");
    t.add("ref.a", "A/a.bin", "AAAA");

    const result = await t.run();

    expect(result.report).toMatchObject({ files: 1, skipped: 0 });
    expect(t.fs.text("A/a.bin")).toBe("AAAA");
  });

  it("réécrit toujours un fichier de taille inconnue, même présent", async () => {
    const t = harness();
    t.fs.put("A/data.xlsx", "ANCIEN");
    t.addUnknownSize("d.lib.c", "A/data.xlsx", "NOUVEAU");

    const result = await t.run();

    expect(result.report).toMatchObject({ files: 1, bytes: 7, skipped: 0 });
    expect(t.fs.text("A/data.xlsx")).toBe("NOUVEAU");
  });

  it("garde l'ancien fichier intact tant que le nouveau n'est pas complet", async () => {
    const t = harness();
    t.fs.put("A/a.bin", "ANCIEN");
    t.add("ref.a", "A/a.bin", "0123456789", { serve: 5 }); // toujours tronqué

    const result = await t.run();

    expect(result.report.failed).toBe(1);
    expect(t.fs.text("A/a.bin")).toBe("ANCIEN");
    expect(t.fs.commits).toEqual([]);
  });

  it("échoue un fichier dont un dossier porte le nom, sans réessayer", async () => {
    const t = harness();
    t.fs.put("A/a.bin/inner.txt", "x");
    t.add("ref.a", "A/a.bin", "AAAA");

    const result = await t.run();

    expect(result.report.failed).toBe(1);
    expect(result.failures[0].error).toContain("Un dossier porte déjà le nom du fichier");
    expect(t.server.fetchCalls).toHaveLength(0);
  });
});

describe("runDownload — réponses du serveur de fichiers", () => {
  it("compte un 404 comme fichier manquant, sans réessai, et continue", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "AAAA", { status: 404 });
    t.add("ref.b", "A/b.bin", "BBBB");

    const result = await t.run();

    expect(result.reason).toBe("done");
    expect(result.report).toEqual({ files: 1, bytes: 4, skipped: 0, failed: 0, missing: 1 });
    expect(result.missing).toEqual([{ ref: "ref.a", path: ["Client", "A", "a.bin"] }]);
    expect(result.failures).toEqual([]);
    expect(t.server.fetchCalls.filter((call) => call.ref === "ref.a")).toHaveLength(1);
    expect(t.fs.exists("A/a.bin")).toBe(false); // aucun fichier vide laissé derrière
    expect(t.fs.text("A/b.bin")).toBe("BBBB");
  });

  it("compte un fichier déclaré introuvable par signUrls comme manquant, sans le requêter", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "AAAA");
    t.add("ref.b", "A/b.bin", "BBBB");
    t.server.missingRefs.add("ref.a");

    const result = await t.run();

    expect(result.report).toEqual({ files: 1, bytes: 4, skipped: 0, failed: 0, missing: 1 });
    expect(result.missing.map((m) => m.ref)).toEqual(["ref.a"]);
    expect(t.server.fetchCalls.map((call) => call.ref)).toEqual(["ref.b"]);
  });

  it("redemande une URL sur un 403 (expirée) puis réussit", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "AAAA", { status: 403 }, {});

    const result = await t.run();

    expect(result.report).toMatchObject({ files: 1, failed: 0 });
    expect(t.fs.text("A/a.bin")).toBe("AAAA");
    expect(t.server.fetchCalls.filter((call) => call.ref === "ref.a")).toHaveLength(2);
    expect(t.server.signCalls.filter((refs) => refs.includes("ref.a"))).toHaveLength(2);
  });

  it("réessaie après une erreur serveur puis réussit", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "AAAA", { status: 503 }, {});

    const result = await t.run();

    expect(result.report).toMatchObject({ files: 1, failed: 0 });
    expect(t.server.fetchCalls).toHaveLength(2);
  });

  it("n'écrit pas un corps tronqué (octets < Content-Length) puis réessaie", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "0123456789", { serve: 5 }, {});

    const result = await t.run();

    expect(result.report).toMatchObject({ files: 1, bytes: 10, failed: 0 });
    expect(t.fs.text("A/a.bin")).toBe("0123456789");
    expect(t.fs.commits).toEqual(["A/a.bin"]); // un seul commit : l'essai tronqué n'en a pas eu
    expect(t.fs.aborts).toEqual(["A/a.bin"]); // et il a été abandonné
    expect(t.server.fetchCalls).toHaveLength(2);
  });

  it("n'écrit pas un fichier de taille différente de celle du manifeste", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "0123456789", { contentLength: null, serve: 7 });

    const result = await t.run();

    expect(result.report.failed).toBe(1);
    expect(result.failures[0].error).toContain("Taille inattendue");
    expect(t.fs.commits).toEqual([]);
    expect(t.fs.exists("A/a.bin")).toBe(false);
  });

  it("refuse tout de suite un Content-Length différent de la taille attendue, sans télécharger le corps", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "0123456789", { contentLength: 99 });

    const result = await t.run({ retryDelaysMs: [] });

    expect(result.report.failed).toBe(1);
    expect(result.failures[0].error).toContain("Taille inattendue");
    expect(t.fs.files()).toEqual([]); // rien n'a même été créé
    expect(t.server.inFlight).toBe(0);
  });

  it("ignore Content-Length quand le corps est compressé", async () => {
    const t = harness();
    // Annonce 3 octets compressés, livre 10 octets décodés : pas une troncature.
    t.addUnknownSize("d.lib.c", "A/data.xlsx", "0123456789", { contentLength: 3, contentEncoding: "gzip" });

    const result = await t.run();

    expect(result.report).toMatchObject({ files: 1, bytes: 10, failed: 0 });
    expect(t.fs.text("A/data.xlsx")).toBe("0123456789");
  });

  it("écrit un fichier vide légitime (taille 0, corps vide)", async () => {
    const t = harness();
    t.add("ref.a", "A/vide.txt", "");

    const result = await t.run();

    expect(result.report).toMatchObject({ files: 1, bytes: 0, failed: 0 });
    expect(t.fs.exists("A/vide.txt")).toBe(true);
    expect(t.fs.text("A/vide.txt")).toBe("");
  });

  it("écrit un fichier vide légitime même sans corps de réponse (taille 0)", async () => {
    const t = harness();
    t.add("ref.a", "A/vide.txt", "", { emptyBody: true });

    const result = await t.run();

    expect(result.report).toMatchObject({ files: 1, bytes: 0, failed: 0 });
    expect(t.fs.text("A/vide.txt")).toBe("");
  });

  it("refuse une réponse sans corps pour un fichier censé contenir des données", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "AAAA", { emptyBody: true }); // Content-Length: 4 mais aucun corps
    t.addUnknownSize("d.lib.c", "A/data.xlsx", "XLSX", { emptyBody: true, contentLength: null });

    const result = await t.run();

    expect(result.report).toMatchObject({ files: 0, failed: 2 });
    expect(result.failures.map((f) => f.error)).toEqual([
      expect.stringContaining("n'a renvoyé aucune donnée"),
      expect.stringContaining("n'a renvoyé aucune donnée"),
    ]);
    expect(t.fs.files()).toEqual([]); // ni fichier vide, ni fichier commité
    expect(t.fs.commits).toEqual([]);
  });

  it("réessaie après une coupure réseau en cours de fichier", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "0123456789", { failAfter: 4 }, {});

    const result = await t.run();

    expect(result.report).toMatchObject({ files: 1, failed: 0 });
    expect(t.fs.text("A/a.bin")).toBe("0123456789");
    expect(t.fs.commits).toEqual(["A/a.bin"]);
  });
});

describe("runDownload — essais épuisés", () => {
  it("liste le fichier en échec après tous les essais et continue avec les autres", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "0123456789", { serve: 5 }); // toujours tronqué
    t.add("ref.b", "A/b.bin", "BBBB");

    const result = await t.run();

    expect(result.reason).toBe("done");
    expect(result.report).toEqual({ files: 1, bytes: 4, skipped: 0, failed: 1, missing: 0 });
    expect(result.failures).toEqual([
      { ref: "ref.a", path: ["Client", "A", "a.bin"], error: expect.stringContaining("Fichier incomplet") },
    ]);
    expect(t.server.fetchCalls.filter((call) => call.ref === "ref.a")).toHaveLength(4); // 1 + 3 réessais
    expect(t.fs.exists("A/a.bin")).toBe(false); // plus de fichier vide au nom final
    expect(t.fs.text("A/b.bin")).toBe("BBBB");
    expect(t.fs.commits).toEqual(["A/b.bin"]);
  });

  it("applique 1 + retryDelaysMs.length essais", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "0123456789", { serve: 5 });

    await t.run({ retryDelaysMs: [1] });
    expect(t.server.fetchCalls).toHaveLength(2);
  });

  it("ne réessaie pas quand retryDelaysMs est vide", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "0123456789", { serve: 5 });

    await t.run({ retryDelaysMs: [] });
    expect(t.server.fetchCalls).toHaveLength(1);
  });

  it("compte une erreur de signUrls comme un essai raté du fichier", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "AAAA");
    t.server.signHook = () => {
      throw new Error("HTTP 500");
    };

    const result = await t.run();

    expect(result.reason).toBe("done");
    expect(result.report.failed).toBe(1);
    expect(result.failures[0].error).toContain("Impossible d'obtenir l'adresse de téléchargement");
    expect(t.server.signCalls).toHaveLength(4);
    expect(t.server.fetchCalls).toHaveLength(0);
  });

  it("échoue un fichier que signUrls n'a ni signé ni déclaré manquant", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "AAAA");

    const result = await t.run({
      signUrls: async (refs) => {
        t.server.signCalls.push([...refs]);
        return { urls: {}, missing: [] };
      },
    });

    expect(result.report.failed).toBe(1);
    expect(result.failures[0].error).toContain("n'a pas fourni d'adresse");
  });

  it("échoue sans réessai un fichier dont le nom est refusé à la création", async () => {
    const t = harness();
    t.fs.refusedOnCreate.add("bad:name.bin");
    t.add("ref.a", "A/bad:name.bin", "AAAA");
    t.add("ref.b", "A/b.bin", "BBBB");

    const result = await t.run();

    expect(result.reason).toBe("done");
    expect(result.report).toMatchObject({ files: 1, failed: 1 });
    expect(result.failures[0].error).toContain("bad:name.bin");
    expect(result.failures[0].error).toContain("refuse");
    expect(t.server.fetchCalls.filter((call) => call.ref === "ref.a")).toHaveLength(1);
    expect(t.fs.exists("A/bad:name.bin")).toBe(false);
    expect(t.fs.text("A/b.bin")).toBe("BBBB");
  });

  it("échoue sans réessai les fichiers d'un dossier dont le nom est refusé", async () => {
    const t = harness();
    t.fs.refusedNames.add("Bad:Dir");
    t.add("ref.a", "Bad:Dir/a.bin", "AAAA");
    t.add("ref.b", "Bad:Dir/b.bin", "BBBB");
    t.add("ref.c", "Ok/c.bin", "CCCC");

    const result = await t.run();

    expect(result.report).toMatchObject({ files: 1, failed: 2 });
    expect(result.failures.map((f) => f.ref).sort()).toEqual(["ref.a", "ref.b"]);
    expect(result.failures[0].error).toContain("dossier");
    expect(t.server.fetchCalls.map((call) => call.ref)).toEqual(["ref.c"]);
  });
});

describe("runDownload — arrêts globaux", () => {
  /** Quatre fichiers lents : trois en vol quand un événement survient, le quatrième en attente. */
  function slowFiles(t: ReturnType<typeof harness>) {
    for (const key of ["a", "b", "c", "d"]) {
      t.add(`ref.${key}`, `A/${key}.bin`, "0123456789012345678901234567890123456789", {
        chunkSize: 2,
        chunkDelayMs: 4,
      });
    }
  }

  it("QuotaExceededError → disk_full, tout ce qui est en vol est abandonné", async () => {
    const t = harness();
    slowFiles(t);
    t.fs.hooks.onWrite = (path) => {
      if (path === "A/b.bin") throw domError("QuotaExceededError", "No space left on device");
    };

    const result = await t.run();

    expect(result.reason).toBe("disk_full");
    expect(result.failures).toEqual([]); // un arrêt global n'est pas un échec de fichier
    expect(t.fs.commits).toEqual([]);
    expect(t.fs.files()).toEqual([]); // aucun fichier partiel ni vide
    expect(t.server.fetchCalls.map((call) => call.ref)).not.toContain("ref.d");
    expect(t.server.inFlight).toBe(0);
  });

  it.each(["NotAllowedError", "SecurityError"])("%s → permission_lost", async (name) => {
    const t = harness();
    slowFiles(t);
    t.fs.hooks.beforeCreateWritable = (path) => {
      if (path === "A/a.bin") throw domError(name);
    };

    const result = await t.run();

    expect(result.reason).toBe("permission_lost");
    expect(result.failures).toEqual([]);
    expect(t.fs.commits).toEqual([]);
    expect(t.fs.files()).toEqual([]);
  });

  it("NotAllowedError à la lecture d'un fichier existant → permission_lost", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "AAAA");
    vi.spyOn(t.fs.root, "getDirectoryHandle").mockRejectedValue(domError("NotAllowedError"));

    const result = await t.run();

    expect(result.reason).toBe("permission_lost");
    expect(t.server.fetchCalls).toHaveLength(0);
  });

  it("LinkGoneError de signUrls → link_gone, le bilan garde ce qui est déjà écrit", async () => {
    const t = harness();
    for (let i = 0; i < 7; i += 1) t.add(`ref.${i}`, `A/${i}.bin`, `data-${i}`);
    // 1er appel : les 5 premiers fichiers (lot) ; le 2e appel arrive quand le lot est épuisé.
    let calls = 0;
    t.server.signHook = () => {
      calls += 1;
      if (calls >= 2) throw new LinkGoneError();
    };

    const result = await t.run({ concurrency: 1 });

    expect(result.reason).toBe("link_gone");
    expect(result.report).toMatchObject({ files: 5, failed: 0 });
    expect(t.fs.files()).toHaveLength(5);
    expect(t.server.signCalls).toHaveLength(2);
  });

  it("reconnaît une LinkGoneError par son nom, même venue d'un autre module", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "AAAA");
    t.server.signHook = () => {
      const err = new Error("gone");
      err.name = "LinkGoneError";
      throw err;
    };

    const result = await t.run();
    expect(result.reason).toBe("link_gone");
    expect(result.failures).toEqual([]);
  });

  it("signal déjà aborté → aborted sans rien faire", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "AAAA");
    const controller = new AbortController();
    controller.abort();

    const result = await t.run({ signal: controller.signal });

    expect(result.reason).toBe("aborted");
    expect(result.report.files).toBe(0);
    expect(t.server.signCalls).toHaveLength(0);
    expect(t.fs.files()).toEqual([]);
  });

  it("abort global en plein téléchargement → aborted, aucun fichier partiel commité", async () => {
    const t = harness();
    const controller = new AbortController();
    // Chaque flux livre 2 octets puis se fige ; le 1er chunk du premier déclenche l'arrêt.
    t.add("ref.a", "A/a.bin", "0123456789", { chunkSize: 2, hangAfter: 2, onChunk: () => controller.abort() });
    t.add("ref.b", "A/b.bin", "0123456789", { chunkSize: 2, hangAfter: 2 });
    t.add("ref.c", "A/c.bin", "0123456789", { chunkSize: 2, hangAfter: 2 });

    const result = await t.run({ signal: controller.signal });

    expect(result.reason).toBe("aborted");
    expect(result.report).toEqual({ files: 0, bytes: 0, skipped: 0, failed: 0, missing: 0 });
    expect(result.failures).toEqual([]);
    expect(t.fs.commits).toEqual([]);
    expect(t.fs.files()).toEqual([]);
    expect(t.server.inFlight).toBe(0);
  });

  it("l'abort garde les fichiers déjà terminés et abandonne celui en cours", async () => {
    const t = harness();
    const controller = new AbortController();
    t.add("ref.a", "A/a.bin", "AAAA");
    t.add("ref.b", "A/b.bin", "0123456789", {
      chunkSize: 2,
      hangAfter: 2,
      onChunk: () => controller.abort(),
    });

    const result = await t.run({ signal: controller.signal, concurrency: 1 });

    expect(result.reason).toBe("aborted");
    expect(result.report).toMatchObject({ files: 1, bytes: 4 });
    expect(t.fs.text("A/a.bin")).toBe("AAAA");
    expect(t.fs.exists("A/b.bin")).toBe(false);
    expect(t.fs.commits).toEqual(["A/a.bin"]);
  });

  it("un arrêt demandé à la finalisation n'empêche pas de commiter un fichier complet et vérifié", async () => {
    const t = harness();
    const controller = new AbortController();
    t.add("ref.a", "A/a.bin", "AAAA");
    let clock = 0;

    const result = await t.run({
      signal: controller.signal,
      now: () => (clock += 300), // chaque état de progression est émis aussitôt
      onProgress: (progress) => {
        if (progress.active.some((file) => file.phase === "finalizing")) controller.abort();
      },
    });

    // Le fichier est complet : le commiter évite de le retélécharger à la reprise.
    expect(result.reason).toBe("aborted");
    expect(result.report).toMatchObject({ files: 1, bytes: 4, failed: 0 });
    expect(t.fs.text("A/a.bin")).toBe("AAAA");
    expect(t.fs.commits).toEqual(["A/a.bin"]);
  });

  it("l'abort interrompt aussi l'attente entre deux essais", async () => {
    const t = harness();
    const controller = new AbortController();
    t.add("ref.a", "A/a.bin", "0123456789", { serve: 5 }); // 1er essai tronqué, puis pause de 60 s
    // Le premier essai dure quelques millisecondes : à 50 ms le moteur dort déjà.
    setTimeout(() => controller.abort(), 50);

    const started = Date.now();
    const result = await t.run({ signal: controller.signal, retryDelaysMs: [60_000, 60_000] });

    expect(result.reason).toBe("aborted");
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(t.server.fetchCalls).toHaveLength(1);
    expect(result.failures).toEqual([]);
  });
});

describe("runDownload — chien de garde", () => {
  it("abandonne un fichier qui ne reçoit plus rien pendant stallTimeoutMs, puis le recommence", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "0123456789", { chunkSize: 2, hangAfter: 4 }, {});

    const result = await t.run({ stallTimeoutMs: 40 });

    expect(result.report).toMatchObject({ files: 1, bytes: 10, failed: 0 });
    expect(t.fs.text("A/a.bin")).toBe("0123456789");
    expect(t.fs.commits).toEqual(["A/a.bin"]);
    expect(t.fs.aborts).toEqual(["A/a.bin"]); // l'essai figé a été abandonné
    expect(t.server.fetchCalls).toHaveLength(2);
  });

  it("liste le fichier en échec si le blocage se répète à chaque essai", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "0123456789", { chunkSize: 2, hangAfter: 2 });
    t.add("ref.b", "A/b.bin", "BBBB");

    const result = await t.run({ stallTimeoutMs: 30, retryDelaysMs: [1] });

    expect(result.report).toMatchObject({ files: 1, failed: 1 });
    expect(result.failures[0]).toMatchObject({ ref: "ref.a", error: expect.stringContaining("Aucune donnée reçue") });
    expect(t.fs.exists("A/a.bin")).toBe(false);
    expect(t.fs.text("A/b.bin")).toBe("BBBB");
  });

  it("ne se déclenche pas tant que des octets arrivent, même si le fichier est long", async () => {
    const t = harness();
    // 5 chunks espacés de 20 ms (≈ 100 ms au total) pour un délai de 70 ms sans octet.
    t.add("ref.a", "A/a.bin", "0123456789", { chunkSize: 2, chunkDelayMs: 20 });

    const result = await t.run({ stallTimeoutMs: 70 });

    expect(result.report).toMatchObject({ files: 1, failed: 0 });
    expect(t.server.fetchCalls).toHaveLength(1);
  });

  it("ne confond pas la finalisation avec un blocage (close() sans octet entrant)", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "AAAA");
    // Fige close() bien au-delà du délai : Chrome relit tout le fichier ici.
    const original = t.fs.root.getFileHandle.bind(t.fs.root);
    vi.spyOn(t.fs.root, "getFileHandle").mockImplementation(async (name, options) => {
      const handle = await original(name, options);
      const createWritable = handle.createWritable.bind(handle);
      handle.createWritable = async () => {
        const writable = await createWritable();
        const close = writable.close.bind(writable);
        writable.close = async () => {
          await sleep(80);
          return close();
        };
        return writable;
      };
      return handle;
    });

    const result = await t.run({ stallTimeoutMs: 30 });

    expect(result.report).toMatchObject({ files: 1, failed: 0 });
    expect(t.server.fetchCalls).toHaveLength(1);
    expect(t.fs.text("A/a.bin")).toBe("AAAA");
  });
});

// ─── Progression ─────────────────────────────────────────────────────────────

describe("runDownload — progression", () => {
  it("rend un état final complet et passe par « finalisation »", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "AAAA");
    t.add("ref.b", "A/b.bin", "BBBBBB");
    let clock = 0;
    const events: EngineProgress[] = [];

    // Horloge qui avance de 300 ms à chaque lecture : plus rien n'est retenu par le plafond de cadence.
    await t.run({ now: () => (clock += 300), onProgress: (progress) => events.push(progress) });

    expect(events[events.length - 1]).toMatchObject({
      totalFiles: 2,
      totalBytes: 10,
      doneFiles: 2,
      skippedFiles: 0,
      failedFiles: 0,
      missingFiles: 0,
      writtenBytes: 10,
      completedBytes: 10,
      active: [],
    });
    const actives = events.flatMap((event) => event.active);
    expect(actives.some((file) => file.phase === "downloading" && file.received > 0)).toBe(true);
    expect(actives.some((file) => file.phase === "finalizing")).toBe(true);
    expect(actives.every((file) => file.size !== null && file.path[0] === "Client")).toBe(true);
  });

  it("ne dépasse pas 4 appels par seconde, plus un appel final", async () => {
    const t = harness();
    const clock = { t: 0 };
    // 100 chunks de 4 octets, 10 ms « virtuelles » chacun = 1 s de téléchargement.
    t.add("ref.a", "A/a.bin", "x".repeat(400), { chunkSize: 4, onChunk: () => (clock.t += 10) });
    const emitted: Array<{ at: number; progress: EngineProgress }> = [];

    await t.run({
      now: () => clock.t,
      onProgress: (progress) => emitted.push({ at: clock.t, progress }),
    });

    const final = emitted[emitted.length - 1];
    expect(final.progress.doneFiles).toBe(1);
    expect(emitted.length).toBeLessThanOrEqual(1 + 4 + 1);
    const beforeFinal = emitted.slice(0, -1);
    for (let i = 1; i < beforeFinal.length; i += 1) {
      expect(beforeFinal[i].at - beforeFinal[i - 1].at).toBeGreaterThanOrEqual(250);
    }
    // 4 octets par 10 ms ≈ 400 o/s sur la fenêtre glissante
    const speeds = emitted.map((entry) => entry.progress.bytesPerSecond);
    expect(Math.max(...speeds)).toBeGreaterThan(200);
    expect(Math.max(...speeds)).toBeLessThan(800);
  });

  it("n'interrompt pas les téléchargements quand onProgress plante", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "AAAA");

    const result = await t.run({
      onProgress: () => {
        throw new Error("rendu cassé");
      },
    });

    expect(result.report).toMatchObject({ files: 1, failed: 0 });
    expect(t.fs.text("A/a.bin")).toBe("AAAA");
  });
});

// ─── Signature des URLs ──────────────────────────────────────────────────────

describe("runDownload — signature des URLs", () => {
  it("signe les petits fichiers par lots de 5 refs au plus", async () => {
    const t = harness();
    for (let i = 0; i < 12; i += 1) t.add(`ref.${i}`, `A/${i}.bin`, `data-${i}`);

    const result = await t.run();

    expect(result.report).toMatchObject({ files: 12, failed: 0 });
    expect(t.server.signCalls.length).toBeLessThan(12);
    expect(Math.max(...t.server.signCalls.map((refs) => refs.length))).toBeLessThanOrEqual(5);
    // Chaque fichier a été téléchargé une fois, avec l'URL signée pour lui.
    expect(t.server.fetchCalls.map((call) => call.ref).sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => `ref.${i}`).sort(),
    );
  });

  it("n'inclut jamais un fichier sauté dans le lot comme s'il devait être téléchargé", async () => {
    const t = harness();
    t.fs.put("A/1.bin", "data-1");
    for (let i = 0; i < 3; i += 1) t.add(`ref.${i}`, `A/${i}.bin`, `data-${i}`);

    const result = await t.run({ concurrency: 1 });

    expect(result.report).toMatchObject({ files: 3, skipped: 1 });
    expect(t.server.fetchCalls.map((call) => call.ref)).toEqual(["ref.0", "ref.2"]);
  });

  it("ne signe pas d'avance les gros fichiers : un appel par fichier", async () => {
    const t = harness();
    for (let i = 0; i < 4; i += 1) t.addBig(`big.${i}`, `A/${i}.mp4`);

    const result = await t.run({ concurrency: 1 });

    expect(result.report.missing).toBe(4);
    expect(t.server.signCalls).toEqual([["big.0"], ["big.1"], ["big.2"], ["big.3"]]);
  });

  it("arrête la prévision au premier gros fichier, en gardant l'ordre", async () => {
    const t = harness();
    t.add("s.0", "A/0.bin", "zero");
    t.add("s.1", "A/1.bin", "one1");
    t.addBig("big.2", "A/2.mp4");
    t.add("s.3", "A/3.bin", "three");

    await t.run({ concurrency: 1 });

    expect(t.server.signCalls[0]).toEqual(["s.0", "s.1"]);
  });

  it("plafonne le rythme des appels : rafale de 10, puis un toutes les 600 ms", async () => {
    vi.useFakeTimers();
    const t = harness();
    for (let i = 0; i < 12; i += 1) t.addBig(`big.${i}`, `A/${i}.mp4`);

    const run = t.run({ concurrency: 12 });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.server.signCalls).toHaveLength(10);
    await vi.advanceTimersByTimeAsync(599);
    expect(t.server.signCalls).toHaveLength(10);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.server.signCalls).toHaveLength(11);
    await vi.advanceTimersByTimeAsync(600);
    expect(t.server.signCalls).toHaveLength(12);

    const result = await run;
    expect(result.report.missing).toBe(12);
  });

  it("redemande une URL signée d'avance qui a trop attendu", async () => {
    vi.useFakeTimers();
    const t = harness();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.add("ref.a", "A/a.bin", "AAAA", { gate });
    t.add("ref.b", "A/b.bin", "BBBB");

    const run = t.run({ concurrency: 1, stallTimeoutMs: Number.POSITIVE_INFINITY });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.server.signCalls).toEqual([["ref.a", "ref.b"]]); // b signé d'avance avec a
    await vi.advanceTimersByTimeAsync(4 * 60_000); // a est très lent : l'URL de b vieillit
    release();
    const result = await run;

    expect(result.report).toMatchObject({ files: 2, failed: 0 });
    expect(t.server.signCalls).toEqual([["ref.a", "ref.b"], ["ref.b"]]);
    expect(t.fs.text("A/b.bin")).toBe("BBBB");
  });

  it("ne reste pas bloqué sur un signUrls qui ne répond jamais : l'essai est compté raté, le suivant repart", async () => {
    vi.useFakeTimers();
    const t = harness();
    t.add("ref.a", "A/a.bin", "AAAA");
    let calls = 0;
    // 1er appel : le serveur accepte la connexion et ne répond jamais.
    t.server.signHook = () => (calls++ === 0 ? new Promise<void>(() => {}) : undefined);

    const run = t.run({ concurrency: 1 });
    await vi.advanceTimersByTimeAsync(149_999);
    expect(t.server.signCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2);
    const result = await run;

    expect(result.report).toMatchObject({ files: 1, failed: 0 });
    expect(t.server.signCalls).toHaveLength(2);
    expect(t.fs.text("A/a.bin")).toBe("AAAA");
  });

  it("liste le fichier en échec quand signUrls ne répond jamais, avec un message lisible", async () => {
    vi.useFakeTimers();
    const t = harness();
    t.add("ref.a", "A/a.bin", "AAAA");
    t.server.signHook = () => new Promise<void>(() => {});

    const run = t.run({ concurrency: 1, retryDelaysMs: [] });
    await vi.advanceTimersByTimeAsync(150_001);
    const result = await run;

    expect(result.report.failed).toBe(1);
    expect(result.failures[0].error).toContain("le serveur ne répond pas");
  });

  it("garde l'URL signée d'avance tant qu'elle est fraîche", async () => {
    const t = harness();
    t.add("ref.a", "A/a.bin", "AAAA");
    t.add("ref.b", "A/b.bin", "BBBB");

    await t.run({ concurrency: 1 });

    expect(t.server.signCalls).toEqual([["ref.a", "ref.b"]]);
  });
});

// ─── resolveExportRoot ───────────────────────────────────────────────────────

describe("resolveExportRoot", () => {
  function fakePicked(name: string) {
    const getDirectoryHandle = vi.fn(async (child: string) => ({ kind: "directory", name: child }) as unknown);
    const handle = { kind: "directory", name, getDirectoryHandle } as unknown as FileSystemDirectoryHandle;
    return { handle, getDirectoryHandle };
  }

  it("écrit directement dans le dossier choisi quand il porte déjà le nom attendu", async () => {
    const { handle, getDirectoryHandle } = fakePicked("Agence Dupont");
    expect(await resolveExportRoot(handle, "Agence Dupont")).toBe(handle);
    expect(getDirectoryHandle).not.toHaveBeenCalled();
  });

  it("ignore la casse : « agence dupont » est « Agence Dupont »", async () => {
    const { handle, getDirectoryHandle } = fakePicked("agence DUPONT");
    expect(await resolveExportRoot(handle, "Agence Dupont")).toBe(handle);
    expect(getDirectoryHandle).not.toHaveBeenCalled();
  });

  it("ignore la forme Unicode : « é » composé ou décomposé", async () => {
    const { handle } = fakePicked("Café Martin"); // e + accent combinant
    expect(await resolveExportRoot(handle, "Café Martin")).toBe(handle);
  });

  it("crée un sous-dossier <rootName> quand le dossier choisi s'appelle autrement", async () => {
    const { handle, getDirectoryHandle } = fakePicked("Téléchargements");
    const root = await resolveExportRoot(handle, "Agence Dupont");
    expect(getDirectoryHandle).toHaveBeenCalledWith("Agence Dupont", { create: true });
    expect(root.name).toBe("Agence Dupont");
  });
});

// ─── ensureWritePermission ───────────────────────────────────────────────────

describe("ensureWritePermission", () => {
  type Permission = "granted" | "prompt" | "denied";
  function handleWith(methods: {
    query?: () => Promise<Permission>;
    request?: () => Promise<Permission>;
  }): { handle: FileSystemDirectoryHandle; query: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> } {
    const query = vi.fn(methods.query ?? (async () => "prompt" as Permission));
    const request = vi.fn(methods.request ?? (async () => "denied" as Permission));
    const handle = {
      kind: "directory",
      name: "x",
      ...(methods.query ? { queryPermission: query } : {}),
      ...(methods.request ? { requestPermission: request } : {}),
    } as unknown as FileSystemDirectoryHandle;
    return { handle, query, request };
  }

  it("accorde sans rien demander quand l'accès en écriture est déjà donné", async () => {
    const { handle, query, request } = handleWith({ query: async () => "granted", request: async () => "granted" });
    expect(await ensureWritePermission(handle)).toBe(true);
    expect(query).toHaveBeenCalledWith({ mode: "readwrite" });
    expect(request).not.toHaveBeenCalled();
  });

  it("demande l'accès quand il n'est plus accordé, et suit la réponse", async () => {
    const granted = handleWith({ query: async () => "prompt", request: async () => "granted" });
    expect(await ensureWritePermission(granted.handle)).toBe(true);
    expect(granted.request).toHaveBeenCalledWith({ mode: "readwrite" });

    const denied = handleWith({ query: async () => "prompt", request: async () => "denied" });
    expect(await ensureWritePermission(denied.handle)).toBe(false);

    const dismissed = handleWith({ query: async () => "denied", request: async () => "prompt" });
    expect(await ensureWritePermission(dismissed.handle)).toBe(false);
  });

  it("demande directement l'accès quand queryPermission n'existe pas", async () => {
    const { handle, request } = handleWith({ request: async () => "granted" });
    expect(await ensureWritePermission(handle)).toBe(true);
    expect(request).toHaveBeenCalled();
  });

  it("laisse passer quand le navigateur n'expose aucune des deux méthodes (vérifié à l'écriture)", async () => {
    const { handle } = handleWith({});
    expect(await ensureWritePermission(handle)).toBe(true);
  });

  it("refuse quand l'accès n'est pas accordé et qu'on ne peut pas le demander", async () => {
    const { handle } = handleWith({ query: async () => "prompt" });
    expect(await ensureWritePermission(handle)).toBe(false);
  });

  it("refuse quand requestPermission rejette (appel hors geste utilisateur)", async () => {
    const { handle } = handleWith({
      query: async () => "prompt",
      request: async () => {
        throw domError("SecurityError", "User activation is required");
      },
    });
    expect(await ensureWritePermission(handle)).toBe(false);
  });
});
