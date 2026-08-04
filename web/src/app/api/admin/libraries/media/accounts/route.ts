import { NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { canViewMediaLibrary } from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";
import { SHARED_CURSOR_ACCOUNT_ID, SHARED_DATA_CURSOR_ACCOUNT_ID } from "@/lib/contentLibraryResolver";

// Sentinels de curseur partagé (rotationScope="shared") — exclus des listings UI.
const SENTINEL_ACCOUNT_IDS = [SHARED_CURSOR_ACCOUNT_ID, SHARED_DATA_CURSOR_ACCOUNT_ID];

/**
 * GET /api/admin/libraries/media/accounts
 *
 * Liste minimale des comptes Instagram ({ id, name, handle }) pour les pickers
 * de la médiathèque : filtre « Tous les comptes », édition d'accès par compte,
 * pré-remplissage à l'upload.
 *
 * Gate = `canViewMediaLibrary` (ADMIN + VIDEASTE), pas `canAdminBypass`. Le
 * VIDEASTE a des droits asset-level complets (upload / édition / tags / accès —
 * cf. mediaLibrary.ts + les routes PATCH/bulk/upload gatées `canViewMediaLibrary`)
 * mais était privé de la dimension « compte » car `/api/admin/accounts` est
 * ADMIN-only (`canAdminBypass`) et son hook échouait en silence → liste vide →
 * filtre masqué. Cet endpoint rend juste la liste des comptes accessible aux
 * rôles médiathèque, sans exposer les internals (clients, cursors, _count) que
 * renvoie `/api/admin/accounts`.
 */
export async function GET() {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !canViewMediaLibrary(userContext.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux rôles médiathèque" }, { status: 403 });
  }

  try {
    const accounts = await prisma.instagramAccount.findMany({
      where: { id: { notIn: SENTINEL_ACCOUNT_IDS } },
      select: { id: true, name: true, handle: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(accounts);
  } catch (err) {
    console.error("[admin/libraries/media/accounts] GET error:", err);
    return NextResponse.json({ error: "Erreur serveur lors du chargement" }, { status: 500 });
  }
}
