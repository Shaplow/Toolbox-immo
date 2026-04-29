/**
 * Shared types for the content-library pre-fill and picker system.
 * Passed from the generate page (server component) to ListingForm (client).
 */

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
}

export interface LibraryPrefillContext {
  /** form field key → library metadata (drives the picker UI) */
  fieldLibraryMap: Record<string, LibraryFieldMeta>;
  /** form field key → initial auto-selected suggestion (null = manual rule or empty library) */
  initialSuggestions: Record<string, LibraryAssetOption | null>;
  /** text/data field keys pre-filled from a DataEntry — drives the "depuis la bibliothèque" badge */
  prefilledDataKeys: string[];
  /** full data suggestion with entryId for usage tracking */
  dataSuggestion?: { entryId: string; fields: Record<string, string> } | null;
}
