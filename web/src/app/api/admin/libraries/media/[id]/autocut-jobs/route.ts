import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { canAccessMediaLibrary } from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

/**
 * DELETE /api/admin/libraries/media/[libraryId]/autocut-jobs
 *
 * Réinitialise tous les MediaAutocutJob non-appliqués d'une bibliothèque.
 * Les jobs avec reviewStatus="applied" (déjà coupés) sont préservés.
 *
 * Cas d'usage : supprimer les analyses en double ou les analyses périmées
 * pour permettre un nouveau round propre.
 *
 * Retourne : { deleted: number }
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !canAccessMediaLibrary(userContext.effectiveUser.role)) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: libraryId } = await params;

  const library = await prisma.mediaLibrary.findUnique({ where: { id: libraryId } });
  if (!library) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }

  // Supprimer tous les jobs sauf ceux déjà appliqués (coupe effective)
  const result = await prisma.mediaAutocutJob.deleteMany({
    where: {
      libraryId,
      reviewStatus: { not: "applied" },
    },
  });

  // Nettoyer aussi les batches orphelins (plus de jobs associés)
  await prisma.mediaAutocutBatch.deleteMany({
    where: {
      libraryId,
      jobs: { none: {} },
    },
  });

  return NextResponse.json({ deleted: result.count });
}
