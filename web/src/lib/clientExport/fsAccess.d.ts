/**
 * File System Access API — parties absentes de lib.dom (non standardisées :
 * Chrome, Edge, Opera desktop uniquement). Utilisées par la page publique
 * /export/[token] et le moteur de téléchargement.
 */

type FileSystemPermissionMode = "read" | "readwrite";

interface FileSystemHandlePermissionDescriptor {
  mode?: FileSystemPermissionMode;
}

interface FileSystemHandle {
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

/**
 * Itération sur le contenu d'un dossier (relecture de l'arbre écrit, test OPFS).
 * Déclarée ici parce que le tsconfig ne charge pas `dom.asynciterable`. Des
 * méthodes seulement : si ce lib est un jour ajouté, la fusion les prend comme
 * surcharges au lieu d'entrer en conflit.
 */
interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  keys(): AsyncIterableIterator<string>;
  values(): AsyncIterableIterator<FileSystemHandle>;
}

interface DirectoryPickerOptions {
  /** Mémorise le dernier dossier choisi pour cet id. */
  id?: string;
  mode?: FileSystemPermissionMode;
  startIn?: "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos" | FileSystemHandle;
}

interface Window {
  showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
}
