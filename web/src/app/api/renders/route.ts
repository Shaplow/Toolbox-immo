import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import { hasTool, TOOLS } from "@/lib/permissions";
import { startRenderGeneration } from "@/lib/renderer/generateRender";
import { advanceMediaUsageOnSubmit, advanceAudioUsageOnSubmit, advanceDataUsageOnSubmit, type MediaUsageClaimState, type DataUsageClaimState } from "@/lib/contentLibraryResolver";
import { applyAutoTransitionFromPipeline } from "@/lib/services/slot/transitions";
import { validateManualAssetSelection } from "@/lib/generate/validateManualAssetSelection";

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
  /**
   * Snapshots legacy de curseurs (renders en vol créés avant le
   * décommissionnement des AccountLibraryCursor, plan simplification Phase 3).
   * Le revert est TOLÉRANT : best-effort tant que la table existe encore,
   * silencieux après son drop. Champ à retirer au drop N+1.
   */
  prevCursorStateByLibrary?: Record<
    string,
    {
      prevCursor: number;
      claimedCursor: number;
      prevLastUsedCategory: string | null;
      claimedLastUsedCategory: string | null;
      prevLastUsedSetTag: string | null;
      claimedLastUsedSetTag: string | null;
      cursorAccountId?: string;
    }
  >;
  /** Claims d'usage vidéo posés au submit (advanceMediaUsageOnSubmit). */
  prevMediaUsageStates?: MediaUsageClaimState[];
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
  /** Bug-hunter B2 : claim DataEntry à revert si le render kickoff fail. */
  prevDataEntryState?: {
    entryId: string;
    campaignId: string;
    usagePolicy: string;
    claimType: "usedInCycle" | "perAccountUsage";
    accountId?: string;
  };
  /** Claim d'usage DataEntry posé au submit (Phase 4) — revert CAS. */
  prevDataUsageState?: DataUsageClaimState;
}) {
  // Revert du claim d'usage DataEntry (Phase 4 — même CAS que vidéo/audio).
  if (usedAssets.prevDataUsageState) {
    const { entryId, accountId, prevLastUsedAt, claimedLastUsedAt } = usedAssets.prevDataUsageState;
    try {
      if (prevLastUsedAt === null) {
        await prisma.$executeRaw(Prisma.sql`
          DELETE FROM "DataEntryUsage"
          WHERE "entryId" = ${entryId} AND "accountId" = ${accountId}
            AND "usageCount" = 0
            AND "lastUsedAt" = ${new Date(claimedLastUsedAt)}
        `);
      } else {
        await prisma.$executeRaw(Prisma.sql`
          UPDATE "DataEntryUsage"
          SET "lastUsedAt" = ${new Date(prevLastUsedAt)}
          WHERE "entryId" = ${entryId} AND "accountId" = ${accountId}
            AND "lastUsedAt" = ${new Date(claimedLastUsedAt)}
        `);
      }
    } catch (err) {
      console.error(`[revertAdvancesOnFailure] data usage revert failed entry=${entryId}:`, err);
    }
  }
  if (usedAssets.prevCursorStateByLibrary) {
    for (const [libraryId, state] of Object.entries(usedAssets.prevCursorStateByLibrary)) {
      const cursorAccountId = state.cursorAccountId;
      if (!cursorAccountId) continue;
      try {
        // Phase W2.6 : on remet aussi lastAdvancedAt=NULL pour que la prochaine
        // génération ne pense pas que ce compte a "déjà joué" (hasHistory=true)
        // et n'applique pas une exclusion catégorie fantôme — finding rotation-10.
        await prisma.$executeRaw(Prisma.sql`
          UPDATE "AccountLibraryCursor"
          SET cursor = ${state.prevCursor},
              "lastUsedCategory" = ${state.prevLastUsedCategory},
              "lastUsedSetTag"   = ${state.prevLastUsedSetTag},
              "lastAdvancedAt"   = NULL
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
  // Revert des claims d'usage vidéo (même CAS que l'audio ci-dessous).
  for (const state of usedAssets.prevMediaUsageStates ?? []) {
    const { assetId, accountId, prevLastUsedAt, claimedLastUsedAt } = state;
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
      console.error(`[revertAdvancesOnFailure] media usage revert failed asset=${assetId}:`, err);
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
  // Bug-hunter B2 : DataEntry claim revert — sans ça, un kickoff failure
  // laisse le claim (usedInCycle=true ou DataEntryUsage usageCount=0) en DB
  // sans render correspondant → l'entry est "consommée" sans avoir servi.
  if (usedAssets.prevDataEntryState) {
    const { entryId, claimType, accountId } = usedAssets.prevDataEntryState;
    try {
      if (claimType === "usedInCycle") {
        // CAS revert : seulement si usageCount=0 (= claim non encore consommé par recordUsage).
        await prisma.$executeRaw(Prisma.sql`
          UPDATE "DataEntry"
          SET "usedInCycle" = false
          WHERE id = ${entryId}
            AND "usedInCycle" = true
            AND "usageCount" = 0
        `);
      } else if (claimType === "perAccountUsage" && accountId) {
        // Delete claim row uniquement si usageCount=0 (préserve les vraies consommations).
        await prisma.$executeRaw(Prisma.sql`
          DELETE FROM "DataEntryUsage"
          WHERE "entryId" = ${entryId}
            AND "accountId" = ${accountId}
            AND "usageCount" = 0
        `);
      }
    } catch (err) {
      console.error(`[revertAdvancesOnFailure] DataEntry claim revert failed entryId=${entryId}:`, err);
    }
  }
}

// POST /api/renders — déclenche une génération
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (auth.response) return auth.response;
    const userContext = auth.ctx;
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
      /** Claims d'usage vidéo posés au submit — pour revert conditionnel. */
      prevMediaUsageStates?: MediaUsageClaimState[];
      /** Claim d'usage DataEntry posé au submit (Phase 4) — pour revert conditionnel. */
      prevDataUsageState?: DataUsageClaimState;
      prevAudioUsageState?: { assetId: string; accountId: string; prevLastUsedAt: string | null; claimedLastUsedAt: string };
    } = {};

    if (usedAssets && typeof usedAssets === "object") {
    const raw = usedAssets as { videoAssets?: unknown; audioAssetId?: unknown; dataEntryId?: unknown; setSequencedLibraryIds?: unknown; usedSetTagByLibrary?: unknown };

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

      // Phase 8.M1 : prevDataEntryState n'est plus accepté du body client.
      // Le claim DataEntry est désormais posé côté serveur via
      // advanceDataEntryClaimOnSubmit (voir plus bas), exactement comme
      // advanceLibraryCursorsOnSubmit gère le claim Media. Cela élimine le
      // vecteur d'attaque C1 (client trustait l'entryId) ET le claim leak
      // M1 (claim au prefill qui ne se libère jamais si l'user abandonne).
    }

    // Validate accountId if provided — calculé AVANT la validation des assets
    // choisis manuellement (A.9 ci-dessous) : elle en a besoin pour vérifier
    // l'accès (MediaAssetAccess) de chaque asset pour ce compte.
    let validatedAccountId: string | undefined;
    if (typeof accountId === "string" && accountId) {
      const account = await prisma.instagramAccount.findUnique({
        where: { id: accountId },
        select: { id: true },
      });
      if (account) validatedAccountId = account.id;
    }

    // ── A.9 (P5 hardening) + Phase 4 minDuration validation ─────────────────
    // Pour chaque asset choisi MANUELLEMENT (sanitizedUsedAssets.videoAssets /
    // audioAssetId), re-valide côté serveur : appartenance à la bibliothèque
    // du bloc/slot, `disabled === false`, accès autorisé pour le compte
    // (mirror de `buildAccessFilter`, voir `validateManualAssetSelection.ts`)
    // — avant ce fix, seule l'EXISTENCE de l'ID en base était vérifiée
    // (`prisma.mediaAsset.findMany({ id: { in: ids } })` plus haut) : un
    // payload trafiqué (ou un picker resté ouvert sur un contexte obsolète)
    // pouvait faire passer un asset désactivé, d'une autre bibliothèque, ou
    // restreint à un autre compte. Les assets AUTO-sélectionnés sont déjà
    // filtrés en amont par `selectAndClaimMediaAsset` — ce garde ne protège
    // que le chemin manuel (picker "Changer").
    //
    // Réutilise le même fetch groupé d'assets pour la validation de durée
    // minimale déjà en place (Phase 4) : AUTO-sélectionnés déjà filtrés par
    // `selectAndClaimMediaAsset`'s minDuration, ce check garde contre un
    // payload trafiqué qui contournerait l'état désactivé du picker.
    if (sanitizedUsedAssets.videoAssets || sanitizedUsedAssets.audioAssetId) {
      const templateRow = await prisma.template.findUnique({
        where: { id: templateId },
        select: { jsonData: true },
      });
      if (templateRow?.jsonData) {
        try {
          const tplJson = JSON.parse(templateRow.jsonData) as {
            blocks?: Array<{ id: string; type: string; minDuration?: number; name?: string; libraryId?: string }>;
            videoSequence?: Array<{ id: string; libraryId?: string; label?: string; binding?: string }>;
          };
          const blocks = tplJson.blocks ?? [];
          const videoSequenceSlots = tplJson.videoSequence ?? [];

          // Bibliothèque attendue par clé de bloc/slot — mirror serveur de
          // `fieldLibraryMap` (buildLibraryPrefillContext.ts), reconstruit ici
          // pour ne pas faire confiance au payload client. Une clé de
          // `videoAssets` sans entrée ici (bloc/slot introuvable dans le
          // template actuel) n'est PAS bloquée sur l'appartenance — seuls
          // disabled/accès restent vérifiés (permissif : pas de faux-positif
          // sur un mapping qu'on ne sait plus reconstruire côté serveur).
          const expectedLibraryIdByBlockKey: Record<string, string> = {};
          const blockNameByKey: Record<string, string> = {};
          for (const block of blocks) {
            if (block.type === "video" && block.libraryId) {
              expectedLibraryIdByBlockKey[block.id] = block.libraryId;
              blockNameByKey[block.id] = block.name ?? block.id;
            }
          }
          for (const slot of videoSequenceSlots) {
            if (slot.libraryId) {
              expectedLibraryIdByBlockKey[slot.id] = slot.libraryId;
              blockNameByKey[slot.id] = slot.label ?? slot.binding ?? slot.id;
            }
          }
          const musicBlock = blocks.find((b) => b.type === "music");

          const chosenAssetIds = Array.from(new Set([
            ...(sanitizedUsedAssets.videoAssets ? Object.values(sanitizedUsedAssets.videoAssets) : []),
            ...(sanitizedUsedAssets.audioAssetId ? [sanitizedUsedAssets.audioAssetId] : []),
          ]));
          const chosenAssetRows = chosenAssetIds.length > 0
            ? await prisma.mediaAsset.findMany({
                where: { id: { in: chosenAssetIds } },
                select: {
                  id: true,
                  libraryId: true,
                  disabled: true,
                  duration: true,
                  filename: true,
                  accesses: { select: { accountId: true } },
                },
              })
            : [];
          const chosenAssetRowById = new Map(chosenAssetRows.map((a) => [a.id, a]));

          // ── A.9 : appartenance lib / disabled / accès ─────────────────────
          for (const [blockKey, chosenAssetId] of Object.entries(sanitizedUsedAssets.videoAssets ?? {})) {
            const row = chosenAssetRowById.get(chosenAssetId);
            const validationError = validateManualAssetSelection(
              row
                ? { id: row.id, libraryId: row.libraryId, disabled: row.disabled, accessAccountIds: row.accesses.map((a) => a.accountId) }
                : undefined,
              expectedLibraryIdByBlockKey[blockKey],
              validatedAccountId,
            );
            if (validationError) {
              return NextResponse.json(
                { error: `Vidéo "${blockNameByKey[blockKey] ?? blockKey}" : ${validationError}` },
                { status: 400 },
              );
            }
          }
          if (sanitizedUsedAssets.audioAssetId) {
            const row = chosenAssetRowById.get(sanitizedUsedAssets.audioAssetId);
            const validationError = validateManualAssetSelection(
              row
                ? { id: row.id, libraryId: row.libraryId, disabled: row.disabled, accessAccountIds: row.accesses.map((a) => a.accountId) }
                : undefined,
              musicBlock?.libraryId,
              validatedAccountId,
            );
            if (validationError) {
              return NextResponse.json(
                { error: `Musique "${musicBlock?.name ?? "piste audio"}" : ${validationError}` },
                { status: 400 },
              );
            }
          }

          // ── Phase 4 : minDuration (durée minimale requise par le bloc) ───
          for (const block of blocks) {
            if (
              block.type === "video" &&
              block.minDuration != null &&
              block.minDuration > 0 &&
              block.libraryId
            ) {
              const chosenAssetId = sanitizedUsedAssets.videoAssets?.[block.id];
              if (chosenAssetId) {
                const assetRow = chosenAssetRowById.get(chosenAssetId);
                if (assetRow?.duration == null) {
                  // Bug-hunter B10 : un asset sans duration probée bypasse le check
                  // silencieusement. Si le template impose une minDuration explicite,
                  // on refuse pour forcer un re-upload ou un backfill admin plutôt
                  // que produire une vidéo cassée.
                  return NextResponse.json(
                    {
                      error: `Vidéo "${block.name ?? block.id}" : durée de l'asset "${assetRow?.filename ?? chosenAssetId}" inconnue — re-uploadez le fichier ou lancez un backfill duration (admin).`,
                    },
                    { status: 400 },
                  );
                }
                if (assetRow.duration < block.minDuration) {
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
          const musicBlockWithMinDuration = blocks.find((b) => b.type === "music" && b.minDuration != null && b.minDuration > 0);
          if (musicBlockWithMinDuration && sanitizedUsedAssets.audioAssetId) {
            const assetRow = chosenAssetRowById.get(sanitizedUsedAssets.audioAssetId);
            if (assetRow?.duration == null) {
              return NextResponse.json(
                {
                  error: `Musique "${musicBlockWithMinDuration.name ?? "piste audio"}" : durée de "${assetRow?.filename ?? sanitizedUsedAssets.audioAssetId}" inconnue — re-uploadez le fichier ou lancez un backfill duration (admin).`,
                },
                { status: 400 },
              );
            }
            if (assetRow.duration < musicBlockWithMinDuration.minDuration!) {
              return NextResponse.json(
                {
                  error: `Musique "${musicBlockWithMinDuration.name ?? "piste audio"}" : durée insuffisante (${assetRow.duration}s disponibles, ${musicBlockWithMinDuration.minDuration}s requis)`,
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

    // Fix #6 (P8 rotation) : dérivation serveur de setSequencedLibraryIds /
    // usedSetTagByLibrary, calculée ICI — AVANT la garde rotation juste en
    // dessous — pour qu'elle s'appuie sur les bibliothèques réellement
    // consommées par les assets choisis plutôt que sur le seul payload
    // client (vide en régénération : buildLibraryPrefillContext saute
    // resolveLibraryPrefill quand listingId est présent, cf. skill
    // asset-rotation). Sans ce réordonnancement, une régénération sans
    // accountId sur une lib per_account passait la garde rotation
    // silencieusement (setSequencedLibraryIds encore vide côté client à ce
    // stade). `chosenAssetIdsForClaim` est réutilisé plus bas par
    // advanceMediaUsageOnSubmit pour éviter une seconde requête.
    let chosenAssetIdsForClaim: string[] = [];
    if (sanitizedUsedAssets.videoAssets && Object.keys(sanitizedUsedAssets.videoAssets).length > 0) {
      chosenAssetIdsForClaim = Array.from(new Set(Object.values(sanitizedUsedAssets.videoAssets)));

      // Superset volontairement large de la sémantique stricte "a utilisé
      // theme_sequence" (inclut aussi les libs en stratégie régulière) — sans
      // effet néfaste : recordLibraryUsage n'écrit alors qu'une ligne
      // MediaAssetUsage supplémentaire sous la sentinelle shared, jamais lue
      // par les stratégies régulières (elles trient sur MediaAsset directement).
      const chosenAssetLibs = await prisma.mediaAsset.findMany({
        where: { id: { in: chosenAssetIdsForClaim } },
        select: { id: true, libraryId: true, setTag: true, library: { select: { rotationMode: true } } },
      });
      const derivedSequencedLibraryIds = Array.from(
        new Set(
          chosenAssetLibs
            .filter((a) => a.library.rotationMode !== "none")
            .map((a) => a.libraryId),
        ),
      );
      if (derivedSequencedLibraryIds.length > 0) {
        sanitizedUsedAssets.setSequencedLibraryIds = Array.from(
          new Set([...(sanitizedUsedAssets.setSequencedLibraryIds ?? []), ...derivedSequencedLibraryIds]),
        );
        const derivedSetTag: Record<string, string> = { ...(sanitizedUsedAssets.usedSetTagByLibrary ?? {}) };
        const sequencedSet = new Set(derivedSequencedLibraryIds);
        for (const asset of chosenAssetLibs) {
          if (!sequencedSet.has(asset.libraryId)) continue;
          if (asset.setTag) derivedSetTag[asset.libraryId] = asset.setTag;
        }
        if (Object.keys(derivedSetTag).length > 0) {
          sanitizedUsedAssets.usedSetTagByLibrary = derivedSetTag;
        }
      }
    }

    // Garde rotation : une génération qui consomme une bibliothèque en rotation
    // `per_account` DOIT porter un compte. Sans lui, `recordLibraryUsage`
    // n'écrit aucune ligne `MediaAssetUsage` (elle est conditionnée à
    // `render.accountId`) : l'asset est consommé mais reste « jamais utilisé »
    // du point de vue du compte, et ressort en tête de la rotation suivante.
    //
    // Volontairement chirurgical : `PublicationSlot.accountId` est légitimement
    // nullable (missions sans compte) et les bibliothèques `shared` tournent
    // très bien sans compte, via les sentinelles de curseur.
    //
    // La garde s'appuie désormais sur setSequencedLibraryIds déjà re-dérivé
    // ci-dessus (fix #6) : elle voit donc aussi les libs per_account détectées
    // par re-dérivation serveur, pas seulement celles envoyées par le client.
    if (!validatedAccountId && sanitizedUsedAssets?.setSequencedLibraryIds?.length) {
      const perAccountLibs = await prisma.mediaLibrary.count({
        where: {
          id: { in: sanitizedUsedAssets.setSequencedLibraryIds },
          rotationScope: { not: "shared" },
        },
      });
      if (perAccountLibs > 0) {
        console.error(
          `[renders] refus : ${perAccountLibs} bibliothèque(s) en rotation par compte mais aucun accountId (template=${templateId}).`,
        );
        return NextResponse.json(
          { error: "Un compte Instagram est requis : ce template consomme une bibliothèque dont la rotation est propre à chaque compte." },
          { status: 400 },
        );
      }
    }

    // Validate publicationSlotId if provided.
    //
    // Un slot accumule un historique de rendus : le nouveau est TOUJOURS rattaché.
    // Avant, un re-render sur un slot dont le rendu était DONE partait orphelin
    // (`publicationSlotId` non posé, faute d'unicité disponible) : la fiche
    // continuait d'afficher l'ancienne vidéo, et toute la chaîne aval — hook de
    // complétion, transcription, sous-titres — naissait détachée du slot.
    //
    // Le rendu qui fait foi reste l'ancien : `currentRenderId` n'est promu qu'à
    // la complétion (onRenderCompleted). Un re-render qui échoue ne fait donc
    // rien perdre.
    let validatedSlotId: string | undefined;
    if (typeof publicationSlotId === "string" && publicationSlotId) {
      const slot = await prisma.publicationSlot.findUnique({
        where: { id: publicationSlotId },
        select: {
          id: true,
          renders: {
            where: { status: { in: ["PENDING", "PROCESSING"] } },
            select: { id: true, status: true },
            take: 1,
          },
        },
      });
      if (slot) {
        const inFlight = slot.renders[0];
        if (inFlight) {
          // Fix 2026-05-31 : avant, on créait silencieusement un Render orphelin
          // qui tournait quand même sur RunPod et consommait la rotation,
          // invisible depuis la fiche. Désormais on refuse explicitement avec un
          // 409 pour que le client gère le double-clic ou la double-soumission.
          return NextResponse.json(
            {
              error: "Un rendu est déjà en cours pour ce slot.",
              renderId: inFlight.id,
              status: inFlight.status,
            },
            { status: 409 },
          );
        }
        validatedSlotId = slot.id;
      }
    }

    // Claim d'usage vidéo server-side au submit (plan simplification Phase 3 —
    // remplace l'avance de curseur). Le stamp lastUsedAt fait redescendre le
    // dossier servi dans la pile du tirage ; abandonner la page generate ne
    // consomme donc toujours rien.
    // Bug-hunter B3 : on ne trust jamais les hints client — le setTag de trace
    // est re-dérivé depuis les assets effectivement choisis (DB, cf. bloc de
    // dérivation plus haut, avant la garde rotation).
    //
    // Fix #4 (P8 rotation) : `validatedAccountId` retiré de la garde — une
    // génération sans compte sur une lib `shared` doit quand même claimer
    // (sous la sentinelle __shared__, géré par advanceMediaUsageOnSubmit) ;
    // seule une lib `per_account` sans compte est réellement sautée (warn côté
    // advanceMediaUsageOnSubmit, best-effort par asset).
    if (chosenAssetIdsForClaim.length > 0) {
      const claim = await advanceMediaUsageOnSubmit(chosenAssetIdsForClaim, validatedAccountId);
      if (claim.prevMediaUsageStates.length > 0) {
        sanitizedUsedAssets.prevMediaUsageStates = claim.prevMediaUsageStates;
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

    // ── Claim d'usage DataEntry au submit (plan simplification Phase 4) ────
    // Remplace le claim par policy + l'avance de curseur DataLibrary : simple
    // stamp DataEntryUsage.lastUsedAt (clé per-account ou __shared__data__),
    // même contrat que les claims vidéo/audio ci-dessus. Best-effort : si le
    // claim échoue, le render se fait quand même — recordLibraryUsage au DONE
    // incrémentera l'usage standard.
    if (sanitizedUsedAssets.dataEntryId) {
      const dataClaim = await advanceDataUsageOnSubmit(
        sanitizedUsedAssets.dataEntryId,
        validatedAccountId ?? undefined,
      );
      if (dataClaim) {
        sanitizedUsedAssets.prevDataUsageState = dataClaim.prevDataUsageState;
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
