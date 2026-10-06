/**
 * Modèle d'affichage de la page publique /export/[token] : libellés,
 * regroupements et calculs purs.
 *
 * Séparé des composants pour être testé sans navigateur (vitest tourne en
 * environnement node) : tout ce qui décide d'un chiffre ou d'une phrase montrée
 * au client vit ici. Les tailles passent par `formatMaxSize` (virgule FR, unités
 * Go / Mo), comme partout ailleurs dans l'app.
 */

import { formatMaxSize } from "@/lib/upload/limits";
import type { EngineProgress } from "@/lib/clientExport/downloadEngine";
import type { ExportReport, ExportSkipReason, ManifestFile } from "@/lib/clientExport/types";

// ─── Nombres et durées ───────────────────────────────────────────────────────

const NUMBER_FR = new Intl.NumberFormat("fr-FR");

/** « 1 243 » (espace fine insécable, comme le reste de l'app). */
export function formatCount(n: number): string {
  return NUMBER_FR.format(n);
}

/**
 * « 1 fichier », « 1 243 fichiers ». Le français garde le singulier jusqu'à
 * 1,99 : « 0 fichier » est correct.
 */
export function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n >= 2 ? many : one}`;
}

/** « 12,4 Mo/s » */
export function formatRate(bytesPerSecond: number): string {
  return `${formatMaxSize(Math.max(0, Math.round(bytesPerSecond)))}/s`;
}

/**
 * Durée restante lisible par un non-technicien : pas de secondes, pas de
 * fausse précision sur un téléchargement de plusieurs heures.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 45) return "moins d'une minute";
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 48) return `plus de ${Math.floor(hours / 24)} jours`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

// ─── Récapitulatif du manifeste ──────────────────────────────────────────────

/** Nom du dossier des contenus partagés entre comptes (réservé par le serveur). */
export const COMMON_FOLDER_NAME = "Commun";

/** Chemin trop court pour contenir un compte (ne devrait pas arriver). */
const OTHER_FILES_LABEL = "Autres fichiers";

export interface AccountGroup {
  /** Nom du dossier de premier niveau (compte, ou « Commun »). */
  name: string;
  files: number;
  /** Somme des tailles connues. */
  bytes: number;
  common: boolean;
}

/**
 * Regroupe les fichiers par dossier de premier niveau sous la racine
 * (`path[1]` : le compte, ou « Commun »). Ordre du manifeste conservé, sauf
 * « Commun » rangé en dernier : ce sont les contenus partagés, pas un compte.
 */
export function groupByAccount(files: ManifestFile[]): AccountGroup[] {
  const groups = new Map<string, AccountGroup>();
  for (const file of files) {
    const name = file.path.length > 2 ? file.path[1] : OTHER_FILES_LABEL;
    let group = groups.get(name);
    if (!group) {
      group = { name, files: 0, bytes: 0, common: name === COMMON_FOLDER_NAME };
      groups.set(name, group);
    }
    group.files += 1;
    group.bytes += file.size ?? 0;
  }
  const all = [...groups.values()];
  return [...all.filter((g) => !g.common), ...all.filter((g) => g.common)];
}

const SKIP_REASON_LABELS: Record<ExportSkipReason, string> = {
  missing: "fichier introuvable",
  not_on_r2: "vidéo indisponible",
  no_video: "vidéo indisponible",
  image_post: "publication image",
};

export function skipReasonLabel(reason: ExportSkipReason): string {
  // Une raison ajoutée côté serveur plus tard ne doit pas afficher « undefined ».
  return SKIP_REASON_LABELS[reason] ?? "indisponible";
}

/** Fin du chemin d'un fichier : « Cuisine / rush-01.mov ». */
export function shortPath(path: string[]): string {
  return path.slice(-2).join(" / ");
}

/** Chemin sans le dossier racine : « Sarah / Behind the scene / Cuisine / rush-01.mov ». */
export function fullPath(path: string[]): string {
  return path.slice(1).join(" / ");
}

// ─── Progression ─────────────────────────────────────────────────────────────

export const EMPTY_REPORT: ExportReport = { files: 0, bytes: 0, skipped: 0, failed: 0, missing: 0 };

/** Bilan partiel construit depuis la progression (le moteur n'a pas rendu son résultat). */
export function reportFromProgress(progress: EngineProgress | null): ExportReport {
  if (!progress) return EMPTY_REPORT;
  return {
    files: progress.doneFiles,
    bytes: progress.writtenBytes,
    skipped: progress.skippedFiles,
    failed: progress.failedFiles,
    missing: progress.missingFiles,
  };
}

export interface ProgressView {
  /**
   * Octets pris en compte par la barre : fichiers terminés + partie déjà reçue
   * des fichiers en cours. Sans la seconde moitié, un fichier de 2 Gio sur une
   * ligne lente (≈ 15 min) laisserait la barre immobile.
   */
  doneBytes: number;
  /** 0..1 */
  fraction: number;
  /** Secondes restantes ; null tant que le débit n'est pas connu. */
  etaSeconds: number | null;
}

export function computeProgressView(progress: EngineProgress, bytesPerSecond: number): ProgressView {
  const inFlight = progress.active.reduce((sum, file) => {
    // Taille inconnue (.xlsx) : absente du total, donc absente de la barre.
    if (file.size === null) return sum;
    return sum + (file.phase === "finalizing" ? file.size : Math.min(file.received, file.size));
  }, 0);

  const doneBytes = Math.min(progress.totalBytes, progress.completedBytes + inFlight);
  const rawFraction =
    progress.totalBytes > 0
      ? doneBytes / progress.totalBytes
      : progress.totalFiles > 0
        ? progress.doneFiles / progress.totalFiles
        : 0;
  const remaining = Math.max(0, progress.totalBytes - doneBytes);

  return {
    doneBytes,
    fraction: Math.min(1, Math.max(0, rawFraction)),
    etaSeconds: bytesPerSecond > 0 && remaining > 0 ? remaining / bytesPerSecond : null,
  };
}

/**
 * Lissage exponentiel du débit : le débit glissant du moteur (≈ 10 s) fait
 * sauter le temps restant de « 2 h » à « 5 h » d'une seconde à l'autre, ce qui
 * se lit comme une panne.
 */
export function smoothRate(previous: number | null, sample: number, alpha = 0.2): number {
  return previous === null ? sample : previous + alpha * (sample - previous);
}

// ─── Prise en charge du navigateur ───────────────────────────────────────────

export interface SupportEnv {
  /** `typeof window.showDirectoryPicker === "function"` */
  hasDirectoryPicker: boolean;
  userAgent: string;
  /** `navigator.userAgentData?.mobile` (Chromium seulement). */
  uaDataMobile?: boolean;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod/i;

/**
 * Chrome, Edge et Opera sur ordinateur uniquement : l'écriture directe d'un
 * dossier repose sur showDirectoryPicker, absent de Safari et Firefox, désactivé
 * par défaut dans Brave, et inutilisable au doigt sur mobile.
 */
export function isExportBrowserSupported(env: SupportEnv): boolean {
  if (!env.hasDirectoryPicker) return false;
  if (env.uaDataMobile === true) return false;
  return !MOBILE_UA.test(env.userAgent);
}
