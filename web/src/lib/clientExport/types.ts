/**
 * Contrats du lien de téléchargement des données d'un client.
 *
 * Partagés par le serveur (services/clientExport, routes /api/admin/clients/[id]/export-*
 * et /api/export/[token]/*), la page publique /export/[token] (moteur navigateur
 * File System Access) et le tiroir admin. Aucun import serveur ici : ce module
 * est aussi chargé dans le navigateur.
 *
 * Arborescence écrite chez le client :
 *   <Client>/<Compte>/<Bibliothèque>/<Dossier>/<fichier>
 *   <Client>/<Compte>/Publications/<YYYY-MM-DD> - <libellé>.mp4
 *   <Client>/<Compte>/<Bibliothèque de données>/<Bibliothèque de données>.xlsx
 *   <Client>/Commun/<Bibliothèque>/…   (sons et fiches communs à tous les comptes)
 */

// ─── Sélection enregistrée sur le lien ───────────────────────────────────────

export interface ExportSelection {
  clientId: string;
  accountIds: string[];
  /** MediaLibrary cochées (vidéo et son). */
  mediaLibraryIds: string[];
  /** DataLibrary cochées. */
  dataLibraryIds: string[];
  includePublications: boolean;
}

export type ExportLibraryType = "video" | "audio" | "data";

// ─── Éléments résolus côté serveur (avant nommage) ───────────────────────────

/**
 * Référence stable d'un fichier dans un lien — c'est elle que la page publique
 * renvoie pour obtenir une URL signée. Construite par lib/clientExport/ids.ts :
 *   média       `m.<assetId>.<accountId|c>`
 *   données     `d.<libraryId>.<accountId|c>`
 *   publication `p.<slotId>`
 * (`c` = dossier « Commun »).
 */
export type ExportRef = string;

interface ExportItemBase {
  ref: ExportRef;
  /** Compte de rangement ; null = dossier « Commun ». */
  accountId: string | null;
}

export interface MediaExportItem extends ExportItemBase {
  kind: "media";
  assetId: string;
  libraryId: string;
  libraryType: "video" | "audio";
  /** Dossier (setTag) ; null = racine de la bibliothèque (`pack_*` ramené à null). */
  folder: string | null;
  /** Nom d'origine du fichier (MediaAsset.filename). */
  filename: string;
  /** Clé R2 (sert aussi à déduire l'extension si filename n'en a pas). */
  r2Key: string;
  /** URL stockée (stockage local : /uploads/<id>.<ext>, éventuellement `?v=`). */
  url: string;
  /** Un media_edit terminé a réécrit le fichier en MP4 sous l'ancien nom. */
  edited: boolean;
  sizeBytes: number | null;
  /** Ordre déterministe (createdAt, assetId) : la reprise doit retrouver les mêmes noms. */
  createdAt: string;
}

export interface DataExportItem extends ExportItemBase {
  kind: "data";
  libraryId: string;
  /** Nombre de fiches exportées dans le fichier .xlsx. */
  entryCount: number;
}

export type PublicationVideoSource = "caption" | "version" | "render";

export interface PublicationExportItem extends ExportItemBase {
  kind: "publication";
  /** Toujours le compte principal du slot (jamais null). */
  accountId: string;
  slotId: string;
  source: PublicationVideoSource;
  r2Key: string;
  /** Stockage local uniquement : URL same-origin du fichier. */
  localUrl: string | null;
  /** Nom d'origine quand il existe (version de montage) — pour l'extension. */
  fileName: string | null;
  sizeBytes: number | null;
  /** publishedAt ?? scheduledAt ?? createdAt, ISO. */
  date: string;
  /** Libellé lisible : clientLabel ?? title ?? libellé de recette ?? « Publication ». */
  label: string;
  /** Libellé de la fiche (bien) rattachée, s'il diffère du libellé. */
  entityLabel: string | null;
}

export type ExportItem = MediaExportItem | DataExportItem | PublicationExportItem;

/** Pourquoi un élément attendu ne sera pas téléchargé. */
export type ExportSkipReason =
  /** Fichier absent du stockage (upload jamais terminé, objet supprimé). */
  | "missing"
  /** Publication dont la vidéo n'est pas sur le stockage (pipeline local, legacy). */
  | "not_on_r2"
  /** Publication sans vidéo finale. */
  | "no_video"
  /** Publication image (hors périmètre « Vidéos publiées »). */
  | "image_post";

export interface ExportSkipped {
  /** Libellé lisible (« Sarah — Behind the scene — rush-01.mov »). */
  label: string;
  reason: ExportSkipReason;
}

// ─── Arbre (entrées / sortie de buildExportTree) ─────────────────────────────

export interface TreeAccount {
  id: string;
  name: string;
  handle: string;
}

export interface TreeLibrary {
  id: string;
  name: string;
  type: ExportLibraryType;
}

export type ExportFileKind = ExportItem["kind"];

/** Un fichier à écrire chez le client. */
export interface ManifestFile {
  ref: ExportRef;
  kind: ExportFileKind;
  /**
   * Segments du chemin relatif, dossier racine inclus :
   * ["Agence Dupont", "Sarah", "Behind the scene", "Cuisine", "rush-01.mov"].
   * Assainis pour Chrome/Windows/macOS, dédoublonnés sans tenir compte de la
   * casse, dans le budget de longueur de chemin.
   */
  path: string[];
  /** Taille attendue en octets ; null = inconnue d'avance (fichiers .xlsx). */
  size: number | null;
}

// ─── API publique /api/export/[token]/* ───────────────────────────────────────

/** GET /api/export/[token]/manifest */
export interface ExportManifest {
  /** Id du lien : clé IndexedDB du dossier choisi (reprise). */
  linkId: string;
  clientName: string;
  /** Nom du dossier racine (= path[0] de chaque fichier). */
  rootName: string;
  expiresAt: string;
  files: ManifestFile[];
  skipped: ExportSkipped[];
  totals: {
    files: number;
    /** Somme des tailles connues. */
    bytes: number;
    accounts: number;
  };
}

/** POST /api/export/[token]/urls — body */
export interface ExportUrlsRequest {
  refs: ExportRef[];
}

/** POST /api/export/[token]/urls — réponse */
export interface ExportUrlsResponse {
  /** URL à télécharger (présignée R2, ou same-origin en local / pour les .xlsx). */
  urls: Record<ExportRef, string>;
  /** Refs hors périmètre ou devenues introuvables. */
  missing: ExportRef[];
}

/** Bilan envoyé par la page publique (et rangé dans ClientExportLink.lastReport). */
export interface ExportReport {
  /** Fichiers écrits ou déjà présents à la bonne taille. */
  files: number;
  /** Octets écrits pendant cette session. */
  bytes: number;
  /** Fichiers sautés parce que déjà complets sur le disque. */
  skipped: number;
  failed: number;
  /** Fichiers devenus introuvables côté stockage. */
  missing: number;
}

export type ExportEventType = "started" | "completed" | "stopped";

/** POST /api/export/[token]/events — body */
export interface ExportEventRequest extends ExportReport {
  type: ExportEventType;
}

// ─── API admin /api/admin/clients/[id]/export-* ───────────────────────────────

export interface ExportVolume {
  /** Fichiers (médias, publications) ou fiches (données). */
  files: number;
  /** Octets connus (0 pour les données). */
  bytes: number;
}

/** GET /api/admin/clients/[id]/export-preview */
export interface ExportPreview {
  accounts: TreeAccount[];
  libraries: Array<{
    id: string;
    name: string;
    type: ExportLibraryType;
    /** Réservés à chaque compte (clé = accountId). Comptes absents = 0. */
    perAccount: Record<string, ExportVolume>;
    /** Communs à tous les comptes : son et données uniquement (null pour la vidéo). */
    common: ExportVolume | null;
  }>;
  publications: {
    perAccount: Record<string, ExportVolume>;
    /**
     * Publications publiées mais non exportables, par compte PUIS par motif :
     * un post image est normal, une vidéo introuvable demande une action.
     * (`missing` = vidéo résolue mais absente du stockage.)
     */
    unavailable: Record<string, Partial<Record<ExportSkipReason, number>>>;
  };
  /**
   * Médias (vidéos, sons) introuvables dans le stockage, exclus des volumes.
   * Les publications introuvables sont comptées dans `publications.unavailable`.
   */
  missingFiles: number;
}

export type ExportLinkStatus = "active" | "expired" | "revoked";

export interface ExportLinkSummary {
  id: string;
  label: string | null;
  status: ExportLinkStatus;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  createdBy: { id: string; name: string } | null;
  accountIds: string[];
  /** Nombre de bibliothèques cochées par type. */
  libraries: { video: number; audio: number; data: number };
  includePublications: boolean;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  /** DERNIER lancement (reprises comprises). */
  downloadStartedAt: string | null;
  /** Dernière session terminée SANS échec. */
  downloadCompletedAt: string | null;
  startCount: number;
  /**
   * Bilan de la dernière session finie (terminée ou arrêtée). Remis à null à
   * chaque lancement : null + downloadStartedAt = session en cours, ou fermée
   * sans bilan (onglet fermé, plantage).
   */
  lastReport: ExportReport | null;
}

/** GET /api/admin/clients/[id]/export-links */
export interface ExportLinksResponse {
  links: ExportLinkSummary[];
}

export const EXPORT_LINK_DURATIONS_DAYS = [1, 3, 7, 14, 30] as const;
export type ExportLinkDurationDays = (typeof EXPORT_LINK_DURATIONS_DAYS)[number];
export const DEFAULT_EXPORT_LINK_DURATION_DAYS: ExportLinkDurationDays = 7;

/** POST /api/admin/clients/[id]/export-links — body */
export interface CreateExportLinkRequest {
  label?: string | null;
  expiresInDays: ExportLinkDurationDays;
  accountIds: string[];
  mediaLibraryIds: string[];
  dataLibraryIds: string[];
  includePublications: boolean;
}

/** PATCH /api/admin/clients/[id]/export-links/[linkId] — body */
export type ExportLinkAction =
  | { action: "revoke" }
  /** Nouveau jeton (l'ancien lien cesse de marcher), même sélection. */
  | { action: "rotate" }
  /** Repousse l'expiration de N jours (à partir de maintenant si déjà expiré). */
  | { action: "extend"; days: ExportLinkDurationDays };

/** POST / PATCH rotate — le jeton brut n'est renvoyé qu'à cet instant. */
export interface ExportLinkWithToken {
  link: ExportLinkSummary;
  /** URL complète à partager = `${origin}/export/${rawToken}`. */
  rawToken?: string;
}
