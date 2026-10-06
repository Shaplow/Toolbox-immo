/**
 * Arborescence écrite chez le client, à partir des éléments résolus côté serveur.
 *
 *   <Client>/<Compte>/<Bibliothèque>/<Dossier>/<fichier>
 *   <Client>/<Compte>/Publications/<YYYY-MM-DD> - <libellé>.mp4
 *   <Client>/<Compte>/<Bibliothèque de données>/<Bibliothèque de données>.xlsx
 *   <Client>/Commun/<Bibliothèque>/…   (sons et fiches communs à tous les comptes)
 *
 * Deux exigences gouvernent tout le module :
 *
 * - STABLE : un téléchargement de 150 Go se reprend (même jour, autre jour) en
 *   retrouvant les fichiers par leur chemin. Aucun nom ne dépend de l'ordre de
 *   l'entrée, tous les départages passent par des clés propres aux données, et
 *   un nom n'est calculé qu'une fois (un Dossier ne le reçoit pas fichier par
 *   fichier, une bibliothèque pas compte par compte).
 * - ACCEPTÉ PAR LE DISQUE : segments assainis pour Chrome / Windows / macOS
 *   (naming.ts), homonymes départagés sans tenir compte de la casse (NTFS, APFS)
 *   et chemin relatif borné — Chrome n'est pas `longPathAware`, la limite de
 *   260 caractères de Windows s'applique au dossier de base choisi PLUS ce chemin.
 *
 * Pur : aucun import serveur (ce module est aussi chargé dans le navigateur).
 */

import { parisDayKey } from "@/lib/date/formatFr";
import {
  cleanFsaText,
  dedupeName,
  nameKey,
  sanitizeFsaFileName,
  sanitizeFsaSegment,
  splitExtension,
  truncateFileName,
  truncateSegment,
} from "./naming";
import type {
  DataExportItem,
  ExportItem,
  ExportLibraryType,
  ManifestFile,
  MediaExportItem,
  PublicationExportItem,
  TreeAccount,
  TreeLibrary,
} from "./types";

/** Dossier racine des éléments qui n'appartiennent à aucun compte (sons et fiches communs). */
export const COMMON_FOLDER = "Commun";
/** Dossier des vidéos publiées, sous chaque compte. */
export const PUBLICATIONS_FOLDER = "Publications";
/** Longueur maximale d'un dossier (racine, compte, bibliothèque, Dossier). */
export const MAX_FOLDER_SEGMENT = 40;
/** Chemin relatif complet : dossier racine et séparateurs compris. */
export const MAX_RELATIVE_PATH = 200;

/** Plafond d'un nom de fichier, extension comprise, même quand le chemin le permettrait. */
const MAX_FILE_NAME = 100;
/** Plancher du budget d'un nom de fichier, quel que soit le chemin qui le précède. */
const MIN_FILE_NAME = 24;

/** Ordre d'attribution des noms de bibliothèque : vidéo, puis son, puis données. */
const LIBRARY_TYPE_ORDER: Record<ExportLibraryType, number> = { video: 0, audio: 1, data: 2 };

const collator = new Intl.Collator("fr");

/** Comparaison indépendante de la locale, pour les départages qui doivent rester les mêmes partout. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Instant d'une date ISO ; 0 si illisible (le départage retombe alors sur l'id). */
function timeOf(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Dossier de l'arbre : nom assaini puis tronqué à MAX_FOLDER_SEGMENT. */
function folderSegment(raw: string | null | undefined, fallback: string): string {
  return truncateSegment(sanitizeFsaSegment(raw, fallback), MAX_FOLDER_SEGMENT);
}

/**
 * Budget d'un nom de fichier posé sous `prefix` : ce qui reste des
 * MAX_RELATIVE_PATH après les dossiers et leurs séparateurs, entre le plancher
 * et le plafond. Avec des dossiers plafonnés à 40, le plancher n'intervient
 * jamais (4 × 41 = 164 → 36 restent) : il protège seulement d'un futur réglage.
 */
function fileBudget(prefix: readonly string[]): number {
  const used = prefix.reduce((sum, segment) => sum + segment.length + 1, 0);
  return Math.max(MIN_FILE_NAME, Math.min(MAX_FILE_NAME, MAX_RELATIVE_PATH - used));
}

/** Extension d'après la clé R2 (dernier segment) ; "" si elle n'en a pas. */
function extensionOfKey(r2Key: string): string {
  return splitExtension(r2Key.slice(r2Key.lastIndexOf("/") + 1)).ext;
}

// ─── Comptes ──────────────────────────────────────────────────────────────────

/**
 * « Nom (@handle) », le nom étant raccourci pour que « (@handle) » reste entier :
 * c'est lui qui départage deux comptes homonymes.
 */
function accountNameWithHandle(account: TreeAccount, fullName: string): string {
  const tag = `@${cleanFsaText(account.handle) || account.id.slice(-6)}`;
  // Le nom EST le handle (compte sans nom) : rien à ajouter, les handles sont uniques.
  if (nameKey(fullName) === nameKey(tag)) return truncateSegment(fullName, MAX_FOLDER_SEGMENT);
  const suffix = ` (${tag})`;
  if (suffix.length >= MAX_FOLDER_SEGMENT) return truncateSegment(tag, MAX_FOLDER_SEGMENT);
  return `${truncateSegment(fullName, MAX_FOLDER_SEGMENT - suffix.length)}${suffix}`;
}

/**
 * Dossier de chaque compte. Deux comptes dont les noms ne diffèrent que par la
 * casse (« Sarah » / « sarah »), ou un compte qui s'appellerait « Commun »,
 * deviennent TOUS « Nom (@handle) » : aucun ne garde le nom nu, que le client
 * confondrait avec l'autre. Une collision résiduelle est départagée dans un ordre
 * indépendant de l'entrée.
 */
function resolveAccountFolders(accounts: TreeAccount[]): Map<string, string> {
  const commonKey = nameKey(COMMON_FOLDER);
  const prepared = accounts.map((account) => {
    const fallback = `@${account.handle}`;
    const fullName = sanitizeFsaSegment(account.name, fallback);
    return { account, fullName, key: nameKey(truncateSegment(fullName, MAX_FOLDER_SEGMENT)) };
  });

  const sizeOfGroup = new Map<string, number>();
  for (const { key } of prepared) sizeOfGroup.set(key, (sizeOfGroup.get(key) ?? 0) + 1);

  const candidates = prepared.map(({ account, fullName, key }) => ({
    account,
    name:
      (sizeOfGroup.get(key) ?? 0) > 1 || key === commonKey
        ? accountNameWithHandle(account, fullName)
        : truncateSegment(fullName, MAX_FOLDER_SEGMENT),
  }));

  candidates.sort(
    (a, b) =>
      compareText(nameKey(a.name), nameKey(b.name)) ||
      compareText(a.account.handle, b.account.handle) ||
      compareText(a.account.id, b.account.id),
  );

  const taken = new Set([commonKey]);
  const folders = new Map<string, string>();
  for (const { account, name } of candidates) {
    if (folders.has(account.id)) continue;
    folders.set(account.id, dedupeName(name, taken, { max: MAX_FOLDER_SEGMENT }));
  }
  return folders;
}

// ─── Bibliothèques ────────────────────────────────────────────────────────────

/**
 * Nom de chaque bibliothèque, calculé UNE fois pour tout l'export : le même
 * sous chaque compte et sous « Commun », et le même d'une reprise à l'autre.
 * Ordre d'attribution : vidéo, son, données, nom, id. « Publications » est
 * réservé (dossier des vidéos publiées, au même niveau).
 */
function resolveLibraryFolders(libraries: TreeLibrary[]): Map<string, string> {
  const sorted = [...libraries].sort(
    (a, b) =>
      (LIBRARY_TYPE_ORDER[a.type] ?? 3) - (LIBRARY_TYPE_ORDER[b.type] ?? 3) ||
      compareText(a.name, b.name) ||
      compareText(a.id, b.id),
  );
  const taken = new Set([nameKey(PUBLICATIONS_FOLDER)]);
  const folders = new Map<string, string>();
  for (const library of sorted) {
    if (folders.has(library.id)) continue;
    const name = folderSegment(library.name, "Bibliothèque");
    folders.set(library.id, dedupeName(name, taken, { max: MAX_FOLDER_SEGMENT }));
  }
  return folders;
}

// ─── Fichiers ─────────────────────────────────────────────────────────────────

/** Nom d'un média : nom d'origine, extension corrigée (média réécrit en MP4) ou déduite de la clé R2. */
function mediaFileName(item: MediaExportItem): { stem: string; ext: string } {
  // Nettoyé AVANT de chercher l'extension : « clip.mp4 » suivi d'un espace en garde une.
  const { stem, ext } = splitExtension(cleanFsaText(item.filename));
  let finalExt = ext;
  // media_edit réécrit le fichier en MP4 sous l'ancien nom (« rush.mov » contient du MP4).
  if (item.edited) finalExt = "mp4";
  else if (!finalExt) finalExt = extensionOfKey(item.r2Key ?? "") || "bin";
  return sanitizeFsaFileName(stem, finalExt, "fichier");
}

/** Nom d'une publication : « YYYY-MM-DD - libellé[ - fiche].ext », le jour étant celui de Paris. */
function publicationFileName(item: PublicationExportItem): { stem: string; ext: string } {
  const day = parisDayKey(item.date) || "Sans date";
  const label = cleanFsaText(item.label) || "Publication";
  const parts = [day, label];
  const entity = cleanFsaText(item.entityLabel);
  if (entity && nameKey(entity) !== nameKey(label)) parts.push(entity);
  const ext = splitExtension(cleanFsaText(item.fileName)).ext || extensionOfKey(item.r2Key ?? "") || "mp4";
  return sanitizeFsaFileName(parts.join(" - "), ext, "Publication");
}

/**
 * Nom d'un fichier de publication déjà pris : le départage porte sur les 6
 * derniers caractères du slotId (stables d'une reprise à l'autre, contrairement
 * à un compteur), glissés avant l'extension sans dépasser le budget.
 */
function withSlotSuffix(stem: string, ext: string, slotId: string, max: number): string {
  const tail = cleanFsaText(slotId.slice(-6));
  return truncateFileName(stem, ext, max, tail ? ` - ${tail}` : "");
}

// ─── Arbre ────────────────────────────────────────────────────────────────────

/** Éléments d'un dossier de bibliothèque : médias (et leurs Dossiers) ou fichier de données. */
interface LibraryDir {
  accountDir: string;
  libraryFolder: string;
  media: MediaExportItem[];
  data: DataExportItem[];
}

/** Une ref ne désigne qu'un fichier : un doublon est écarté, dans un ordre indépendant de l'entrée. */
function uniqueByRef(items: ExportItem[]): ExportItem[] {
  const seen = new Set<string>();
  const unique: ExportItem[] = [];
  for (const item of [...items].sort((a, b) => compareText(a.ref, b.ref))) {
    if (seen.has(item.ref)) continue;
    seen.add(item.ref);
    unique.push(item);
  }
  return unique;
}

/** Bibliothèques reçues, plus celles que des éléments citent sans les avoir déclarées (nom neutre plutôt que fichier perdu). */
function withUndeclaredLibraries(libraries: TreeLibrary[], items: ExportItem[]): TreeLibrary[] {
  const known = new Set(libraries.map((library) => library.id));
  const extra: TreeLibrary[] = [];
  for (const item of items) {
    if (item.kind === "publication" || known.has(item.libraryId)) continue;
    known.add(item.libraryId);
    extra.push({
      id: item.libraryId,
      name: "Bibliothèque",
      type: item.kind === "data" ? "data" : item.libraryType,
    });
  }
  return [...libraries, ...extra];
}

export function buildExportTree(input: {
  clientName: string;
  accounts: TreeAccount[];
  libraries: TreeLibrary[];
  items: ExportItem[];
}): { rootName: string; files: ManifestFile[] } {
  const rootName = folderSegment(input.clientName, "Export");
  const items = uniqueByRef(input.items);

  const libraryFolders = resolveLibraryFolders(withUndeclaredLibraries(input.libraries, items));

  // Seuls les comptes qui ont au moins un élément reçoivent un dossier.
  const knownAccounts = new Map(input.accounts.map((account) => [account.id, account]));
  const usedAccounts = new Map<string, TreeAccount>();
  for (const item of items) {
    if (item.accountId === null || usedAccounts.has(item.accountId)) continue;
    usedAccounts.set(
      item.accountId,
      knownAccounts.get(item.accountId) ?? { id: item.accountId, name: "Compte", handle: item.accountId },
    );
  }
  const accountFolders = resolveAccountFolders([...usedAccounts.values()]);
  const accountDirOf = (accountId: string | null): string =>
    accountId === null ? COMMON_FOLDER : (accountFolders.get(accountId) ?? COMMON_FOLDER);

  // Regroupement par dossier de destination.
  const libraryDirs = new Map<string, LibraryDir>();
  const publicationDirs = new Map<string, PublicationExportItem[]>();
  for (const item of items) {
    const accountDir = accountDirOf(item.accountId);
    if (item.kind === "publication") {
      const group = publicationDirs.get(accountDir) ?? [];
      group.push(item);
      publicationDirs.set(accountDir, group);
      continue;
    }
    const libraryFolder = libraryFolders.get(item.libraryId) ?? "Bibliothèque";
    const key = `${accountDir}\u0000${libraryFolder}`;
    const dir = libraryDirs.get(key) ?? { accountDir, libraryFolder, media: [], data: [] };
    if (item.kind === "media") dir.media.push(item);
    else dir.data.push(item);
    libraryDirs.set(key, dir);
  }

  const files: ManifestFile[] = [];

  for (const dir of libraryDirs.values()) {
    const base = [rootName, dir.accountDir, dir.libraryFolder];
    // Un seul ensemble de noms pris par dossier de bibliothèque : ses sous-dossiers
    // ET ses fichiers directs, qui ne peuvent pas porter le même nom.
    const taken = new Set<string>();

    // Fichiers de données : un .xlsx portant le nom du dossier de la bibliothèque.
    const dataBudget = fileBudget(base);
    for (const item of [...dir.data].sort((a, b) => compareText(a.ref, b.ref))) {
      // Le dossier est déjà assaini : le nom du fichier n'a rien à ajouter.
      const name = dedupeName(truncateFileName(dir.libraryFolder, "xlsx", dataBudget), taken, {
        isFile: true,
        max: dataBudget,
      });
      files.push({ ref: item.ref, kind: "data", path: [...base, name], size: null });
    }

    // Dossiers : chaque nom est attribué une seule fois, dans un ordre qui ne dépend que des noms.
    const rawFolders = new Map<string | null, MediaExportItem[]>();
    for (const item of dir.media) {
      const raw = item.folder?.trim() || null;
      const group = rawFolders.get(raw) ?? [];
      group.push(item);
      rawFolders.set(raw, group);
    }
    const folderNames = new Map<string, string>();
    const namedFolders = [...rawFolders.keys()]
      .filter((raw): raw is string => raw !== null)
      .map((raw) => ({ raw, name: folderSegment(raw, "Dossier") }))
      .sort((a, b) => compareText(nameKey(a.name), nameKey(b.name)) || compareText(a.raw, b.raw));
    for (const { raw, name } of namedFolders) {
      folderNames.set(raw, dedupeName(name, taken, { max: MAX_FOLDER_SEGMENT }));
    }

    // Les Dossiers sont déjà nommés : un fichier de la racine qui leur est homonyme cède.
    for (const [raw, group] of rawFolders) {
      const prefix = raw === null ? base : [...base, folderNames.get(raw) as string];
      const folderTaken = raw === null ? taken : new Set<string>();
      const budget = fileBudget(prefix);
      const ordered = [...group].sort(
        (a, b) =>
          timeOf(a.createdAt) - timeOf(b.createdAt) ||
          compareText(a.assetId, b.assetId) ||
          compareText(a.ref, b.ref),
      );
      for (const item of ordered) {
        const { stem, ext } = mediaFileName(item);
        // Tronqué AVANT de dédoublonner ; `max` garde le suffixe « (2) » dans le budget.
        const name = dedupeName(truncateFileName(stem, ext, budget), folderTaken, { isFile: true, max: budget });
        files.push({ ref: item.ref, kind: "media", path: [...prefix, name], size: item.sizeBytes });
      }
    }
  }

  for (const [accountDir, group] of publicationDirs) {
    const prefix = [rootName, accountDir, PUBLICATIONS_FOLDER];
    const budget = fileBudget(prefix);
    const taken = new Set<string>();
    const ordered = [...group].sort(
      (a, b) => timeOf(a.date) - timeOf(b.date) || compareText(a.slotId, b.slotId) || compareText(a.ref, b.ref),
    );
    for (const item of ordered) {
      const { stem, ext } = publicationFileName(item);
      let name = truncateFileName(stem, ext, budget);
      // Premier arrivé garde le nom nu ; les suivants portent la fin de leur slotId.
      if (taken.has(nameKey(name))) name = withSlotSuffix(stem, ext, item.slotId, budget);
      name = dedupeName(name, taken, { isFile: true, max: budget });
      files.push({ ref: item.ref, kind: "publication", path: [...prefix, name], size: item.sizeBytes });
    }
  }

  // Tri par chemin complet (localeCompare « fr ») ; la ref, unique, rend l'ordre total.
  const sorted = files
    .map((file) => ({ file, key: file.path.join("/") }))
    .sort((a, b) => collator.compare(a.key, b.key) || compareText(a.file.ref, b.file.ref))
    .map(({ file }) => file);

  return { rootName, files: sorted };
}
