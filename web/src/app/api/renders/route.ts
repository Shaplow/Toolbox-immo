import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { hasTool, TOOLS } from "@/lib/permissions";
import { startRenderGeneration } from "@/lib/renderer/generateRender";
import { advanceLibraryCursorsOnSubmit, advanceAudioUsageOnSubmit, advanceDataLibraryCursorOnSubmit, advanceDataEntryClaimOnSubmit } from "@/lib/contentLibraryResolver";
import { applyAutoTransitionFromPipeline } from "@/lib/services/slot/transitions";

/**
 * Fix bug audit 2026-05-30 (C3) — Revert manuel des advances de cursors / audio
 * si la création du Render échoue après que les advances ont été appliqués.
 * Sans ce revert, les cursors restaient avancés sans render associé →
 * rotation biaisée (un asset "saute" son tour sans avoir été utilisé).
 *
 * Reproduit la logique de revertLibraryCursors() côté recordLibraryUsage.ts
 * mais en se basant sur la state mémoire (pas sur un renderId).
 */
async function revertAdvancesOnFailure(usedAssets: {
  prevCursorStateByLibrary?: Record<
    string,
    {
      prevCursor: number;
      claimedCursor: number;
      prevLastUsedCategory: string | null;
      claimedLastUsedCategory: string | null;
      /** Phase 6 — snapshot lastUsedSetTag pour CAS revert plus strict. */
      prevLastUsedSetTag: string | null;
      claimedLastUsedSetTag: string | null;
      cursorAccountId?: string;
    }
  >;
  prevAudioUsageState?: {
    assetId: string;
    accountId: string;
    prevLastUsedAt: string | null;
    claimedLastUsedAt: string;
  };
  prevDataLibraryCursorState?: {
    libraryId: string;
    accountId: string;
    prevLastUsedSetTag: string | null;
    prevLastUsedCategory: string | null;
    claimedSetTag: string | null;
    claimedCategory: string | null;
  };
}) {
  if (usedAssets.prevCursorStateByLibrary) {
    for (const [libraryId, state] of Object.entries(usedAssets.prevCursorStateByLibrary)) {
      const cursorAccountId = state.cursorAccountId;
      if (!cursorAccountId) continue;
      try {
        await prisma.$executeRaw(Prisma.sql`
          UPDATE "AccountLibraryCursor"
          SET cursor = ${state.prevCursor},
              "lastUsedCategory" = ${state.prevLastUsedCategory},
              "lastUsedSetTag"   = ${state.prevLastUsedSetTag}
          WHERE "accountId" = ${cursorAccountId}
            AND "libraryId" = ${libraryId}
            AND cursor IS NOT DISTINCT FROM ${state.claimedCursor}
            AND "lastUsedCategory" IS NOT DISTINCT FROM ${state.claimedLastUsedCategory}
            AND "lastUsedSetTag" IS NOT DISTINCT FROM ${state.claimedLastUsedSetTag}
        `);
      } catch (err) {
        console.error(`[revertAdvancesOnFailure] cursor revert failed lib=${libraryId}:`, err);
      }
    }
  }
  if (usedAssets.prevAudioUsageState) {
    const { assetId, accountId, prevLastUsedAt, claimedLastUsedAt } = usedAssets.prevAudioUsageState;
    try {
      if (prevLastUsedAt === null) {
        await prisma.$executeRaw(Prisma.sql`
          DELETE FROM "MediaAssetUsage"
          WHERE "assetId" = ${assetId} AND "accountId" = ${accountId}
            AND "usageCount" = 0
            AND "lastUsedAt" = ${new Date(claimedLastUsedAt)}
        `);
      } else {
        await prisma.$executeRaw(Prisma.sql`
          UPDATE "MediaAssetUsage"
          SET "lastUsedAt" = ${new Date(prevLastUsedAt)}
          WHERE "assetId" = ${assetId} AND "accountId" = ${accountId}
            AND "lastUsedAt" = ${new Date(claimedLastUsedAt)}
        `);
      }
    } catch (err) {
      console.error(`[revertAdvancesOnFailure] audio revert failed asset=${assetId}:`, err);
    }
  }
  // DataLibrary cursor revert — only if we wrote it during this request
  if (usedAssets.prevDataLibraryCursorState) {
    const { libraryId, accountId, prevLastUsedSetTag, prevLastUsedCategory, claimedSetTag, claimedCategory } = usedAssets.prevDataLibraryCursorState;
    try {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "AccountDataLibraryCursor"
        SET "lastUsedSetTag"   = ${prevLastUsedSetTag},
            "lastUsedCategory" = ${prevLastUsedCategory},
            "lastAdvancedAt"   = NULL
        WHERE "accountId" = ${accountId}
          AND "libraryId" = ${libraryId}
          AND "lastUsedSetTag"   IS NOT DISTINCT FROM ${claimedSetTag}
          AND "lastUsedCategory" IS NOT DISTINCT FROM ${claimedCategory}
      `);
    } catch (err) {
      console.error(`[revertAdvancesOnFailure] DataLibrary cursor revert failed lib=${libraryId}:`, err);
    }
  }
}

// POST /api/renders — déclenche une génération
export async function POST(req: NextRequest) {
  try {
    const userContext = await getUserContext();
    if (!userContext?.effectiveUser.id) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const isAdmin = userContext.canAdminBypass;

    // Verify the user has the templates tool
    if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.TEMPLATES))) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    const body = await req.json();
    const { templateId, listingId, usedAssets, accountId, publicationSlotId } = body;

    if (!templateId || !listingId) {
      return NextResponse.json(
        { error: "templateId et listingId requis" },
        { status: 400 }
      );
    }

    // Verify the user has access to this specific template
    if (!isAdmin) {
      const access = await prisma.templateAccess.findUnique({
        where: { userId_templateId: { userId: userContext.effectiveUser.id, templateId } },
      });
      if (!access) {
        return NextResponse.json({ error: "Accès au template refusé" }, { status: 403 });
      }
    }

    // Vérifier que le listing appartient à l'utilisateur
    const listing = await prisma.listing.findFirst({
      where: isAdmin ? { id: listingId } : { id: listingId, userId: userContext.effectiveUser.id },
    });
    if (!listing) {
      return NextResponse.json({ error: "Listing introuvable" }, { status: 404 });
    }

    // Valider usedAssets — vérifier que chaque ID référencé existe en DB.
    // Empêche de gonfler les compteurs d'usage d'assets arbitraires via
    // un payload modifié côté client.
    const sanitizedUsedAssets: {
      videoAssets?: Record<string, string>;
      audioAssetId?: string;
      dataEntryId?: string;
      /** resolvedSetTag from DataEntry group selection — drives AccountDataLibraryCursor advance. */
      dataResolvedSetTag?: string | null;
      /** resolvedCategory from DataEntry group selection — drives AccountDataLibraryCursor advance. */
      dataResolvedCategory?: string | null;
      setSequencedLibraryIds?: string[];
      usedSetTagByLibrary?: Record<string, string>;
      usedCategoryByLibrary?: Record<string, string>;
      prevCursorStateByLibrary?: Record<string, { prevCursor: number; claimedCursor: number; prevLastUsedCategory: string | null; claimedLastUsedCategory: string | null; prevLastUsedSetTag: string | null; claimedLastUsedSetTag: string | null; cursorAccountId?: string }>;
      prevDataEntryState?: { entryId: string; campaignId: string; usagePolicy: string; claimType: string; accountId?: string };
      prevAudioUsageState?: { assetId: string; accountId: string; prevLastUsedAt: string | null; claimedLastUsedAt: string };
      /** DataLibrary cursor state snapshot for failure-recovery revert. */
      prevDataLibraryCursorState?: { libraryId: string; accountId: string; prevLastUsedSetTag: string | null; prevLastUsedCategory: string | null; claimedSetTag: string | null; claimedCategory: string | null };
    } = {};

    if (usedAssets && typeof usedAssets === "object") {
    const raw = usedAssets as { videoAssets?: unknown; audioAssetId?: unknown; dataEntryId?: unknown; dataResolvedSetTag?: unknown; dataResolvedCategory?: unknown; setSequencedLibraryIds?: unknown; usedSetTagByLibrary?: unknown; usedCategoryByLibrary?: unknown; prevDataEntryState?: unknown };

      // Video assets: blockId → assetId
      if (raw.videoAssets && typeof raw.videoAssets === "object" && !Array.isArray(raw.videoAssets)) {
        const videoMap = raw.videoAssets as Record<string, unknown>;
        const ids = Object.values(videoMap).filter((v): v is string => typeof v === "string");
        if (ids.length > 0) {
          const found = await prisma.mediaAsset.findMany({ where: { id: { in: ids } }, select: { id: true } });
          const validIds = new Set(found.map((a) => a.id));
          sanitizedUsedAssets.videoAssets = Object.fromEntries(
            Object.entries(videoMap)
              .filter(([, v]) => typeof v === "string" && validIds.has(v as string)) as [string, string][]
          );
        }
      }

      // Audio asset
      if (typeof raw.audioAssetId === "string") {
        const found = await prisma.mediaAsset.findUnique({ where: { id: raw.audioAssetId }, select: { id: true } });
        if (found) sanitizedUsedAssets.audioAssetId = raw.audioAssetId;
      }

      // Data entry
      if (typeof raw.dataEntryId === "string") {
        const found = await prisma.dataEntry.findUnique({ where: { id: raw.dataEntryId }, select: { id: true } });
        if (found) sanitizedUsedAssets.dataEntryId = raw.dataEntryId;
      }

      // DataLibrary cursor group hints (strings or null) — pass through for AccountDataLibraryCursor advance.
      // Validation: only accept string or null (no arbitrary types).
      if (raw.dataResolvedSetTag === null || typeof raw.dataResolvedSetTag === "string") {
        sanitizedUsedAssets.dataResolvedSetTag = raw.dataResolvedSetTag ?? null;
      }
      if (raw.dataResolvedCategory === null || typeof raw.dataResolvedCategory === "string") {
        sanitizedUsedAssets.dataResolvedCategory = raw.dataResolvedCategory ?? null;
      }

      // Set sequenced libraries — validate each libraryId exists
      if (Array.isArray(raw.setSequencedLibraryIds)) {
        const ids = (raw.setSequencedLibraryIds as unknown[]).filter((v): v is string => typeof v === "string");
        if (ids.length > 0) {
          const found = await prisma.mediaLibrary.findMany({ where: { id: { in: ids } }, select: { id: true } });
          const validIds = new Set(found.map((l) => l.id));
          sanitizedUsedAssets.setSequencedLibraryIds = ids.filter((id) => validIds.has(id));
        }
      }

      // usedSetTagByLibrary — pass through as-is (no sensitive data, strings only)
      if (raw.usedSetTagByLibrary && typeof raw.usedSetTagByLibrary === "object" && !Array.isArray(raw.usedSetTagByLibrary)) {
        const map = raw.usedSetTagByLibrary as Record<string, unknown>;
        const sanitized = Object.fromEntries(
          Object.entries(map).filter(([, v]) => typeof v === "string"),
        ) as Record<string, string>;
        if (Object.keys(sanitized).length > 0) sanitizedUsedAssets.usedSetTagByLibrary = sanitized;
      }

      // usedCategoryByLibrary — pass through as-is (strings only)
      if (raw.usedCategoryByLibrary && typeof raw.usedCategoryByLibrary === "object" && !Array.isArray(raw.usedCategoryByLibrary)) {
        const map = raw.usedCategoryByLibrary as Record<string, unknown>;
        const sanitized = Object.fromEntries(
          Object.entries(map).filter(([, v]) => typeof v === "string"),
        ) as Record<string, string>;
        if (Object.keys(sanitized).length > 0) sanitizedUsedAssets.usedCategoryByLibrary = sanitized;
      }

      // Phase 8.M1 : prevDataEntryState n'est plus accepté du body client.
      // Le claim DataEntry est désormais posé côté serveur via
      // advanceDataEntryClaimOnSubmit (voir plus bas), exactement comme
      // advanceLibraryCursorsOnSubmit gère le claim Media. Cela élimine le
      // vecteur d'attaque C1 (client trustait l'entryId) ET le claim leak
      // M1 (claim au prefill qui ne se libère jamais si l'user abandonne).
    }

    // ── Phase 4: minDuration validation ─────────────────────────────────────────
    // For each VideoBlock (or MusicBlock) with a minDuration defined in the template,
    // verify that the manually chosen asset (from sanitizedUsedAssets.videoAssets or audioAssetId)
    // meets the duration requirement. AUTO-selected assets are already filtered upstream
    // by selectAndClaimMediaAsset's minDuration param; this check guards against
    // a tampered client payload bypassing the picker's disabled state.
    if (sanitizedUsedAssets.videoAssets || sanitizedUsedAssets.audioAssetId) {
      const templateRow = await prisma.template.findUnique({
        where: { id: templateId },
        select: { content: true },
      });
      if (templateRow?.content) {
        try {
          const tplJson = JSON.parse(templateRow.content) as {
            blocks?: Array<{ id: string; type: string; minDuration?: number; name?: string; libraryId?: string }>;
          };
          const blocks = tplJson.blocks ?? [];

          // Video blocks
          for (const block of blocks) {
            if (
              block.type === "video" &&
              block.minDuration != null &&
              block.minDuration > 0 &&
              block.libraryId
            ) {
              const chosenAssetId = sanitizedUsedAssets.videoAssets?.[block.id];
              if (chosenAssetId) {
                const assetRow = await prisma.mediaAsset.findUnique({
                  where: { id: chosenAssetId },
                  select: { duration: true },
                });
                if (assetRow?.duration != null && assetRow.duration < block.minDuration) {
                  return NextResponse.json(
                    {
                      error: `Vidéo "${block.name ?? block.id}" : durée insuffisante (${assetRow.duration}s disponibles, ${block.minDuration}s requis)`,
                    },
                    { status: 400 },
                  );
                }
              }
            }
          }

          // Music block
          const musicBlock = blocks.find((b) => b.type === "music" && b.minDuration != null && b.minDuration > 0);
          if (musicBlock && sanitizedUsedAssets.audioAssetId) {
            const assetRow = await prisma.mediaAsset.findUnique({
              where: { id: sanitizedUsedAssets.audioAssetId },
              select: { duration: true },
            });
            if (assetRow?.duration != null && assetRow.duration < musicBlock.minDuration!) {
              return NextResponse.json(
                {
                  error: `Musique "${musicBlock.name ?? "piste audio"}" : durée insuffisante (${assetRow.duration}s disponibles, ${musicBlock.minDuration}s requis)`,
                },
                { status: 400 },
              );
            }
          }
        } catch {
          // Non-critical — malformed template JSON should not block the submit
        }
      }
    }
    // ────────────────────────────────────────────────────────────────────────────

    // Validate accountId if provided
    let validatedAccountId: string | undefined;
    if (typeof accountId === "string" && accountId) {
      const account = await prisma.instagramAccount.findUnique({
        where: { id: accountId },
        select: { id: true },
      });
      if (account) validatedAccountId = account.id;
    }

    // Validate publicationSlotId if provided.
    // Fix bug 2026-05-30 : si le slot a déjà un render ERROR (relance après échec),
    // on délie l'ancien (publicationSlotId = null) pour permettre au NOUVEAU render
    // d'être linké au slot et donc affiché dans la fiche. Sans ça, le nouveau render
    // était créé sans publicationSlotId → invisible dans /publications/[id] qui
    // continuait d'afficher l'ancien ERROR.
    // L'ancien render reste en DB pour audit (status ERROR + usedAssets préservés).
    let validatedSlotId: string | undefined;
    if (typeof publicationSlotId === "string" && publicationSlotId) {
      const slot = await prisma.publicationSlot.findUnique({
        where: { id: publicationSlotId },
        select: { id: true, render: { select: { id: true, status: true } } },
      });
      if (slot) {
        if (!slot.render) {
          validatedSlotId = slot.id;
        } else if (slot.render.status === "ERROR") {
          await prisma.render.update({
            where: { id: slot.render.id },
            data: { publicationSlotId: null },
          });
          validatedSlotId = slot.id;
        } else if (
          slot.render.status === "PENDING" ||
          slot.render.status === "PROCESSING"
        ) {
          // Fix 2026-05-31 : avant, on créait silencieusement un Render orphelin
          // (sans publicationSlotId) qui tournait quand même sur RunPod et
          // consommait la rotation, invisible depuis la fiche. Désormais on
          // refuse explicitement avec un 409 pour que le client gère le double-clic
          // ou la double-soumission.
          return NextResponse.json(
            {
              error: "Un rendu est déjà en cours pour ce slot.",
              renderId: slot.render.id,
              status: slot.render.status,
            },
            { status: 409 },
          );
        }
        // Si slot.render est en DONE, on ne touche pas (le nouveau render sera
        // créé sans publicationSlotId — comportement legacy à revisiter).
      }
    }

    // Advance library cursors and audio usage server-side at submission time.
    // This replaces the prefill-time advance so abandoning the generate page no longer
    // wastes a rotation slot.
    if (sanitizedUsedAssets.setSequencedLibraryIds?.length && validatedAccountId) {
      const advance = await advanceLibraryCursorsOnSubmit(
        sanitizedUsedAssets.setSequencedLibraryIds,
        sanitizedUsedAssets.usedSetTagByLibrary ?? {},
        sanitizedUsedAssets.usedCategoryByLibrary ?? {},
        validatedAccountId,
      );
      if (Object.keys(advance.prevCursorStateByLibrary).length > 0) {
        sanitizedUsedAssets.prevCursorStateByLibrary = advance.prevCursorStateByLibrary;
      }
      if (Object.keys(advance.usedSetTagByLibrary).length > 0) {
        sanitizedUsedAssets.usedSetTagByLibrary = advance.usedSetTagByLibrary;
      }
      if (Object.keys(advance.usedCategoryByLibrary).length > 0) {
        sanitizedUsedAssets.usedCategoryByLibrary = advance.usedCategoryByLibrary;
      }
    }
    if (sanitizedUsedAssets.audioAssetId && validatedAccountId) {
      const audioAsset = await prisma.mediaAsset.findUnique({
        where: { id: sanitizedUsedAssets.audioAssetId },
        select: { libraryId: true },
      });
      if (audioAsset?.libraryId) {
        const audioAdvance = await advanceAudioUsageOnSubmit(
          sanitizedUsedAssets.audioAssetId,
          validatedAccountId,
          audioAsset.libraryId,
        );
        if (audioAdvance) {
          sanitizedUsedAssets.prevAudioUsageState = audioAdvance.prevAudioUsageState;
        }
      }
    }

    // Phase 3.D — Advance AccountDataLibraryCursor for the DataLibrary if the submit
    // contains group hints (resolvedSetTag/resolvedCategory from the prefill).
    // Only runs when validatedAccountId is present and a dataEntryId was submitted.
    //
    // Phase 3.B: advanceDataLibraryCursorOnSubmit now handles both shared and per_account
    // scope, returning the effectiveCursorId so we store it correctly in the revert snapshot.
    //
    // Code-reviewer C1 + M5 fix : ordre des opérations critiquissime — d'abord le
    // CLAIM DataEntry (qui peut re-pick une autre entry), PUIS l'advance cursor
    // DataLibrary basé sur l'entry RÉELLEMENT claim. Cela évite la désync :
    // - Si on advance le cursor sur l'entry initiale et que le claim re-pick une
    //   autre entry, le cursor pointe vers la mauvaise catégorie/setTag.
    // - Si on advance après le claim, on lit la campaignId/libraryId de l'entry
    //   définitivement claim.
    //
    // En bonus : on fusionne les 2 findUnique précédents (C1 + L3) en un seul
    // include qui charge campaignId + libraryId d'un coup, après le claim.

    // ── Phase 8.M1: Claim DataEntry au submit (PAS au prefill) ─────────────
    // Mirror du flow Media : selectDataEntry est désormais readOnly au prefill,
    // et le claim définitif (INSERT DataEntryUsage usageCount=0 ou UPDATE
    // usedInCycle=true) se fait ICI au submit, atomiquement avec FOR UPDATE.
    //
    // Si l'entry suggérée n'est plus disponible (claim concurrent), la
    // fonction fallback sur un re-pick. Best-effort : si tout échoue, le
    // render se fait quand même mais sans claim → recordLibraryUsage au DONE
    // incrémentera l'usage standard.
    if (sanitizedUsedAssets.dataEntryId) {
      // Charge la campaignId + libraryId d'un coup pour les 2 opérations qui
      // suivent (claim + cursor advance). Fusion C1/L3 du code-reviewer.
      const initialEntry = await prisma.dataEntry.findUnique({
        where: { id: sanitizedUsedAssets.dataEntryId },
        select: { campaignId: true, campaign: { select: { libraryId: true } } },
      });
      if (initialEntry?.campaignId) {
        // 1. Claim — peut re-pick une autre entry.
        const dataClaim = await advanceDataEntryClaimOnSubmit(
          initialEntry.campaignId,
          sanitizedUsedAssets.dataEntryId,
          validatedAccountId ?? undefined,
        );
        if (dataClaim) {
          sanitizedUsedAssets.prevDataEntryState = {
            entryId: dataClaim.claimState.entryId,
            campaignId: dataClaim.claimState.campaignId,
            usagePolicy: dataClaim.claimState.usagePolicy,
            claimType: dataClaim.claimState.claimType,
            accountId: dataClaim.claimState.accountId,
          };
          // If re-pick changed the entry, update dataEntryId so usage tracking is consistent.
          if (dataClaim.claimState.entryId !== sanitizedUsedAssets.dataEntryId) {
            sanitizedUsedAssets.dataEntryId = dataClaim.claimState.entryId;
          }
        }

        // 2. Advance cursor DataLibrary — basé sur l'entry FINAL (après claim).
        //    Re-fetch si l'entry a changé pour avoir le bon libraryId (case re-pick
        //    cross-campaign rare mais documenté en C1). Sinon réutilise initialEntry.
        if (validatedAccountId &&
            (sanitizedUsedAssets.dataResolvedSetTag !== undefined || sanitizedUsedAssets.dataResolvedCategory !== undefined)) {
          let finalLibraryId = initialEntry.campaign?.libraryId;
          if (dataClaim && dataClaim.claimState.entryId !== initialEntry.campaignId) {
            // L'entry a changé suite à re-pick. Re-fetch pour récupérer le bon libraryId.
            const refetched = await prisma.dataEntry.findUnique({
              where: { id: sanitizedUsedAssets.dataEntryId },
              select: { campaign: { select: { libraryId: true } } },
            });
            finalLibraryId = refetched?.campaign?.libraryId;
          }
          if (finalLibraryId) {
            const dataAdvance = await advanceDataLibraryCursorOnSubmit(
              finalLibraryId,
              sanitizedUsedAssets.dataResolvedSetTag ?? null,
              sanitizedUsedAssets.dataResolvedCategory ?? null,
              validatedAccountId,
            );
            if (dataAdvance.prevState !== null && dataAdvance.effectiveCursorId !== null) {
              sanitizedUsedAssets.prevDataLibraryCursorState = {
                libraryId: finalLibraryId,
                accountId: dataAdvance.effectiveCursorId,
                prevLastUsedSetTag: dataAdvance.prevState.lastUsedSetTag,
                prevLastUsedCategory: dataAdvance.prevState.lastUsedCategory,
                claimedSetTag: sanitizedUsedAssets.dataResolvedSetTag ?? null,
                claimedCategory: sanitizedUsedAssets.dataResolvedCategory ?? null,
              };
            }
          }
        }
      }
    }

    // Créer le render en PENDING.
    // Fix bug audit 2026-05-30 (C3) : si la création échoue, on revert les
    // advances de cursors / audio qui viennent d'être appliqués pour ne pas
    // biaiser la rotation (un asset "saute" son tour sans render associé).
    let render;
    try {
      render = await prisma.render.create({
        data: {
          templateId,
          listingId,
          status: "PENDING",
          usedAssets: JSON.stringify(sanitizedUsedAssets),
          ...(validatedAccountId ? { accountId: validatedAccountId } : {}),
          ...(validatedSlotId ? { publicationSlotId: validatedSlotId } : {}),
        },
      });
    } catch (createErr) {
      await revertAdvancesOnFailure(sanitizedUsedAssets);
      throw createErr;
    }

    // Fix bug audit 2026-05-30 (C4) : kickoff AVANT l'auto-transition pipeline.
    // Anciennement, on faisait transition → kickoff. Si kickoff retournait
    // "missing", le slot était bloqué en IN_PROGRESS sans render actif.
    const kickoff = await startRenderGeneration(render.id);
    if (kickoff === "missing") {
      // Revert advances + delete render orphelin pour ne pas laisser de PENDING figé.
      await revertAdvancesOnFailure(sanitizedUsedAssets);
      await prisma.render.delete({ where: { id: render.id } }).catch(() => {});
      return NextResponse.json({ error: "Render introuvable après création" }, { status: 500 });
    }

    // Auto-transition pipeline UNIQUEMENT après confirmation kickoff OK.
    // Best-effort — n'échoue jamais le POST.
    if (validatedSlotId) {
      await applyAutoTransitionFromPipeline(
        prisma,
        validatedSlotId,
        "RENDER_STARTED",
      );
    }

    return NextResponse.json(render, { status: 201 });
  } catch (err) {
    console.error("[POST /api/renders]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
