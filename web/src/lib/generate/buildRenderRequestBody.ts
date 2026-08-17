/**
 * Construction du body de `POST /api/renders`.
 *
 * Extrait de `ListingForm` pour être testable : vitest tourne en environnement
 * `node` (cf. `web/vitest.config.ts`), on ne peut donc pas monter le composant.
 *
 * Contexte (bug rotation) : `accountId` et `publicationSlotId` étaient lus
 * exclusivement sur `libraryPrefillContext`. Or ce contexte vaut `undefined` dès
 * que le template n'a aucun binding bibliothèque, et il est remplacé (sans
 * `slotId`) à chaque changement de compte IG. Résultat : des rendus créés sans
 * compte → `MediaAssetUsage` jamais écrit (`recordLibraryUsage` ne l'écrit que
 * `if (accountId)`), donc des assets consommés qui restaient « jamais utilisés »
 * du point de vue du compte et ressortaient en tête de rotation.
 *
 * `accountId` et `slotId` sont des propriétés de LA GÉNÉRATION, pas du contexte
 * bibliothèque : ils transitent désormais en paramètres explicites, le contexte
 * ne servant plus que de repli.
 */

import type { LibraryPrefillContext, LibraryAssetOption } from "@/types/libraryPrefill";

export type UsedAssetsPayload = {
  videoAssets?: Record<string, string>;
  audioAssetId?: string;
  dataEntryId?: string;
  /** Malgré son nom, contient TOUTES les libs en règle `theme_sequence` (tirage dossier). */
  setSequencedLibraryIds?: string[];
  usedSetTagByLibrary?: Record<string, string>;
};

export type RenderRequestBody = {
  templateId: string;
  listingId: string;
  usedAssets?: UsedAssetsPayload;
  accountId?: string;
  publicationSlotId?: string;
};

/** Agrège les assets réellement sélectionnés dans le formulaire. */
export function buildUsedAssets(
  ctx: LibraryPrefillContext,
  selections: Record<string, LibraryAssetOption | null>,
): UsedAssetsPayload | undefined {
  const fieldMap = ctx.fieldLibraryMap ?? {};
  const videoAssets: Record<string, string> = {};
  let audioAssetId: string | undefined;
  for (const [fieldKey, meta] of Object.entries(fieldMap)) {
    const sel = selections[fieldKey];
    if (!sel) continue;
    if (meta.type === "video") {
      videoAssets[meta.blockId] = sel.id;
    } else {
      audioAssetId = sel.id;
    }
  }
  const hasVideo = Object.keys(videoAssets).length > 0;
  const hasAny = hasVideo || audioAssetId || ctx.dataSuggestion?.entryId;
  if (!hasAny) return undefined;
  return {
    videoAssets: hasVideo ? videoAssets : undefined,
    audioAssetId,
    dataEntryId: ctx.dataSuggestion?.entryId,
    setSequencedLibraryIds: ctx.setSequencedLibraryIds?.length ? ctx.setSequencedLibraryIds : undefined,
    usedSetTagByLibrary:
      ctx.usedSetTagByLibrary && Object.keys(ctx.usedSetTagByLibrary).length > 0 ? ctx.usedSetTagByLibrary : undefined,
  };
}

/**
 * Assemble le body du POST.
 *
 * @param accountId Compte IG effectif — sélection courante du formulaire, ou
 *                  valeur dérivée côté serveur (slot / query string). Prioritaire
 *                  sur le contexte de prefill.
 * @param slotId    Slot de publication d'origine, indépendant du contexte.
 */
export function buildRenderRequestBody(input: {
  templateId: string;
  listingId: string;
  accountId?: string | null;
  slotId?: string | null;
  context?: LibraryPrefillContext;
  selections: Record<string, LibraryAssetOption | null>;
}): RenderRequestBody {
  const { templateId, listingId, context, selections } = input;
  // Le contexte n'est plus qu'un repli : il disparaît quand le template n'a pas
  // de bibliothèque, et perd `slotId` au changement de compte.
  const accountId = input.accountId || context?.selectedAccountId || undefined;
  const publicationSlotId = input.slotId || context?.slotId || undefined;

  return {
    templateId,
    listingId,
    usedAssets: context ? buildUsedAssets(context, selections) : undefined,
    accountId,
    publicationSlotId,
  };
}
