import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasTool, TOOLS } from "@/lib/permissions";
import { startRenderGeneration } from "@/lib/renderer/generateRender";
import { IMPERSONATION_COOKIE_NAME, resolveUserContext } from "@/lib/userContext";

// POST /api/renders — déclenche une génération
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const userContext = await resolveUserContext(session, req.cookies.get(IMPERSONATION_COOKIE_NAME)?.value ?? null);
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
      prevCursorStateByLibrary?: Record<string, { prevCursor: number; claimedCursor: number; prevLastUsedCategory: string | null; claimedLastUsedCategory: string | null }>;
      prevDataEntryState?: { entryId: string; campaignId: string; usagePolicy: string; claimType: string; accountId?: string };
    } = {};

    if (usedAssets && typeof usedAssets === "object") {
    const raw = usedAssets as { videoAssets?: unknown; audioAssetId?: unknown; dataEntryId?: unknown; setSequencedLibraryIds?: unknown; usedSetTagByLibrary?: unknown; usedCategoryByLibrary?: unknown; prevCursorStateByLibrary?: unknown; prevDataEntryState?: unknown };

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

      // prevCursorStateByLibrary — cursor snapshots for failure-recovery revert.
      // Validate shape: each value must have the four expected numeric/nullable-string fields.
      if (raw.prevCursorStateByLibrary && typeof raw.prevCursorStateByLibrary === "object" && !Array.isArray(raw.prevCursorStateByLibrary)) {
        const map = raw.prevCursorStateByLibrary as Record<string, unknown>;
        const sanitized: Record<string, { prevCursor: number; claimedCursor: number; prevLastUsedCategory: string | null; claimedLastUsedCategory: string | null }> = {};
        for (const [libId, v] of Object.entries(map)) {
          if (v && typeof v === "object" && !Array.isArray(v)) {
            const s = v as Record<string, unknown>;
            if (typeof s.prevCursor === "number" && typeof s.claimedCursor === "number"
              && (s.prevLastUsedCategory === null || typeof s.prevLastUsedCategory === "string")
              && (s.claimedLastUsedCategory === null || typeof s.claimedLastUsedCategory === "string")) {
              sanitized[libId] = {
                prevCursor: s.prevCursor,
                claimedCursor: s.claimedCursor,
                prevLastUsedCategory: s.prevLastUsedCategory as string | null,
                claimedLastUsedCategory: s.claimedLastUsedCategory as string | null,
              };
            }
          }
        }
        if (Object.keys(sanitized).length > 0) sanitizedUsedAssets.prevCursorStateByLibrary = sanitized;
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
      const account = await prisma.instagramAccount.findFirst({
        where: isAdmin
          ? { id: accountId }
          : { id: accountId, userId: userContext.effectiveUser.id },
        select: { id: true },
      });
      if (account) validatedAccountId = account.id;
    }

    // Validate publicationSlotId if provided — must exist and not already be linked
    let validatedSlotId: string | undefined;
    if (typeof publicationSlotId === "string" && publicationSlotId) {
      const slot = await prisma.publicationSlot.findUnique({
        where: { id: publicationSlotId },
        select: { id: true, render: { select: { id: true } } },
      });
      if (slot && !slot.render) validatedSlotId = slot.id;
      // If slot already has a render, ignore the link — don't error, just don't overwrite
    }

    // Créer le render en PENDING
    const render = await prisma.render.create({
      data: {
        templateId,
        listingId,
        status: "PENDING",
        usedAssets: JSON.stringify(sanitizedUsedAssets),
        ...(validatedAccountId ? { accountId: validatedAccountId } : {}),
        ...(validatedSlotId ? { publicationSlotId: validatedSlotId } : {}),
      },
    });

    const kickoff = await startRenderGeneration(render.id);
    if (kickoff === "missing") {
      return NextResponse.json({ error: "Render introuvable après création" }, { status: 500 });
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
