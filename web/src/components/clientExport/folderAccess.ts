/**
 * Un dossier mémorisé existe-t-il encore ?
 *
 * Un handle survit à la suppression ou au déplacement du dossier, et
 * `queryPermission` répond « accordé » malgré tout : le moteur ne s'en rendrait
 * compte qu'à l'écriture de chaque fichier, puis réessaierait chacun d'eux
 * (2 s + 8 s + 30 s) avant de le déclarer en échec. Un seul pas d'itération
 * sur le dossier le détecte tout de suite, avant de lancer quoi que ce soit.
 */

function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && typeof (error as { name?: unknown }).name === "string"
    ? (error as { name: string }).name
    : "";
}

export async function isFolderReachable(handle: FileSystemDirectoryHandle): Promise<boolean> {
  // `keys()` n'est pas dans les types DOM du projet ; Chromium l'expose.
  const directory = handle as unknown as { keys?: () => AsyncIterable<string> };
  if (typeof directory.keys !== "function") return true;

  try {
    const iterator = directory.keys()[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    return true;
  } catch (error) {
    // Seul « introuvable » prouve que le dossier a disparu ; toute autre erreur
    // (droit retiré…) est laissée au moteur, qui sait la nommer.
    return errorName(error) !== "NotFoundError";
  }
}
