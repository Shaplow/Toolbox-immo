import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { deleteFromR2, isR2PublicUrl, r2Configured } from "@/lib/r2";

function extractR2KeyFromUrl(url: string | null | undefined): string | null {
  if (!url || !isR2PublicUrl(url)) return null;
  try {
    return new URL(url).pathname.replace(/^\/+/, "") || null;
  } catch {
    return null;
  }
}

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;

  const listing = await prisma.listing.findFirst({
    where: userContext.canAdminBypass ? { id } : { id, userId: userContext.effectiveUser.id },
    include: { template: true },
  });
  if (!listing) {
    return NextResponse.json({ error: "Listing introuvable" }, { status: 404 });
  }

  return NextResponse.json({
    ...listing,
    jsonData: JSON.parse(listing.jsonData),
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  if (!userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux admins" }, { status: 403 });
  }
  const { id } = await params;

  const listing = await prisma.listing.findUnique({
    where: { id },
    include: {
      renders: {
        select: {
          id: true,
          pngUrl: true,
          videoUrl: true,
          publicationSlotId: true,
          coverFramePack: {
            select: {
              id: true,
              finalCoverKey: true,
              publicationVersionId: true,
              candidates: { select: { imageKey: true } },
            },
          },
          transcriptionJob: {
            select: {
              id: true,
              inputKey: true,
              outputJsonKey: true,
              publicationVersionId: true,
              slotId: true,
            },
          },
        },
      },
    },
  });
  if (!listing) {
    return NextResponse.json({ error: "Listing introuvable" }, { status: 404 });
  }

  // Garde-fou : un listing dont l'un des renders est rattaché à un slot doit
  // être supprimé via la fiche de publication. Sinon on casserait le lien
  // PublicationSlot ↔ Render sans audit, et on viderait silencieusement la
  // section "Production" d'une mission active.
  const linkedRender = listing.renders.find((r) => r.publicationSlotId);
  if (linkedRender) {
    return NextResponse.json(
      {
        error:
          "Ce listing est rattaché à une publication. Passe par la fiche de publication pour le supprimer.",
        slotId: linkedRender.publicationSlotId,
      },
      { status: 409 },
    );
  }

  // Collecte des clés R2 à nettoyer (renders + cover packs + transcription jobs).
  const r2Keys = new Set<string>();
  const coverPackIdsToDelete: string[] = [];
  const transcriptionJobIdsToDelete: string[] = [];

  for (const render of listing.renders) {
    const videoKey = extractR2KeyFromUrl(render.videoUrl);
    if (videoKey) r2Keys.add(videoKey);
    const pngKey = extractR2KeyFromUrl(render.pngUrl);
    if (pngKey) r2Keys.add(pngKey);

    const pack = render.coverFramePack;
    // Si le pack a aussi un publicationVersionId, il sert ailleurs : on
    // laisse Prisma faire le SetNull sur renderId et on ne touche ni le pack
    // ni ses candidates côté R2.
    if (pack && !pack.publicationVersionId) {
      coverPackIdsToDelete.push(pack.id);
      if (pack.finalCoverKey) r2Keys.add(pack.finalCoverKey);
      for (const candidate of pack.candidates) {
        if (candidate.imageKey) r2Keys.add(candidate.imageKey);
      }
    }

    const job = render.transcriptionJob;
    // Idem : on garde le job s'il a un autre rattachement (version ou slot
    // direct via Phase V2). Sinon on le supprime pour ne pas laisser de
    // ligne orpheline dans l'historique des transcriptions.
    if (job && !job.publicationVersionId && !job.slotId) {
      transcriptionJobIdsToDelete.push(job.id);
      if (job.inputKey) r2Keys.add(job.inputKey);
      if (job.outputJsonKey) r2Keys.add(job.outputJsonKey);
    }
  }

  // Nettoyage R2 tolérant : les échecs unitaires (objet déjà absent, erreur
  // réseau passagère) ne doivent pas bloquer la suppression DB — l'orphan
  // sweep (r2Cleanup.ts) ratrappera les résidus au prochain run.
  if (r2Configured() && r2Keys.size > 0) {
    await Promise.all(
      Array.from(r2Keys).map((key) =>
        deleteFromR2(key).catch((err) => {
          console.warn(`[listings/DELETE] R2 delete failed for "${key}":`, err);
        }),
      ),
    );
  }

  // Suppression DB : cover packs (cascade candidates) + transcription jobs
  // (SetNull sur descriptionJob.transcriptionId) avant les renders. L'ordre
  // évite les conflits FK même si Prisma fait du SetNull en cascade.
  if (coverPackIdsToDelete.length > 0) {
    await prisma.coverFramePack.deleteMany({
      where: { id: { in: coverPackIdsToDelete } },
    });
  }
  if (transcriptionJobIdsToDelete.length > 0) {
    await prisma.transcriptionJob.deleteMany({
      where: { id: { in: transcriptionJobIdsToDelete } },
    });
  }
  await prisma.render.deleteMany({ where: { listingId: id } });
  await prisma.listing.delete({ where: { id } });

  console.warn(
    `[listings/DELETE] admin=${userContext.actualUser.id} deleted listing=${id} ` +
      `renders=${listing.renders.length} r2Keys=${r2Keys.size} ` +
      `coverPacks=${coverPackIdsToDelete.length} transcriptionJobs=${transcriptionJobIdsToDelete.length}`,
  );

  return new NextResponse(null, { status: 204 });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;

  const listing = await prisma.listing.findFirst({
    where: userContext.canAdminBypass ? { id } : { id, userId: userContext.effectiveUser.id },
  });
  if (!listing) {
    return NextResponse.json({ error: "Listing introuvable" }, { status: 404 });
  }

  const { data } = await req.json() as { data: Record<string, unknown> };
  const updated = await prisma.listing.update({
    where: { id },
    data: { jsonData: JSON.stringify(data) },
  });

  return NextResponse.json(updated);
}
