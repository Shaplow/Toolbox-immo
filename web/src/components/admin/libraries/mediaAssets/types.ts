/**
 * Types partagés du panel MediaAssets et de ses futurs sous-composants.
 *
 * Première étape de la stratégie de split C1-v2 §15.2 du plan :
 * "extraire types + helpers + composants utilitaires" avant le split en
 * hooks / vues / modals (étapes 2-4 reportées en session dédiée avec
 * tests visuels).
 */

export interface MediaAsset {
  id: string;
  filename: string;
  url: string;
  /** Image poster R2 (frame extraite à l'upload). Null = fallback <video>. */
  posterUrl?: string | null;
  mimeType: string;
  duration: number | null;
  tags: string[];
  setTag: string | null;
  category: string | null;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  accessAccountIds: string[];
  pendingEditJob: { id: string; status: string } | null;
  disabled: boolean;
  metadata?: Record<string, string | number | null>;
}

export interface InstagramAccount {
  id: string;
  name: string;
  handle: string;
}

// Alias vers le type canonique partagé (customFields.ts).
// Les ~10 imports existants `MetadataField` restent valides sans modification.
import type { CustomField } from "@/lib/customFields";
export type MetadataField = CustomField;

export interface MediaLibrary {
  id: string;
  name: string;
  type: "video" | "audio";
  /** JSON string[] — ordre du theme_sequence. */
  setSequence: string;
  /** JSON MetadataField[] */
  metadataSchema?: string;
  /** "auto" | "override" | "none" | null. "none" = sélection manuelle via metadata. */
  rotationMode?: string | null;
  /** "per_account" (defaut) | "shared". Détermine si le cursor est par compte ou global. */
  rotationScope?: string | null;
  /** Cap d'utilisation par asset (null = infini). Lu par le panel pour refetch
   *  l'ordre de rotation serveur quand ce champ est modifié dans le drawer. */
  maxUsageCount?: number | null;
}

export type SortKey =
  | "date_desc"
  | "date_asc"
  | "usage_desc"
  | "usage_asc"
  | "name_asc";

/**
 * Groupe d'assets partageant un même `(category, setTag)`. Produit par
 * le useMemo `groupedBySetTag` du panel — utilisé par les vues "rotation"
 * et "grouped" pour afficher la rotation simulée + les colonnes de pool.
 */
export interface SetGroup {
  /** `${category ?? "__none__"}::${setTag ?? "__none__"}` */
  key: string;
  setTag: string | null;
  category: string | null;
  groupAssets: MediaAsset[];
  accessibleCount: number;
  lastUsed: string | null;
  groupCreatedAt?: string | null;
  /** Rang de prochaine génération (1 = next), null si pas dans la rotation. */
  autoRank: number | null;
  /** Taille du cycle de rotation (nombre de groupes participants). */
  cycleSize: number | null;
  isAccessible: boolean;
}
