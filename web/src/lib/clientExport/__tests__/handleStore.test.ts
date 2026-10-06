import { afterEach, describe, expect, it, vi } from "vitest";
import { clearRootHandle, loadRootHandle, saveRootHandle } from "../handleStore";

// ─── Faux IndexedDB ──────────────────────────────────────────────────────────
//
// Juste ce que le module utilise : open() avec ses callbacks, un magasin « roots »
// (put / get / delete) et des transactions qui se terminent après coup.

type Callback = (() => void) | null;

interface FakeOptions {
  /** open() échoue (navigation privée de Firefox : InvalidStateError). */
  failOpen?: boolean;
  /** put() lève, comme un handle que le navigateur ne sait pas cloner. */
  throwOnPut?: boolean;
  /**
   * open() déclenche `blocked` (autre onglet sur un ancien schéma) : soit le succès
   * n'arrive jamais, soit il arrive plus tard.
   */
  blockOpen?: "forever" | "then-success";
}

function installFakeIndexedDb(options: FakeOptions = {}) {
  const rows = new Map<string, unknown>();
  const stats = { open: 0, closed: 0, upgrades: 0 };
  let schemaCreated = false;

  const factory = {
    open(name: string, version: number) {
      expect(name).toBe("toolbox-export");
      expect(version).toBe(1);
      stats.open += 1;
      const request = {
        result: null as unknown,
        onsuccess: null as Callback,
        onerror: null as Callback,
        onupgradeneeded: null as Callback,
        onblocked: null as Callback,
      };
      setTimeout(() => {
        if (options.failOpen) {
          request.onerror?.();
          return;
        }
        if (options.blockOpen) {
          request.onblocked?.();
          if (options.blockOpen === "forever") return;
        }
        request.result = {
          objectStoreNames: { contains: (store: string) => schemaCreated && store === "roots" },
          createObjectStore: (store: string) => {
            expect(store).toBe("roots");
            schemaCreated = true;
          },
          transaction: (store: string) => {
            expect(store).toBe("roots");
            const transaction = {
              oncomplete: null as Callback,
              onerror: null as Callback,
              onabort: null as Callback,
              objectStore: () => ({
                put: (value: unknown, key: string) => {
                  if (options.throwOnPut) throw new DOMException("not cloneable", "DataCloneError");
                  rows.set(key, value);
                  return { result: key };
                },
                get: (key: string) => ({ result: rows.get(key) }),
                delete: (key: string) => {
                  rows.delete(key);
                  return { result: undefined };
                },
              }),
            };
            // La transaction se termine une fois que le code a posé ses callbacks.
            setTimeout(() => transaction.oncomplete?.(), 0);
            return transaction;
          },
          close: () => {
            stats.closed += 1;
          },
        };
        if (!schemaCreated) {
          stats.upgrades += 1;
          request.onupgradeneeded?.();
        }
        if (!options.blockOpen) request.onsuccess?.();
        // Un `success` tardif après `blocked` : la connexion ne doit pas rester ouverte.
        else setTimeout(() => request.onsuccess?.(), 5);
      }, 0);
      return request;
    },
  };

  vi.stubGlobal("indexedDB", factory);
  return { rows, stats };
}

function directoryHandle(name: string): FileSystemDirectoryHandle {
  return { kind: "directory", name } as unknown as FileSystemDirectoryHandle;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handleStore", () => {
  it("range un dossier puis le relit", async () => {
    const { stats } = installFakeIndexedDb();
    const handle = directoryHandle("Agence Dupont");

    await saveRootHandle("link-1", handle);

    expect(await loadRootHandle("link-1")).toBe(handle);
    expect(stats.upgrades).toBe(1); // le magasin est créé à la première ouverture
  });

  it("renvoie null pour un lien dont aucun dossier n'a été rangé", async () => {
    installFakeIndexedDb();
    expect(await loadRootHandle("jamais-vu")).toBeNull();
  });

  it("garde un dossier par lien", async () => {
    installFakeIndexedDb();
    const a = directoryHandle("A");
    const b = directoryHandle("B");
    await saveRootHandle("link-a", a);
    await saveRootHandle("link-b", b);

    expect(await loadRootHandle("link-a")).toBe(a);
    expect(await loadRootHandle("link-b")).toBe(b);
  });

  it("remplace le dossier d'un lien quand le client en choisit un autre", async () => {
    installFakeIndexedDb();
    await saveRootHandle("link-1", directoryHandle("Ancien"));
    const recent = directoryHandle("Récent");
    await saveRootHandle("link-1", recent);

    expect(await loadRootHandle("link-1")).toBe(recent);
  });

  it("oublie le dossier d'un lien sans toucher aux autres", async () => {
    installFakeIndexedDb();
    const other = directoryHandle("Autre");
    await saveRootHandle("link-1", directoryHandle("A"));
    await saveRootHandle("link-2", other);

    await clearRootHandle("link-1");

    expect(await loadRootHandle("link-1")).toBeNull();
    expect(await loadRootHandle("link-2")).toBe(other);
  });

  it("ferme sa connexion après chaque opération", async () => {
    const { stats } = installFakeIndexedDb();
    await saveRootHandle("link-1", directoryHandle("A"));
    await loadRootHandle("link-1");
    await clearRootHandle("link-1");

    expect(stats.open).toBe(3);
    expect(stats.closed).toBe(3);
  });

  it("ignore une valeur qui n'est pas un dossier", async () => {
    const { rows } = installFakeIndexedDb();
    rows.set("link-1", { kind: "file", name: "x" });
    rows.set("link-2", "n'importe quoi");

    expect(await loadRootHandle("link-1")).toBeNull();
    expect(await loadRootHandle("link-2")).toBeNull();
  });
});

describe("handleStore — IndexedDB inutilisable", () => {
  it("indexedDB absent : load renvoie null, save et clear se taisent", async () => {
    vi.stubGlobal("indexedDB", undefined);

    await expect(saveRootHandle("link-1", directoryHandle("A"))).resolves.toBeUndefined();
    await expect(loadRootHandle("link-1")).resolves.toBeNull();
    await expect(clearRootHandle("link-1")).resolves.toBeUndefined();
  });

  it("open() échoue (navigation privée) : load renvoie null, save et clear se taisent", async () => {
    installFakeIndexedDb({ failOpen: true });

    await expect(saveRootHandle("link-1", directoryHandle("A"))).resolves.toBeUndefined();
    await expect(loadRootHandle("link-1")).resolves.toBeNull();
    await expect(clearRootHandle("link-1")).resolves.toBeUndefined();
  });

  it("open() lève de façon synchrone : même comportement", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("denied", "SecurityError");
      },
    });

    await expect(saveRootHandle("link-1", directoryHandle("A"))).resolves.toBeUndefined();
    await expect(loadRootHandle("link-1")).resolves.toBeNull();
    await expect(clearRootHandle("link-1")).resolves.toBeUndefined();
  });

  it("handle non clonable (put lève) : save se tait, rien n'est rangé", async () => {
    const { rows } = installFakeIndexedDb({ throwOnPut: true });

    await expect(saveRootHandle("link-1", directoryHandle("A"))).resolves.toBeUndefined();
    expect(rows.size).toBe(0);
    expect(await loadRootHandle("link-1")).toBeNull();
  });

  it("ouverture bloquée pour de bon : ne fige pas la page", async () => {
    installFakeIndexedDb({ blockOpen: "forever" });

    await expect(loadRootHandle("link-1")).resolves.toBeNull();
    await expect(saveRootHandle("link-1", directoryHandle("A"))).resolves.toBeUndefined();
    await expect(clearRootHandle("link-1")).resolves.toBeUndefined();
  });

  it("ouverture bloquée puis réussie : la connexion tardive est refermée", async () => {
    const { stats } = installFakeIndexedDb({ blockOpen: "then-success" });

    await expect(loadRootHandle("link-1")).resolves.toBeNull();
    // Le `success` arrive après l'abandon : personne n'utilisera cette connexion.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stats.closed).toBe(stats.open);
  });
});
