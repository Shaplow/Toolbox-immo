/**
 * Modèle du tiroir « Nouveau lien de téléchargement » et de la carte « Liens de
 * téléchargement » de la fiche client.
 *
 * Tout ce qui se calcule vit ici, sans React ni DOM, pour être testé tel quel
 * (même découpage que `transcription/workspaceModel.ts`) :
 *  - les volumes selon les cases cochées (le serveur donne un aperçu par compte et
 *    par bibliothèque, on le somme ici à chaque clic — pas de nouvel appel) ;
 *  - le corps de la requête de création ;
 *  - les libellés d'une ligne de lien (contenu, validité, activité).
 */

import {
  DEFAULT_EXPORT_LINK_DURATION_DAYS,
  EXPORT_LINK_DURATIONS_DAYS,
  type CreateExportLinkRequest,
  type ExportLibraryType,
  type ExportLinkDurationDays,
  type ExportLinkStatus,
  type ExportLinkSummary,
  type ExportPreview,
  type ExportReport,
  type ExportSkipReason,
  type ExportVolume,
} from "@/lib/clientExport/types";
import { dateFr, parisDayKey, shortDateFr, timeFr } from "@/lib/date/formatFr";
import { formatMaxSize } from "@/lib/upload/limits";

// ─── Formatage ───────────────────────────────────────────────────────────────

const NUMBER_FR = new Intl.NumberFormat("fr-FR");

/** « 1 243 » (espace fine insécable, comme le reste de l'app en fr-FR). */
export function formatCount(n: number): string {
  return NUMBER_FR.format(n);
}

/** « 1 fichier », « 128 fichiers » : en français, 0 et 1 restent au singulier. */
export function pluralFr(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n >= 2 ? many : one}`;
}

/** Date courte, avec l'année seulement si ce n'est pas l'année en cours (à Paris). */
function dateShortSmart(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const sameYear = parisDayKey(date).slice(0, 4) === parisDayKey(now).slice(0, 4);
  return sameYear ? shortDateFr(date) : dateFr(date);
}

/** « 8 oct. à 14:32 » — l'heure compte pour une activité (un téléchargement dure des heures). */
function dateTimeSmart(iso: string, now: Date): string {
  if (Number.isNaN(new Date(iso).getTime())) return "—";
  return `${dateShortSmart(iso, now)} à ${timeFr(iso)}`;
}

// ─── Volumes ─────────────────────────────────────────────────────────────────

/**
 * Ce que la sélection courante représente. Les données (fiches) se comptent à
 * part des fichiers : un « .xlsx » par bibliothèque et par compte n'a pas de
 * taille connue d'avance, et « 210 fiches » n'est pas un nombre de fichiers.
 */
export interface SelectionVolume {
  files: number;
  bytes: number;
  entries: number;
}

export const EMPTY_VOLUME: SelectionVolume = { files: 0, bytes: 0, entries: 0 };

export function addVolumes(a: SelectionVolume, b: SelectionVolume): SelectionVolume {
  return { files: a.files + b.files, bytes: a.bytes + b.bytes, entries: a.entries + b.entries };
}

export function isEmptyVolume(volume: SelectionVolume): boolean {
  return volume.files === 0 && volume.entries === 0;
}

/** Les `ExportVolume` du serveur comptent des fiches pour une bibliothèque de données. */
function volumeOf(
  type: ExportLibraryType,
  volume: ExportVolume | null | undefined,
): SelectionVolume {
  if (!volume) return EMPTY_VOLUME;
  if (type === "data") return { files: 0, bytes: 0, entries: volume.files };
  return { files: volume.files, bytes: volume.bytes, entries: 0 };
}

export function formatFiles(n: number): string {
  return pluralFr(n, "fichier", "fichiers");
}

export function formatEntries(n: number): string {
  return pluralFr(n, "fiche", "fiches");
}

/**
 * « 1 243 fichiers · 162,4 Go · 210 fiches ». Les octets disparaissent quand
 * aucune taille n'est connue (« 5 fichiers » vaut mieux que « 5 fichiers · 0 o »).
 */
export function formatVolume(volume: SelectionVolume): string {
  const parts: string[] = [];
  if (volume.files > 0) {
    parts.push(formatFiles(volume.files));
    if (volume.bytes > 0) parts.push(formatMaxSize(volume.bytes));
  }
  if (volume.entries > 0) parts.push(formatEntries(volume.entries));
  return parts.length > 0 ? parts.join(" · ") : "Rien à exporter";
}

// ─── Publications non exportables ────────────────────────────────────────────

/**
 * Publications publiées mais non exportables, par motif (somme sur les comptes
 * cochés). Un post image est normal ; une vidéo introuvable demande une action :
 * un compteur unique les confondait.
 */
export type UnavailableCounts = Partial<Record<ExportSkipReason, number>>;

/**
 * Motifs dans l'ordre d'affichage : le cas normal (post image) d'abord, puis ce
 * qui est à corriger avant d'envoyer le lien.
 */
const UNAVAILABLE_REASONS: readonly ExportSkipReason[] = [
  "image_post",
  "no_video",
  "not_on_r2",
  "missing",
];

/** `Record` exhaustif : un nouveau motif côté serveur ne compile pas sans son libellé. */
const UNAVAILABLE_WORDING: Record<ExportSkipReason, { one: string; many: string }> = {
  image_post: { one: "post image (non inclus)", many: "posts image (non inclus)" },
  no_video: { one: "publication sans vidéo finale", many: "publications sans vidéo finale" },
  not_on_r2: {
    one: "vidéo hébergée hors du stockage",
    many: "vidéos hébergées hors du stockage",
  },
  missing: {
    one: "vidéo introuvable dans le stockage",
    many: "vidéos introuvables dans le stockage",
  },
};

function addUnavailable(
  total: UnavailableCounts,
  extra: UnavailableCounts | undefined,
): UnavailableCounts {
  if (!extra) return total;
  const next: UnavailableCounts = { ...total };
  for (const reason of UNAVAILABLE_REASONS) {
    const count = extra[reason] ?? 0;
    if (count > 0) next[reason] = (next[reason] ?? 0) + count;
  }
  return next;
}

/** « 2 posts image (non inclus) · 1 vidéo introuvable dans le stockage » ; null s'il n'y en a aucune. */
export function describeUnavailablePublications(counts: UnavailableCounts): string | null {
  const parts: string[] = [];
  for (const reason of UNAVAILABLE_REASONS) {
    const count = counts[reason] ?? 0;
    if (count <= 0) continue;
    const { one, many } = UNAVAILABLE_WORDING[reason];
    parts.push(pluralFr(count, one, many));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Y a-t-il quelque chose à corriger avant d'envoyer le lien ? Les posts image
 * sont hors du périmètre « Vidéos publiées » par construction : ils ne méritent
 * pas la couleur d'un avertissement.
 */
export function unavailableNeedsAction(counts: UnavailableCounts): boolean {
  return UNAVAILABLE_REASONS.some(
    (reason) => reason !== "image_post" && (counts[reason] ?? 0) > 0,
  );
}

/**
 * Vidéos et sons de la médiathèque absents du stockage. « De la médiathèque » :
 * les publications introuvables sont dites à part (`describeUnavailablePublications`),
 * le même fichier ne doit pas se lire comme compté deux fois.
 */
export function describeMissingFiles(count: number): string {
  return count >= 2
    ? `${formatCount(count)} fichiers de la médiathèque introuvables dans le stockage ne seront pas inclus.`
    : `${formatCount(count)} fichier de la médiathèque introuvable dans le stockage ne sera pas inclus.`;
}

// ─── Sélection du tiroir ─────────────────────────────────────────────────────

export type ExportContentKey = "video" | "audio" | "data" | "publications";

export const CONTENT_KEYS: readonly ExportContentKey[] = ["video", "audio", "data", "publications"];

export const CONTENT_META: Record<ExportContentKey, { label: string; hint: string }> = {
  video: { label: "Vidéos", hint: "Rushs et médias réservés à chaque compte" },
  audio: { label: "Sons", hint: "Pistes réservées aux comptes, et sons communs" },
  data: { label: "Données", hint: "Un fichier Excel par bibliothèque et par compte" },
  publications: { label: "Vidéos publiées", hint: "Vidéo finale de chaque publication publiée" },
};

const LIBRARY_TYPES: readonly ExportLibraryType[] = ["video", "audio", "data"];

/**
 * Les cases de l'admin. `contents` est une INTENTION : la case affichée dépend
 * aussi de ce qui est disponible (cf. `ContentRow.checked`), de sorte qu'un
 * contenu décoché puis redevenu disponible (on recoche un compte) retrouve
 * l'état voulu au lieu de rester éteint.
 */
export interface ExportDrawerSelection {
  contents: Readonly<Record<ExportContentKey, boolean>>;
  accountIds: ReadonlySet<string>;
  libraryIds: ReadonlySet<string>;
}

/** Tout coché : comptes, bibliothèques et contenus (les indisponibles s'éteignent seuls). */
export function defaultSelection(preview: ExportPreview): ExportDrawerSelection {
  return {
    contents: { video: true, audio: true, data: true, publications: true },
    accountIds: new Set(preview.accounts.map((account) => account.id)),
    libraryIds: new Set(preview.libraries.map((library) => library.id)),
  };
}

function withToggled(source: ReadonlySet<string>, ids: readonly string[], on: boolean): Set<string> {
  const next = new Set(source);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

export function setContent(
  selection: ExportDrawerSelection,
  key: ExportContentKey,
  on: boolean,
): ExportDrawerSelection {
  return { ...selection, contents: { ...selection.contents, [key]: on } };
}

export function setAccounts(
  selection: ExportDrawerSelection,
  ids: readonly string[],
  on: boolean,
): ExportDrawerSelection {
  return { ...selection, accountIds: withToggled(selection.accountIds, ids, on) };
}

export function setLibraries(
  selection: ExportDrawerSelection,
  ids: readonly string[],
  on: boolean,
): ExportDrawerSelection {
  return { ...selection, libraryIds: withToggled(selection.libraryIds, ids, on) };
}

// ─── Calcul du tiroir ────────────────────────────────────────────────────────

type PreviewLibrary = ExportPreview["libraries"][number];

export interface ContentRow {
  key: ExportContentKey;
  label: string;
  hint: string;
  /** Volume de la sélection courante : bibliothèques cochées × comptes cochés. */
  volume: SelectionVolume;
  /**
   * Il y a quelque chose à exporter pour les comptes cochés. Les cases de
   * bibliothèques sont ignorées exprès : décocher la dernière bibliothèque ne
   * doit pas éteindre la ligne, sinon on ne pourrait plus la recocher.
   */
  available: boolean;
  /** Case affichée : voulue par l'admin ET disponible. */
  checked: boolean;
  /** Publications publiées mais non exportables, par motif, comptes cochés (ligne « publications » ; vide sinon). */
  unavailable: UnavailableCounts;
}

export interface LibraryLine {
  id: string;
  name: string;
  type: ExportLibraryType;
  checked: boolean;
  /** Pour les comptes cochés, communs compris. */
  volume: SelectionVolume;
  /** Fichiers (sons) ou fiches (données) communs à tous les comptes ; 0 pour la vidéo. */
  common: number;
}

export interface LibraryGroup {
  type: ExportLibraryType;
  label: string;
  state: boolean | "indeterminate";
  libraries: LibraryLine[];
}

export interface AccountLine {
  id: string;
  name: string;
  handle: string;
  checked: boolean;
  /** Ce que ce compte apporte à la sélection de contenu courante (communs exclus). */
  volume: SelectionVolume;
}

/** Pourquoi on ne peut pas créer le lien, le cas échéant. */
export type ExportBlocker = "no_account" | "nothing_available" | "no_content";

export interface ExportModel {
  rows: ContentRow[];
  /** Bibliothèques à proposer : types cochés, non vides pour les comptes cochés. */
  groups: LibraryGroup[];
  accounts: AccountLine[];
  total: SelectionVolume;
  payload: Pick<
    CreateExportLinkRequest,
    "accountIds" | "mediaLibraryIds" | "dataLibraryIds" | "includePublications"
  >;
  blocker: ExportBlocker | null;
}

/**
 * Volume d'une bibliothèque pour les comptes cochés. Les communs ne partent
 * qu'UNE fois, dans le dossier « Commun », quel que soit le nombre de comptes :
 * ils s'ajoutent à la somme, ils ne se multiplient pas.
 */
function libraryVolume(library: PreviewLibrary, accountIds: ReadonlySet<string>): SelectionVolume {
  let total = volumeOf(library.type, library.common);
  for (const id of accountIds) {
    total = addVolumes(total, volumeOf(library.type, library.perAccount[id]));
  }
  return total;
}

export function computeExportModel(
  preview: ExportPreview,
  selection: ExportDrawerSelection,
): ExportModel {
  const { accountIds, libraryIds } = selection;

  const libraryVolumes = new Map<string, SelectionVolume>();
  for (const library of preview.libraries) {
    libraryVolumes.set(library.id, libraryVolume(library, accountIds));
  }

  const rows = CONTENT_KEYS.map((key): ContentRow => {
    const meta = CONTENT_META[key];

    if (key === "publications") {
      let volume = EMPTY_VOLUME;
      let unavailable: UnavailableCounts = {};
      for (const id of accountIds) {
        volume = addVolumes(volume, volumeOf("video", preview.publications.perAccount[id]));
        unavailable = addUnavailable(unavailable, preview.publications.unavailable[id]);
      }
      const available = volume.files > 0;
      return { key, ...meta, volume, available, checked: selection.contents[key] && available, unavailable };
    }

    let volume = EMPTY_VOLUME;
    let available = false;
    for (const library of preview.libraries) {
      if (library.type !== key) continue;
      const libraryTotal = libraryVolumes.get(library.id) ?? EMPTY_VOLUME;
      if (!isEmptyVolume(libraryTotal)) available = true;
      if (libraryIds.has(library.id)) volume = addVolumes(volume, libraryTotal);
    }
    return { key, ...meta, volume, available, checked: selection.contents[key] && available, unavailable: {} };
  });

  const checkedKeys = new Set(rows.filter((row) => row.checked).map((row) => row.key));

  const groups = LIBRARY_TYPES.filter((type) => checkedKeys.has(type)).map((type): LibraryGroup => {
    const libraries: LibraryLine[] = [];
    for (const library of preview.libraries) {
      if (library.type !== type) continue;
      const volume = libraryVolumes.get(library.id) ?? EMPTY_VOLUME;
      // Une bibliothèque vide pour ces comptes n'a rien à proposer : on la masque.
      if (isEmptyVolume(volume)) continue;
      libraries.push({
        id: library.id,
        name: library.name,
        type,
        checked: libraryIds.has(library.id),
        volume,
        common: library.common?.files ?? 0,
      });
    }
    const checkedCount = libraries.filter((line) => line.checked).length;
    const state =
      checkedCount === 0 ? false : checkedCount === libraries.length ? true : "indeterminate";
    return { type, label: CONTENT_META[type].label, state, libraries };
  });

  // Le volume d'un compte suit l'INTENTION de l'admin (cases de contenu), pas la
  // case affichée : celle-ci s'éteint quand les comptes cochés n'ont rien à
  // exporter, et un compte décoché afficherait alors un volume amputé de ce
  // qu'il apporterait en le recochant (« Rien à exporter » pour un compte qui a
  // des centaines de vidéos).
  const wantedLibraries = preview.libraries.filter(
    (library) => selection.contents[library.type] && libraryIds.has(library.id),
  );
  const accounts = preview.accounts.map((account): AccountLine => {
    let volume = EMPTY_VOLUME;
    for (const library of wantedLibraries) {
      volume = addVolumes(volume, volumeOf(library.type, library.perAccount[account.id]));
    }
    if (selection.contents.publications) {
      volume = addVolumes(volume, volumeOf("video", preview.publications.perAccount[account.id]));
    }
    return {
      id: account.id,
      name: account.name,
      handle: account.handle,
      checked: accountIds.has(account.id),
      volume,
    };
  });

  const total = rows
    .filter((row) => row.checked)
    .reduce((sum, row) => addVolumes(sum, row.volume), EMPTY_VOLUME);

  // « Ce qu'on voit est ce qu'on envoie » : seules les bibliothèques affichées
  // (types cochés, non vides) et cochées partent dans le lien. Une bibliothèque
  // masquée, que l'admin ne peut ni voir ni décocher, n'a pas à y figurer.
  const sentIds = (type: ExportLibraryType): string[] =>
    (groups.find((group) => group.type === type)?.libraries ?? [])
      .filter((line) => line.checked)
      .map((line) => line.id);

  const payload = {
    accountIds: preview.accounts.filter((a) => accountIds.has(a.id)).map((a) => a.id),
    mediaLibraryIds: [...sentIds("video"), ...sentIds("audio")],
    dataLibraryIds: sentIds("data"),
    includePublications: checkedKeys.has("publications"),
  };

  let blocker: ExportBlocker | null = null;
  if (payload.accountIds.length === 0) blocker = "no_account";
  else if (rows.every((row) => !row.available)) blocker = "nothing_available";
  else if (
    payload.mediaLibraryIds.length === 0 &&
    payload.dataLibraryIds.length === 0 &&
    !payload.includePublications
  ) {
    blocker = "no_content";
  }

  return { rows, groups, accounts, total, payload, blocker };
}

// ─── Création ────────────────────────────────────────────────────────────────

export const DURATION_OPTIONS = EXPORT_LINK_DURATIONS_DAYS.map((days) => ({
  value: String(days),
  label: days === 1 ? "1 jour" : `${days} jours`,
}));

/** Le Select rend une chaîne ; la requête attend l'une des durées autorisées. */
export function parseDuration(value: string): ExportLinkDurationDays {
  return (
    EXPORT_LINK_DURATIONS_DAYS.find((days) => String(days) === value) ??
    DEFAULT_EXPORT_LINK_DURATION_DAYS
  );
}

/** null tant que la sélection ne permet pas de créer un lien (cf. `blocker`). */
export function buildCreateRequest(
  model: ExportModel,
  expiresInDays: ExportLinkDurationDays,
  label: string,
): CreateExportLinkRequest | null {
  if (model.blocker) return null;
  const trimmed = label.trim();
  return { label: trimmed === "" ? null : trimmed, expiresInDays, ...model.payload };
}

/** Adresse à partager au client. L'origine est celle de l'admin : la même app sert le lien. */
export function exportLinkUrl(origin: string, rawToken: string): string {
  return `${origin}/export/${rawToken}`;
}

/** Libellé d'une bibliothèque : « dont 12 communs » (sons) / « dont 3 communes » (fiches). */
export function formatCommon(line: Pick<LibraryLine, "type" | "common">): string | null {
  if (line.common <= 0 || line.type === "video") return null;
  const feminine = line.type === "data";
  const plural = line.common >= 2;
  const word = feminine
    ? plural ? "communes" : "commune"
    : plural ? "communs" : "commun";
  return `dont ${formatCount(line.common)} ${word}`;
}

// ─── Carte « Liens de téléchargement » ───────────────────────────────────────

export type LinkAction = "rotate" | "extend" | "revoke";

/** Prolongation proposée par le menu d'une ligne. */
export const EXTEND_LINK_DAYS: ExportLinkDurationDays = 7;

/** Bouton d'en-tête de la carte : crée un AUTRE lien (sélection à refaire, les liens existants restent actifs). */
export const CREATE_LINK_LABEL = "Nouveau lien";

/**
 * Items du menu ⋯ d'une ligne. Aucun ne reprend « Nouveau lien » : l'admin qui
 * avait perdu une adresse cliquait le bouton d'en-tête, plus visible, et créait
 * un second lien alors que le premier, dont personne n'avait l'adresse, restait
 * actif. « Prolonger de 7 jours » et « Révoquer » servent aussi de poignées e2e.
 */
export const LINK_ACTION_LABELS: Record<LinkAction, string> = {
  rotate: "Régénérer l'adresse",
  extend: `Prolonger de ${EXTEND_LINK_DAYS} jours`,
  revoke: "Révoquer",
};

/**
 * Où retrouver l'action, à citer dans les aides (« Si tu le perds, utilise … ») :
 * elles pointent vers le libellé réel du menu au lieu de le recopier.
 */
export const ROTATE_HINT = `« ${LINK_ACTION_LABELS.rotate} » dans le menu ⋯ du lien`;

/**
 * Un lien actif peut être régénéré, prolongé ou révoqué ; un lien expiré peut
 * être prolongé (ou révoqué pour de bon) ; un lien révoqué est définitif.
 */
export function linkActions(status: ExportLinkStatus): LinkAction[] {
  if (status === "active") return ["rotate", "extend", "revoke"];
  if (status === "expired") return ["extend", "revoke"];
  return [];
}

export const LINK_STATUS_BADGE: Record<
  ExportLinkStatus,
  { label: string; variant: "success" | "warning" | "default" }
> = {
  active: { label: "Actif", variant: "success" },
  expired: { label: "Expiré", variant: "warning" },
  revoked: { label: "Révoqué", variant: "default" },
};

export function linkTitle(link: ExportLinkSummary, now: Date = new Date()): string {
  return link.label?.trim() || `Lien du ${dateShortSmart(link.createdAt, now)}`;
}

export function describeLinkCreation(link: ExportLinkSummary): string {
  const author = link.createdBy?.name?.trim();
  return `Créé le ${dateFr(link.createdAt)}${author ? ` par ${author}` : ""}`;
}

/**
 * « 3 comptes · 2 biblio. vidéo · 1 biblio. son · 1 biblio. données · publications »
 *
 * Ces nombres comptent des BIBLIOTHÈQUES, pas des fichiers : « 2 sons » se lisait
 * comme deux pistes, « 1 données » était agrammatical. « biblio. » est une
 * abréviation, donc invariable au pluriel.
 */
export function describeLinkContent(link: ExportLinkSummary): string {
  const parts = [pluralFr(link.accountIds.length, "compte", "comptes")];
  if (link.libraries.video > 0) parts.push(`${formatCount(link.libraries.video)} biblio. vidéo`);
  if (link.libraries.audio > 0) parts.push(`${formatCount(link.libraries.audio)} biblio. son`);
  if (link.libraries.data > 0) parts.push(`${formatCount(link.libraries.data)} biblio. données`);
  if (link.includePublications) parts.push("publications");
  return parts.join(" · ");
}

/** « Expire le 13 oct. » / « Expiré le 13 oct. » / « Révoqué le 7 oct. » */
export function describeLinkValidity(link: ExportLinkSummary, now: Date = new Date()): string {
  switch (link.status) {
    case "revoked":
      return `Révoqué le ${dateShortSmart(link.revokedAt ?? link.expiresAt, now)}`;
    case "expired":
      return `Expiré le ${dateShortSmart(link.expiresAt, now)}`;
    default:
      return `Expire le ${dateShortSmart(link.expiresAt, now)}`;
  }
}

/** Jusqu'à quand le lien tout juste créé reste valable (affiché sous « Lien créé »). */
export function describeExpiry(expiresAt: string, now: Date = new Date()): string {
  return `Valable jusqu'au ${dateTimeSmart(expiresAt, now)}.`;
}

function timeOf(iso: string): number {
  return new Date(iso).getTime();
}

/**
 * Octets livrés, quand le bilan permet de l'affirmer. Il ne compte que ce qui a
 * été écrit pendant la DERNIÈRE session : après une reprise (startCount > 1), ou
 * dans un dossier déjà garni (fichiers sautés), ce n'est qu'une part du volume.
 * Mieux vaut n'afficher aucun chiffre qu'un faux.
 */
function deliveredBytes(link: ExportLinkSummary, report: ExportReport): number | null {
  if (report.bytes <= 0 || report.skipped > 0 || link.startCount > 1) return null;
  return report.bytes;
}

/**
 * Ce que le client a fait du lien : l'ÉTAT COURANT, pas le meilleur état atteint
 * (un client qui revient et relance après un « terminé » redevient « lancé »).
 *
 * Lit les champs comme `recordExportEvent` les écrit (cf. `ExportLinkSummary`) :
 * `downloadStartedAt` est le DERNIER lancement, `downloadCompletedAt` la dernière
 * session terminée SANS échec, `lastReport` le bilan de la dernière session
 * finie (terminée ou arrêtée), remis à null à chaque lancement. D'où :
 *  - fin sans échec, aucun lancement depuis → « Terminé » ;
 *  - bilan sans fin propre → « incomplet ». Le serveur ne distingue pas une
 *    session arrêtée d'une session terminée avec des échecs : le mot couvre les
 *    deux, les chiffres disent lequel ;
 *  - lancé sans bilan (en cours, ou onglet fermé) → « lancé » ;
 *  - sinon ouvert, ou jamais ouvert.
 */
export function describeLinkActivity(link: ExportLinkSummary, now: Date = new Date()): string {
  const started = link.downloadStartedAt;
  const completed = link.downloadCompletedAt;
  const report = link.lastReport;

  // Une fin plus ancienne que le dernier lancement date d'une session
  // précédente : elle ne dit rien de la session courante.
  if (completed !== null && (started === null || timeOf(started) <= timeOf(completed))) {
    const parts = [`Terminé le ${dateTimeSmart(completed, now)}`];
    if (report) {
      parts.push(formatFiles(report.files));
      const bytes = deliveredBytes(link, report);
      if (bytes !== null) parts.push(formatMaxSize(bytes));
    }
    return parts.join(" · ");
  }

  if (report) {
    const parts = ["Téléchargement incomplet", formatFiles(report.files)];
    if (report.failed > 0) parts.push(`${formatCount(report.failed)} en échec`);
    // Le serveur ne garde pas l'heure de l'arrêt : seul le lancement situe la session.
    if (started) parts.push(`lancé le ${dateTimeSmart(started, now)}`);
    return parts.join(" · ");
  }

  if (started) {
    const parts = [`Téléchargement lancé le ${dateTimeSmart(started, now)}`];
    // Le premier lancement n'est pas une reprise.
    if (link.startCount > 1) parts.push(pluralFr(link.startCount - 1, "reprise", "reprises"));
    return parts.join(" · ");
  }

  const opened = link.lastOpenedAt ?? link.firstOpenedAt;
  if (opened) return `Ouvert le ${dateTimeSmart(opened, now)}`;
  return "Jamais ouvert";
}
