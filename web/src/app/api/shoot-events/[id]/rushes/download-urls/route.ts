/**
 * GET /api/shoot-events/[id]/rushes/download-urls
 *
 * Renvoie les URLs de téléchargement presignées (1h) de TOUS les rushs non
 * supprimés de l'événement, en une requête. Le monteur récupère le lot complet
 * pour découper. Auth : getUserContext(). Scope : canUserAccessEvent.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserContext } from "@/lib/userContext";
import { canUserAccessEvent } from "@/lib/permissions/eventScope";
import { toUserRole } from "@/lib/permissions/role";
import { getDownloadUrl } from "@/lib/storage";
import { loadEventForAccess } from "@/lib/services/event/eventRushAccess";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: eventId } = await params;

  const event = await loadEventForAccess(eventId);
  if (!event || !canUserAccessEvent(event, role, userId)) {
    return NextResponse.json({ error: "Événement introuvable" }, { status: 404 });
  }

  const rushes = await prisma.publicationRush.findMany({
    where: { eventId, deletedAt: null },
    orderBy: { uploadedAt: "asc" },
    select: { id: true, r2Key: true, fileName: true },
  });

  if (rushes.length === 0) {
    return NextResponse.json({ rushes: [] });
  }

  try {
    const urls = await Promise.all(
      rushes.map(async (rush) => ({
        id: rush.id,
        fileName: rush.fileName,
        downloadUrl: await getDownloadUrl(rush.r2Key, rush.fileName),
      })),
    );
    return NextResponse.json({ rushes: urls });
  } catch (err) {
    console.error(`[event rushes/download-urls] presign failed eventId=${eventId}:`, err);
    return NextResponse.json({ error: "Erreur de génération des URLs" }, { status: 500 });
  }
}
