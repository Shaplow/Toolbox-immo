/**
 * GET /api/entities/[id]/rushes/download-urls
 *
 * Renvoie les URLs de téléchargement presignées (1h) de TOUS les rushs non
 * supprimés de la fiche, en une requête. Le monteur récupère le lot complet
 * pour découper. Auth : getUserContext(). Scope : canUserAccessEntity.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api/requireAuth";
import { canUserAccessEntity } from "@/lib/permissions/entityScope";
import { toUserRole } from "@/lib/permissions/role";
import { getDownloadUrl } from "@/lib/storage";
import { loadEntityForAccess } from "@/lib/services/entity/entityAccess";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;
  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;
  const { id: entityId } = await params;

  const entity = await loadEntityForAccess(entityId);
  if (!entity || !canUserAccessEntity(entity, role, userId)) {
    return NextResponse.json({ error: "Fiche introuvable" }, { status: 404 });
  }

  const rushes = await prisma.publicationRush.findMany({
    where: { entityId, deletedAt: null },
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
    console.error(`[entity rushes/download-urls] presign failed entityId=${entityId}:`, err);
    return NextResponse.json({ error: "Erreur de génération des URLs" }, { status: 500 });
  }
}
