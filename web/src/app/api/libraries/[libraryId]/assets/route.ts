import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { prisma } from "@/lib/prisma";
import {
  buildAssetsAccessWhere,
  buildAssetsBurnWhere,
  buildTagRulesWhere,
  parseTagRuleParams,
  resolveBurnAccountId,
  resolveUsageKey,
} from "@/lib/generate/libraryAssetsQuery";

type Params = { params: Promise<{ libraryId: string }> };

// GET /api/libraries/[libraryId]/assets
// Auth-gated (no admin required) — returns public asset list for a library.
// Used by the generation form library picker for all authenticated users.
//
// P5 hardening (21/08) — cette route reste volontairement en Prisma ORM
// (`findMany`), PAS en SQL brut : les helpers importés ci-dessus (mirror de
// `buildAccessFilter`/`buildBurnFilter`/`buildTagFragment`,
// contentLibraryResolver.ts) rejouent la même sémantique en `WhereInput`.
// Voir le commentaire croisé sur `buildAccessFilter` dans ce fichier.
export async function GET(req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const { libraryId } = await params;

  const library = await prisma.mediaLibrary.findUnique({
    where: { id: libraryId },
    select: { id: true, maxUsageCount: true, rotationScope: true },
  });
  if (!library) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }

  // Optional tag filter — case-insensitive (legacy: résolu côté client depuis
  // tagFilterParam). A.4 : `tagRules` (règles avancées — tagConditions +
  // operator, ou tagFilter littéral) prime dessus quand transmis, voir
  // `buildTagRulesWhere`.
  const tag = req.nextUrl.searchParams.get("tag")?.trim().toLowerCase() ?? "";
  const tagRules = parseTagRuleParams(req.nextUrl.searchParams.get("tagRules"));
  // Optional accountId — when present, filters to accessible assets and returns per-account stats
  const accountId = req.nextUrl.searchParams.get("accountId")?.trim() || null;
  // A.6 : minDuration n'exclut plus rien côté serveur — les assets trop courts
  // sont renvoyés et grisés côté client (LibraryPicker.tsx), qui reçoit déjà
  // `minDuration` depuis `fieldLibraryMap`. Avant ce fix, un asset sous le
  // seuil disparaissait silencieusement de la liste — le bandeau
  // « vidéos en gris » du picker n'avait donc jamais rien à afficher.

  const tagWhere = buildTagRulesWhere(tag, tagRules);
  // A.2 : sans accountId, reste strict (accesses: none) — voir le commentaire
  // de `buildAssetsAccessWhere` (fail-closed, revert post revue de sécurité).
  const accessWhere = buildAssetsAccessWhere(accountId);
  // A.3 : disabled=false toujours exclu (avant ce fix, un asset désactivé
  // pouvait apparaître dans le picker) + burn-once (maxUsageCount atteint).
  const burnAccountId = resolveBurnAccountId(library.rotationScope, accountId);
  const burnWhere = buildAssetsBurnWhere(library.maxUsageCount, burnAccountId);
  const disabledWhere = { disabled: false };

  // A.7 : clé de jointure des compteurs d'usage — sentinelle __shared__ pour
  // les libs en scope shared (avant ce fix, toujours le compte réel : les
  // compteurs affichés pour une lib shared étaient systématiquement à 0).
  const usageKey = resolveUsageKey(library.rotationScope, accountId);

  if (usageKey) {
    // Per-account (ou shared, via la sentinelle) path : fetch avec stats
    // d'usage scopées, tri en JS (impossible d'orderBy sur une relation).
    const rawAssets = await prisma.mediaAsset.findMany({
      where: { libraryId, ...tagWhere, ...accessWhere, ...burnWhere, ...disabledWhere },
      select: {
        id: true,
        filename: true,
        url: true,
        mimeType: true,
        duration: true,
        usageCount: true,
        lastUsedAt: true,
        usages: {
          where: { accountId: usageKey },
          select: { usageCount: true, lastUsedAt: true },
          take: 1,
        },
      },
    });

    const assets = rawAssets
      .map((a) => ({
        id: a.id,
        filename: a.filename,
        url: a.url,
        mimeType: a.mimeType,
        duration: a.duration,
        // Prefer per-account (or shared) stats; fall back to global when no usage row exists yet
        usageCount: a.usages[0]?.usageCount ?? 0,
        lastUsedAt: a.usages[0]?.lastUsedAt ?? null,
      }))
      .sort((a, b) => {
        if (a.usageCount !== b.usageCount) return a.usageCount - b.usageCount;
        const aTime = a.lastUsedAt ? (a.lastUsedAt as unknown as Date).getTime() : -Infinity;
        const bTime = b.lastUsedAt ? (b.lastUsedAt as unknown as Date).getTime() : -Infinity;
        return aTime - bTime;
      });

    return NextResponse.json(assets);
  }

  // Global path: no accountId — use global counters, sort by usageCount ASC (matches least_used resolver)
  const assets = await prisma.mediaAsset.findMany({
    where: { libraryId, ...tagWhere, ...accessWhere, ...burnWhere, ...disabledWhere },
    orderBy: [{ usageCount: "asc" }, { lastUsedAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      filename: true,
      url: true,
      mimeType: true,
      duration: true,
      usageCount: true,
      lastUsedAt: true,
    },
  });

  return NextResponse.json(assets);
}
