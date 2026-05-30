import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { hasTool, TOOLS } from "@/lib/permissions";
import { startRenderGeneration } from "@/lib/renderer/generateRender";
import { advanceLibraryCursorsOnSubmit, advanceAudioUsageOnSubmit } from "@/lib/contentLibraryResolver";
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
      cursorAccountId?: string;
    }
  >;
  prevAudioUsageState?: {
    assetId: string;
    accountId: string;
    prevLastUsedAt: string | null;
    claimedLastUsedAt: string;
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
              "lastUsedCategory" = ${state.prevLastUsedCategory}
          WHERE "accountId" = ${cursorAccountId}
            AND "libraryId" = ${libraryId}
            AND cursor IS NOT DISTINCT FROM ${state.claimedCursor}
            AND "lastUsedCategory" IS NOT DISTINCT FROM ${state.claimedLastUsedCategory}
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
      setSequencedLibraryIds?: string[];
      usedSetTagByLibrary?: Record<string, string>;
      usedCategoryByLibrary?: Record<string, string>;
      prevCursorStateByLibrary?: Record<string, { prevCursor: number; claimedCursor: number; prevLastUsedCategory: string | null; claimedLastUsedCategory: string | null; cursorAccountId?: string }>;
      prevDataEntryState?: { entryId: string; campaignId: string; usagePolicy: string; claimType: string; accountId?: string };
      prevAudioUsageState?: { assetId: string; accountId: string; prevLastUsedAt: string | null; claimedLastUsedAt: string };
    } = {};

    if (usedAssets && typeof usedAssets === "object") {
    const raw = usedAssets as { videoAssets?: unknown; audioAssetId?: unknown; dataEntryId?: unknown; setSequencedLibraryIds?: unknown; usedSetTagByLibrary?: unknown; usedCategoryByLibrary?: unknown; prevDataEntryState?: unknown };

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

      // prevDataEntryState — claim state for DataEntry failure-recovery revert.
      if (raw.prevDataEntryState && typeof raw.prevDataEntryState === "object" && !Array.isArray(raw.prevDataEntryState)) {
        const s = raw.prevDataEntryState as Record<string, unknown>;
        if (typeof s.entryId === "string" && typeof s.campaignId === "string"
          && typeof s.usagePolicy === "string"
          && (s.claimType === "usedInCycle" || s.claimType === "perAccountUsage")
          && (s.accountId === undefined || typeof s.accountId === "string")) {
          sanitizedUsedAssets.prevDataEntryState = {
            entryId: s.entryId,
            campaignId: s.campaignId,
            usagePolicy: s.usagePolicy,
            claimType: s.claimType,
            accountId: s.accountId as string | undefined,
          };
        }
      }

    }

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
        }
        // Si slot.render est en PENDING/PROCESSING/DONE, on ne touche pas
        // (un render actif ne doit pas être détaché silencieusement, et un
        // render DONE est la version courante du slot).
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
