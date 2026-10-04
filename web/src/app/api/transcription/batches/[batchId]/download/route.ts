/**
 * GET /api/transcription/batches/[batchId]/download?format=srt|json
 *
 * Archive ZIP des transcriptions terminées du lot : un fichier par vidéo,
 * nommé d'après la vidéo source (accents conservés, homonymes dédoublonnés en
 * « nom (2).srt »). Les SRT sont générés à la volée depuis segments.json, comme
 * le téléchargement unitaire.
 *
 * Une transcription illisible ne fait pas échouer l'archive : elle est listée
 * dans ERREURS.txt et comptée dans l'en-tête `X-Transcription-Errors`.
 *
 * Lectures R2 bornées, archive construite en mémoire : quelques Mo pour un lot
 * de 50 SRT (segments.json ≈ 1 Mo par heure de parole), bien sous le
 * proxy_read_timeout nginx de 120 s.
 */

import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { prisma } from "@/lib/prisma";
import { mapWithConcurrencySettled } from "@/lib/concurrency";
import { generateSrt } from "@/lib/transcriptionProcess";
import { loadTranscriptionSegments } from "@/lib/transcription/segments";
import {
  attachmentDisposition,
  batchArchiveName,
  buildZipEntryNames,
  isBatchDownloadFormat,
} from "@/lib/transcription/batches";
import {
  batchNotFound,
  parseBatchIdParam,
  requireTranscriptionUser,
} from "@/lib/services/transcription/batchAccess";

/** Lectures segments.json simultanées (R2 ou disque). */
const READ_CONCURRENCY = 6;

/** Garde-fou mémoire : l'archive est construite en RAM sur le process unique. */
const MAX_BATCH_DOWNLOAD = 300;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const auth = await requireTranscriptionUser();
  if (auth.response) return auth.response;

  const batchId = parseBatchIdParam((await params).batchId);
  if (!batchId) return batchNotFound();

  const format = (new URL(req.url).searchParams.get("format") ?? "srt").toLowerCase();
  if (!isBatchDownloadFormat(format)) {
    return NextResponse.json(
      { error: `Format non reconnu : ${format}. Valeurs possibles : srt, json` },
      { status: 400 }
    );
  }

  const jobs = await prisma.transcriptionJob.findMany({
    where: { userId: auth.ctx.effectiveUser.id, batchId, status: "COMPLETED" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_BATCH_DOWNLOAD,
    select: { id: true, inputFilename: true, outputJsonKey: true, segmentsJson: true, createdAt: true },
  });
  if (jobs.length === 0) {
    return NextResponse.json(
      { error: "Aucune transcription terminée dans ce lot." },
      { status: 404 }
    );
  }

  const entryNames = buildZipEntryNames(jobs.map((job) => job.inputFilename), format);
  const loaded = await mapWithConcurrencySettled(jobs, READ_CONCURRENCY, (job) =>
    loadTranscriptionSegments(job)
  );

  const zip = new JSZip();
  const unreadable: string[] = [];
  loaded.forEach((outcome, index) => {
    const job = jobs[index];
    if (!outcome.ok) {
      console.error(`[transcription/batch-download] lecture segments échouée job=${job.id}:`, outcome.error);
      unreadable.push(job.inputFilename ?? job.id);
      return;
    }
    const content = format === "srt" ? generateSrt(outcome.value) : JSON.stringify(outcome.value, null, 2);
    zip.file(entryNames[index], content);
  });

  if (unreadable.length === jobs.length) {
    return NextResponse.json(
      { error: "Impossible de lire les transcriptions de ce lot." },
      { status: 500 }
    );
  }
  if (unreadable.length > 0) {
    zip.file(
      "ERREURS.txt",
      `Ces transcriptions n'ont pas pu être lues :\n${unreadable.map((name) => `- ${name}`).join("\n")}\n`
    );
  }

  const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return new NextResponse(new Uint8Array(archive), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": attachmentDisposition(batchArchiveName(batchId, jobs[0].createdAt, format)),
      "Cache-Control": "no-store",
      "X-Transcription-Errors": String(unreadable.length),
    },
  });
}
