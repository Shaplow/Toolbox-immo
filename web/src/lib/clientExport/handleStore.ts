/**
 * Mémorise le dossier racine choisi pour un lien (IndexedDB), pour proposer
 * « Reprendre dans le même dossier » après un rechargement, un onglet déchargé
 * (Memory Saver) ou un autre jour.
 *
 * Un FileSystemDirectoryHandle se range tel quel dans IndexedDB (clone structuré),
 * pas dans localStorage. L'accès, lui, n'est pas mémorisé : au retour il faut
 * `requestPermission` dans un geste utilisateur (cf. ensureWritePermission).
 *
 * Tout est best-effort : navigation privée, IndexedDB absent ou bloqué, quota,
 * handle non clonable… `load` renvoie alors null et `save` / `clear` se taisent —
 * la page retombe simplement sur « Choisir un dossier ».
 */

const DB_NAME = "toolbox-export";
const DB_VERSION = 1;
const STORE_NAME = "roots";

/** Ouvre la base ; null si elle est inutilisable (jamais de rejet). */
function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (db: IDBDatabase | null) => {
      if (settled) {
        // Ouverture réussie après un abandon : on ne garde pas une connexion que personne n'utilisera.
        db?.close();
        return;
      }
      settled = true;
      resolve(db);
    };

    try {
      if (typeof indexedDB === "undefined") {
        settle(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => settle(request.result);
      request.onerror = () => settle(null);
      // Une mise à jour de schéma bloquée par un autre onglet ne doit pas figer la page.
      request.onblocked = () => settle(null);
    } catch {
      settle(null);
    }
  });
}

/**
 * Une opération dans une transaction. Résout quand la transaction est terminée
 * (une écriture n'est durable qu'à ce moment-là), avec le résultat de la requête ;
 * null au moindre échec.
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    return await new Promise<T | null>((resolve) => {
      try {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = run(transaction.objectStore(STORE_NAME));
        transaction.oncomplete = () => resolve(request.result ?? null);
        transaction.onerror = () => resolve(null);
        transaction.onabort = () => resolve(null);
      } catch {
        // DataCloneError (handle non clonable), transaction sur une base fermée…
        resolve(null);
      }
    });
  } finally {
    try {
      db.close();
    } catch {
      /* déjà fermée */
    }
  }
}

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "directory";
}

export async function saveRootHandle(linkId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  await withStore("readwrite", (store) => store.put(handle, linkId));
}

export async function loadRootHandle(linkId: string): Promise<FileSystemDirectoryHandle | null> {
  const stored = await withStore<unknown>("readonly", (store) => store.get(linkId));
  return isDirectoryHandle(stored) ? stored : null;
}

export async function clearRootHandle(linkId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(linkId));
}
