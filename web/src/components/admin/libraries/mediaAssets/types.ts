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

export type MetadataField = {
  key: string;
  label: string;
  type: "text" | "number" | "url" | "textarea";
};

export interface MediaLibrary {
  id: string;
  name: string;
  type: "video" | "audio";
  /** JSON string[] — ordre du theme_sequence. */
  setSequence: string;
  /** JSON MetadataField[] */
  metadataSchema?: string;
}

export type SortKey =
  | "date_desc"
  | "date_asc"
  | "usage_desc"
  | "usage_asc"
  | "name_asc";
