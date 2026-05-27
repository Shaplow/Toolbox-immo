/**
 * GET /api/admin/libraries/media/[id]/simulate-rotation?accountId=X
 *
 * Simule la prochaine sélection d'asset pour un compte IG donné, **sans**
 * avancer le curseur ni écrire d'usage. Utile pour debugger la rotation
 * depuis le panel admin.
 *
 * Réponse :
 *   {
 *     asset: { id, url, filename, setTag, category, lastUsedAt, usageCount } | null,
 *     rotationScope: "per_account" | "shared",
 *     cursor: { value, position, totalSlots } | null,   // override mode seulement
 *     reason: string,                                    // explication courte humaine
 *   }
 *
 * Auth : ADMIN uniquement (canAdminBypass).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import {
  selectMediaAssetBySetSequence,
  SHARED_CURSOR_ACCOUNT_ID,
} from "@/lib/contentLibraryResolver";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: libraryId } = await params;
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId") ?? undefined;

  if (!accountId) {
    return NextResponse.json(
      { error: "Le paramètre accountId est requis" },
      { status: 400 }
    );
  }

  const library = await prisma.mediaLibrary.findUnique({
    where: { id: libraryId },
    select: { id: true, rotationScope: true, setSequence: true },
  });
  if (!library) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }

  const account = await prisma.instagramAccount.findUnique({
    where: { id: accountId },
    select: { id: true, handle: true },
  });
  if (!account) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  // Determine cursorAccountId selon le rotationScope.
  const isShared = library.rotationScope === "shared";
  const cursorAccountId = isShared ? SHARED_CURSOR_ACCOUNT_ID : accountId;

  // Snapshot du curseur AVANT simulation (pour expliquer la position).
  const cursorBefore = await prisma.accountLibraryCursor.findUnique({
    where: { accountId_libraryId: { accountId: cursorAccountId, libraryId } },
    select: { cursor: true, lastUsedCategory: true },
  });

  let sequence: string[] = [];
  try {
    sequence = (JSON.parse(library.setSequence) as string[]).filter(Boolean);
  } catch {
    sequence = [];
  }

  // Lance la simulation en readOnly — aucune écriture DB.
  const picked = await selectMediaAssetBySetSequence(
    libraryId,
    accountId,
    undefined,           // tagFilter legacy
    undefined,           // pinnedSetTag
    undefined,           // pinnedCategory
    undefined,           // ruleConfig — defaults to least_used
    cursorAccountId,
    true,                // readOnly
  );

  if (!picked) {
    return NextResponse.json({
      asset: null,
      rotationScope: library.rotationScope ?? "per_account",
      cursor:
        sequence.length > 0
          ? {
              value: cursorBefore?.cursor ?? 0,
              position: ((cursorBefore?.cursor ?? 0) % sequence.length) + 1,
              totalSlots: sequence.length,
            }
          : null,
      reason:
        sequence.length === 0
          ? "Aucun setSequence configuré (mode auto). Vérifie qu'au moins un asset a un setTag/category éligible."
          : "Aucun asset éligible trouvé — vérifie les filtres d'accès et que des assets ne sont pas tous désactivés.",
    });
  }

  // Charge la metadata complète de l'asset pour l'affichage UI.
  const assetMeta = await prisma.mediaAsset.findUnique({
    where: { id: picked.id },
    select: {
      id: true,
      filename: true,
      url: true,
      setTag: true,
      category: true,
      lastUsedAt: true,
      usageCount: true,
    },
  });

  // Usage du compte spécifique (peut différer de lastUsedAt global).
  const accountUsage = await prisma.mediaAssetUsage.findUnique({
    where: { assetId_accountId: { assetId: picked.id, accountId: cursorAccountId } },
    select: { lastUsedAt: true, usageCount: true },
  });

  const reason = buildReason({
    resolvedSetTag: picked.resolvedSetTag,
    resolvedCategory: picked.resolvedCategory,
    sequence,
    cursorBefore: cursorBefore?.cursor ?? 0,
    accountLastUsedAt: accountUsage?.lastUsedAt ?? null,
    accountUsageCount: accountUsage?.usageCount ?? 0,
  });

  return NextResponse.json({
    asset: {
      id: assetMeta?.id ?? picked.id,
      url: assetMeta?.url ?? picked.url,
      filename: assetMeta?.filename ?? picked.filename,
      setTag: assetMeta?.setTag ?? picked.resolvedSetTag,
      category: assetMeta?.category ?? picked.resolvedCategory,
      lastUsedAtForAccount: accountUsage?.lastUsedAt?.toISOString() ?? null,
      usageCountForAccount: accountUsage?.usageCount ?? 0,
      lastUsedAtGlobal: assetMeta?.lastUsedAt?.toISOString() ?? null,
      usageCountGlobal: assetMeta?.usageCount ?? 0,
    },
    rotationScope: library.rotationScope ?? "per_account",
    cursor:
      sequence.length > 0
        ? {
            value: cursorBefore?.cursor ?? 0,
            position: ((cursorBefore?.cursor ?? 0) % sequence.length) + 1,
            totalSlots: sequence.length,
          }
        : null,
    reason,
  });
}

function buildReason(input: {
  resolvedSetTag: string | null;
  resolvedCategory: string | null;
  sequence: string[];
  cursorBefore: number;
  accountLastUsedAt: Date | null;
  accountUsageCount: number;
}): string {
  const parts: string[] = [];

  if (input.sequence.length === 0) {
    parts.push("Mode auto (pas de setSequence)");
  } else {
    const slot = input.sequence[input.cursorBefore % input.sequence.length];
    parts.push(`Mode override · curseur=${input.cursorBefore} → slot "${slot}"`);
  }

  if (input.resolvedSetTag) parts.push(`setTag=${input.resolvedSetTag}`);
  if (input.resolvedCategory) parts.push(`category=${input.resolvedCategory}`);

  if (input.accountUsageCount === 0) {
    parts.push("jamais utilisé par ce compte → premier choix");
  } else {
    const ago = input.accountLastUsedAt
      ? humanAgo(input.accountLastUsedAt)
      : "il y a longtemps";
    parts.push(`utilisé ${input.accountUsageCount}× (dernière fois ${ago})`);
  }

  return parts.join(" · ");
}

function humanAgo(date: Date): string {
  const ms = Date.now() - date.getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "à l'instant";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `il y a ${days} j`;
  const months = Math.floor(days / 30);
  return `il y a ${months} mois`;
}
