/**
 * Shared types for the content-library pre-fill and picker system.
 * Passed from the generate page (server component) to ListingForm (client).
 */

import type { ProvenanceMap } from "@/lib/generate/provenance";
import type { TagCondition } from "@/types/template";

export interface LibraryAssetOption {
  id: string;
  url: string;
  filename: string;
}

export interface LibraryFieldMeta {
  /** ID of the MediaLibrary to show in the picker. */
  libraryId: string;
  /** Template block ID — used to key Render.usedAssets.videoAssets. */
  blockId: string;
  type: "video" | "audio";
  /**
   * If the selection rule uses tagFilterParam, this is the form field key
   * whose current value should be passed as a tag filter to the picker.
   */
  tagFilterParam?: string;
  /**
   * Durée minimale requise pour l'asset (secondes), héritée de VideoBlock.minDuration ou MusicBlock.minDuration.
   * Passée au picker pour griser les assets trop courts (A.6 — plus d'exclusion serveur).
   */
  minDuration?: number;
  /**
   * A.4 (P5 hardening, 21/08) — règles de tags avancées de la règle de
   * sélection du bloc/slot, transmises TELLES QUELLES (peuvent contenir des
   * conditions `fromParam` non résolues, cf. `TagCondition.fromParam`) : c'est
   * `ListingForm` qui les résout contre les valeurs courantes du formulaire
   * avant de les passer au picker (`resolveTagConditionsForForm`,
   * `lib/generate/libraryAssetsQuery.ts`). Mirror de
   * `MediaSelectionRuleConfig.tagConditions`.
   */
  tagConditions?: TagCondition[];
  /** Mirror de `MediaSelectionRuleConfig.tagConditionsOperator`. */
  tagConditionsOperator?: "AND" | "OR";
  /**
   * Tag littéral de la règle (`MediaSelectionRuleConfig.tagFilter`) — distinct
   * du tag DYNAMIQUE déjà résolu depuis `tagFilterParam` (voir `tagFilterParam`
   * ci-dessus, transmis séparément à la génération du picker).
   */
  tagFilter?: string;
}

export interface LibraryPrefillContext {
  /** form field key → library metadata (drives the picker UI) */
  fieldLibraryMap: Record<string, LibraryFieldMeta>;
  /** form field key → initial auto-selected suggestion (null = manual rule or empty library) */
  initialSuggestions: Record<string, LibraryAssetOption | null>;
  /**
   * Provenance par clé de TOUTES les valeurs de pré-remplissage connues côté
   * serveur au moment de l'appel (fiche, fiche tournage, overrides mission,
   * DataEntry) — voir `lib/generate/provenance.ts`. Pilote le badge de
   * provenance affiché par `FieldInput`. Remplace l'ancien `prefilledDataKeys`
   * (liste plate, DataEntry uniquement) : la précédence entre sources est
   * maintenant explicite plutôt qu'implicite à l'ordre d'appel.
   */
  prefilledKeys: ProvenanceMap;
  /** full data suggestion with entryId for usage tracking */
  dataSuggestion?: {
    entryId: string;
    fields: Record<string, string>;
    /** Dossier (setTag) de la fiche servie — trace. */
    resolvedSetTag?: string | null;
  } | null;
  /**
   * Libraries whose selection used set_sequence.
   * Passed to the render endpoint so recordLibraryUsage can advance cursor.
   */
  setSequencedLibraryIds?: string[];
  /**
   * libraryId → resolved setTag used in this generation.
   * Stored in Render.usedAssets so recordLibraryUsage can persist lastUsedSetTag.
   */
  usedSetTagByLibrary?: Record<string, string>;
  /**
   * libraryId → resolved category used in this generation.
   * Stored in Render.usedAssets so recordLibraryUsage can persist lastUsedCategory.
   */
  /**
   * Instagram accounts to show in the account selector (only when at least one block
   * uses theme_sequence). Empty means no selector needed.
   */
  instagramAccounts?: { id: string; name: string; handle: string }[];
  /** ID of the currently selected Instagram account (from URL searchParam). */
  selectedAccountId?: string;
  /**
   * PublicationSlot ID when generation is triggered from the calendar.
   * Passed to the render endpoint so the render is linked back to the slot.
   */
  slotId?: string;
  /**
   * Describes a link between a select field (source) and a video field (target)
   * where the video is resolved at render time from a media asset's metadata value.
   * Used by ListingForm to dynamically update the video field when the select changes.
   */
  metadataDrivenLinks?: MetadataDrivenLink[];
}

export interface MetadataDrivenLink {
  /** Key of the select field that drives the resolution (e.g. "nom_du_client") */
  sourceFieldKey: string;
  /** Key of the video field to update (e.g. "rva3raw") */
  targetFieldKey: string;
  /** MediaLibrary ID to search in */
  libraryId: string;
  /** Metadata key to match against (e.g. "nom_du_client") */
  metadataKey: string;
}
