/**
 * Contrat « Lancer les rendus » (aperçu → validation → lancement en lot).
 *
 * Partagé entre `lib/services/render/bulkRenderService.ts` (serveur) et
 * `components/renders/BulkRenderModal.tsx` (client) — types seulement, aucun
 * import serveur ici.
 *
 * Principe : l'aperçu tire les médias de chaque publication comme si les
 * rendus avaient été lancés un par un dans l'ordre du calendrier (registre
 * d'usage virtuel, `lib/rotation/batchUsage.ts`). La validation renvoie les
 * picks EXACTS de l'aperçu — le serveur ne re-tire jamais, sinon décocher une
 * ligne décalerait toutes les suivantes.
 */

import type { TagCondition } from "@/types/template";

/** Plafond d'un lot : souple à l'aperçu (reste reporté), dur au lancement. */
export const BULK_RENDER_CAP = 30;

export type BulkRenderRowStatus =
  /** Tout est tiré, rien ne manque — cochable. */
  | "ready"
  /** Choix du bien requis (select metadata-driven vide — RVA4 — ou recette exigeant une fiche). */
  | "needs_property"
  /** Recette sans template builder. */
  | "no_template"
  /** Le template tire en bibliothèque mais la publication n'a pas de compte IG. */
  | "no_account"
  /** Un rendu est déjà en file / en cours sur cette publication. */
  | "in_flight"
  /** Champs requis vides après pré-remplissage (stock épuisé, texte sans source…). */
  | "incomplete";

export type BulkRenderIgnoredReason =
  /** Recette montage manuel / upload client : pas de rendu auto. */
  | "not_auto_template"
  /** Publiée, annulée, archivée. */
  | "terminal_status"
  /** Déjà un rendu terminé. */
  | "already_rendered"
  /** Id inconnu. */
  | "not_found";

export interface BulkRenderAsset {
  id: string;
  url: string;
  filename: string;
  posterUrl: string | null;
  duration: number | null;
  /** Dossier — null si sans dossier ou réservé (`pack_*`). */
  setTag: string | null;
}

export interface BulkRenderMedia {
  /**
   * Vidéo : clé de `usedAssets.videoAssets` (block.id ou slot.id de séquence).
   * Audio : id du MusicBlock (l'asset part dans `audioAssetId`).
   */
  blockId: string;
  /** Clé du champ de formulaire (binding) ; null pour une musique sans binding. */
  fieldKey: string | null;
  label: string;
  kind: "video" | "audio";
  libraryId: string;
  libraryName: string | null;
  /** `libraryId|usageKey` — deux picks de même clé et même asset = doublon. */
  usageKey: string;
  /** Props du picker « Changer », filtres de tags déjà résolus contre les valeurs de la ligne. */
  picker: {
    tagFilter?: string;
    tagFilterLiteral?: string;
    tagConditions?: TagCondition[];
    tagConditionsOperator?: "AND" | "OR";
    minDuration?: number;
    accountId?: string;
  };
  /** null = rien de tiré en aperçu : le rendu tirera lui-même (« Tiré au rendu »). */
  asset: BulkRenderAsset | null;
  /**
   * Média imposé par un select metadata-driven (vidéo du bien) : le rendu le
   * re-résout depuis la valeur du select, un « Changer » serait ignoré — l'UI
   * masque donc le bouton, et le lancement refuse un changement sur ce bloc.
   */
  locked?: boolean;
}

export interface BulkRenderData {
  entryId: string;
  libraryName: string | null;
  setTag: string | null;
  /** Extrait du texte servi, tronqué (~80 caractères). */
  excerpt: string;
  usageKey: string;
}

export interface BulkRenderRow {
  slotId: string;
  scheduledAt: string | null;
  /** Date passée — décochée par défaut côté UI. */
  overdue: boolean;
  account: { id: string; handle: string } | null;
  recipeLabel: string;
  templateId: string | null;
  templateName: string | null;
  status: BulkRenderRowStatus;
  /** Détail lisible du statut non-ready (ex. « Rendu en cours »). */
  reason?: string;
  /** Libellés des champs requis manquants (status `incomplete`). */
  missingFields?: string[];
  media: BulkRenderMedia[];
  data: BulkRenderData | null;
  /** Formulaire complet `/generate/<templateId>?slotId=…` — null sans template. */
  formHref: string | null;
}

export interface BulkRenderPreview {
  rows: BulkRenderRow[];
  ignored: { reason: BulkRenderIgnoredReason; count: number }[];
  /** Publications au-delà du plafond, reportées au prochain lot. */
  deferred: number;
  cap: number;
}

export interface BulkRenderLaunchItem {
  slotId: string;
  /** blockId → assetId des vidéos affichées (après « Changer » éventuels). */
  videoAssets: Record<string, string>;
  audioAssetId?: string | null;
  dataEntryId?: string | null;
  /** blockIds modifiés via « Changer » → provenance `manual`. */
  changedBlockIds: string[];
}

export type BulkRenderLaunchErrorCode =
  | "in_flight"
  | "missing_fields"
  | "invalid_asset"
  | "invalid_data_entry"
  | "not_eligible"
  | "error";

export interface BulkRenderLaunchResult {
  slotId: string;
  ok: boolean;
  renderId?: string;
  code?: BulkRenderLaunchErrorCode;
  error?: string;
}

export interface BulkRenderLaunchResponse {
  results: BulkRenderLaunchResult[];
}
