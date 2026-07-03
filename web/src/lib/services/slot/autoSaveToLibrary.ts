/**
 * autoSaveToLibrary.ts
 *
 * Trigger post-render : si la recette effective du slot associé au render a un
 * `autoSaveToLibraryId`, copie la vidéo générée dans la bibliothèque de médias
 * cible en tant que MediaAsset "generated".
 *
 * Calqué sur coverAuto.ts (triggerAutoCoverPackForRender) et
 * triggerAutoTranscription.ts. Non bloquant — fire-and-forget depuis le webhook
 * renders. Ne throw jamais.
 */

import { prisma } from "@/lib/prisma";
import { createMediaAssetFromR2 } from "@/lib/services/mediaAsset/createFromR2";

export async function triggerAutoSaveToLibrary(renderId: string): Promise<void> {
  let render: {
    videoUrl: string | null;
    accountId: string | null;
    publicationSlot: {
      patternTemplate: { autoSaveToLibraryId: string | null } | null;
      patternBinding: {
        patternTemplate: { autoSaveToLibraryId: string | null } | null;
      } | null;
    } | null;
  } | null;

  try {
    render = await prisma.render.findUnique({
      where: { id: renderId },
      select: {
        videoUrl: true,
        accountId: true,
        publicationSlot: {
          select: {
            // Branche « Mission » : PatternTemplate lié directement au slot
            patternTemplate: {
              select: { autoSaveToLibraryId: true },
            },
            // Branche « Recette par compte » : PatternBinding → PatternTemplate
            patternBinding: {
              select: {
                patternTemplate: {
                  select: { autoSaveToLibraryId: true },
                },
              },
            },
          },
        },
      },
    });
  } catch (err) {
    console.error(
      `[autoSaveToLibrary] Erreur lecture render=${renderId} :`,
      err,
    );
    return;
  }

  if (!render) {
    console.warn(
      `[autoSaveToLibrary] Render introuvable renderId=${renderId} — skip`,
    );
    return;
  }

  // Résolution de l'autoSaveToLibraryId effectif :
  //   1. Slot lié directement à un PatternTemplate (missions)
  //   2. Slot lié à un PatternBinding dont le PatternTemplate porte la config
  const slot = render.publicationSlot;
  const autoSaveToLibraryId =
    slot?.patternTemplate?.autoSaveToLibraryId ??
    slot?.patternBinding?.patternTemplate?.autoSaveToLibraryId ??
    null;

  if (!autoSaveToLibraryId) {
    // Pas d'auto-save configuré sur cette recette — skip silencieux (cas nominal).
    return;
  }

  const videoUrl = render.videoUrl;
  if (!videoUrl) {
    console.warn(
      `[autoSaveToLibrary] render=${renderId} sans videoUrl — skip auto-save`,
    );
    return;
  }

  console.info(
    `[autoSaveToLibrary] render=${renderId} → auto-save vers library=${autoSaveToLibraryId}`,
  );

  try {
    await createMediaAssetFromR2({
      libraryId: autoSaveToLibraryId,
      sourceUrlOrKey: videoUrl,
      renderId,
    });
  } catch (err) {
    // createMediaAssetFromR2 ne throw normalement pas (best-effort), mais on
    // se protège quand même pour garantir le caractère fire-and-forget du trigger.
    console.error(
      `[autoSaveToLibrary] createMediaAssetFromR2 threw pour render=${renderId} :`,
      err,
    );
  }
}
