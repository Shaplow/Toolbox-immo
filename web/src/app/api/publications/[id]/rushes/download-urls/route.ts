/**
 * GET /api/publications/[id]/rushes/download-urls
 *
 * Renvoie les URLs de téléchargement presignées (1h) de TOUS les rushes non
 * supprimés d'un slot, en une seule requête. Le navigateur télécharge ensuite
 * chaque rush directement depuis R2, en parallèle — sans relayer les octets par
 * le serveur (contrairement à un zip serveur). C'est le chemin le plus rapide
 * pour de gros bundles.
 *
 * Auth : getUserContext(). Scope : canUserAccessSlot (404 anti-énumération),
 * identique à la route de download unitaire rushes/[rushId].
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { getDownloadUrl } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: slotId } = await params;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: { id: true, status: true, assigneeMonteurId: true, assigneeCmId: true, assigneeVideasteId: true },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

  const rushes = await prisma.publicationRush.findMany({
    where: { slotId, deletedAt: null },
    orderBy: { uploadedAt: "asc" },
    select: { id: true, r2Key: true, fileName: true },
  });

  if (rushes.length === 0) {
    return NextResponse.json({ error: "Aucun rush à télécharger." }, { status: 404 });
  }

  try {
    const urls = await Promise.all(
      rushes.map(async (rush) => ({
        id: rush.id,
        fileName: rush.fileName,
        url: await getDownloadUrl(rush.r2Key, rush.fileName),
      })),
    );
    return NextResponse.json({ rushes: urls });
  } catch (err) {
    console.error(`[rushes/download-urls] presign failed for slotId=${slotId}:`, err);
    return NextResponse.json(
      { error: "Erreur de génération des URLs de téléchargement" },
      { status: 500 },
    );
  }
}
