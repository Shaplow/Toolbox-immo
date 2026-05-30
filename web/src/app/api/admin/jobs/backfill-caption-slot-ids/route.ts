/**
 * POST /api/admin/jobs/backfill-caption-slot-ids
 *
 * Rattrape les CaptionJob orphelins (slotId=null) créés par le pipeline auto
 * AVANT le fix 2026-05-30. Le lien est reconstruit via :
 *   CaptionJob.srtFilename = "auto-<transcriptionJobId>.json"
 *     → TranscriptionJob.renderId
 *     → Render.publicationSlotId
 *
 * Sans ce backfill, les fiches publication concernées affichent toujours la
 * version brute du render au lieu de la version sous-titrée — le COMPLETED
 * est bien en DB mais reste orphelin.
 *
 * Accès : ADMIN uniquement.
 * Idempotent : ne touche que les CaptionJob avec slotId=null.
 */

import { NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

const AUTO_FILENAME_RE = /^auto(?:-transcription)?-([a-z0-9]+)\.json$/i;

export async function POST() {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const orphans = await prisma.captionJob.findMany({
    where: { slotId: null, srtFilename: { startsWith: "auto" } },
    select: { id: true, srtFilename: true },
  });

  let linked = 0;
  let skippedUnparsable = 0;
  let skippedNoTranscription = 0;
  let skippedNoRenderSlot = 0;

  for (const job of orphans) {
    if (!job.srtFilename) {
      skippedUnparsable++;
      continue;
    }
    const m = job.srtFilename.match(AUTO_FILENAME_RE);
    if (!m) {
      skippedUnparsable++;
      continue;
    }
    const transcriptionJobId = m[1];
    const transcription = await prisma.transcriptionJob.findUnique({
      where: { id: transcriptionJobId },
      select: { renderId: true },
    });
    if (!transcription?.renderId) {
      skippedNoTranscription++;
      continue;
    }
    const render = await prisma.render.findUnique({
      where: { id: transcription.renderId },
      select: { publicationSlotId: true },
    });
    if (!render?.publicationSlotId) {
      skippedNoRenderSlot++;
      continue;
    }
    await prisma.captionJob.update({
      where: { id: job.id },
      data: { slotId: render.publicationSlotId },
    });
    linked++;
  }

  const summary = {
    total: orphans.length,
    linked,
    skipped: {
      unparsable: skippedUnparsable,
      noTranscription: skippedNoTranscription,
      noRenderSlot: skippedNoRenderSlot,
    },
  };
  console.info("[admin/backfill-caption-slot-ids] terminé par", userContext.actualUser.id, JSON.stringify(summary));

  return NextResponse.json({ ok: true, summary });
}
