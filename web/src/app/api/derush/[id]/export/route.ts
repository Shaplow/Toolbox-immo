/**
 * POST /api/derush/[id]/export
 * Crée un DerushExport et — si le format est générable côté serveur (manifest/xml) —
 * le génère directement (COMPLETED immédiat). Sinon, le laisse en QUEUED pour RunPod.
 *
 * GET /api/derush/[id]/export
 * Liste les exports du job.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getFromR2, uploadToR2, r2Configured } from "@/lib/r2";
import { buildManifest, generateXmlTimeline } from "@/lib/derushProcess";
import type {
  DerushExportCreatePayload,
  DerushSegment,
  DerushSourceFileRef,
  DerushManifest,
} from "@/types/derush";

// Formats générés inline côté serveur (pas de FFmpeg)
const SERVER_SIDE_FORMATS = new Set(["manifest_only", "xml_timeline"]);

// ─────────────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;
  const job = await prisma.derushJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  if (job.userId !== session.user.id && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  if (job.status !== "COMPLETED" || !job.outputJsonKey) {
    return NextResponse.json({ error: "Analyse non terminée" }, { status: 409 });
  }
  if (!r2Configured()) {
    return NextResponse.json({ error: "R2 non configuré" }, { status: 503 });
  }

  let body: DerushExportCreatePayload;
  try {
    body = await req.json() as DerushExportCreatePayload;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const allowedFormats = new Set([
    "clips_trimmed", "xml_timeline", "stringout_video",
    "structured_folder", "manifest_only", "combo_export",
  ]);
  if (!allowedFormats.has(body.exportFormat)) {
    return NextResponse.json({ error: "Format invalide" }, { status: 400 });
  }

  // ─── Créer l'enregistrement export ───────────────────────────────────────
  const derushExport = await prisma.derushExport.create({
    data: {
      derushJobId: job.id,
      status: "QUEUED",
      exportFormat: body.exportFormat,
      workflow: body.workflow ?? null,
      comboFormats: JSON.stringify(body.comboFormats ?? []),
      accurateTrim: body.accurateTrim ?? false,
      xmlFormat: body.xmlFormat ?? "fcpxml",
    },
  });

  // ─── Génération serveur-side pour manifest et xml ─────────────────────────
  if (SERVER_SIDE_FORMATS.has(body.exportFormat)) {
    try {
      const result = await generateServerSideExport(
        job.id,
        job.outputJsonKey!,
        job.inputFiles,
        job.analysisMode,
        derushExport.id,
        body
      );

      const updated = await prisma.derushExport.update({
        where: { id: derushExport.id },
        data: {
          status: "COMPLETED",
          outputKey: result.outputKey,
          outputFilename: result.outputFilename,
        },
      });

      return NextResponse.json(formatExport(updated), { status: 201 });
    } catch (err) {
      console.error("[derush/export] Server-side generation failed:", err);
      await prisma.derushExport.update({
        where: { id: derushExport.id },
        data: { status: "FAILED", errorMsg: String(err) },
      });
      return NextResponse.json({ error: "Génération échouée" }, { status: 500 });
    }
  }

  return NextResponse.json(formatExport(derushExport), { status: 201 });
}

// ─────────────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;
  const job = await prisma.derushJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  if (job.userId !== session.user.id && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const exports = await prisma.derushExport.findMany({
    where: { derushJobId: id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(exports.map(formatExport));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function generateServerSideExport(
  jobId: string,
  outputJsonKey: string,
  inputFilesJson: string,
  analysisMode: string,
  exportId: string,
  body: DerushExportCreatePayload
): Promise<{ outputKey: string; outputFilename: string }> {
  const raw = await getFromR2(outputJsonKey);
  const parsed = JSON.parse(raw.toString("utf-8")) as {
    segments: DerushSegment[];
    source_files?: DerushSourceFileRef[];
    analysis_mode?: string;
  };

  const segments: DerushSegment[] = parsed.segments ?? (Array.isArray(parsed) ? parsed as unknown as DerushSegment[] : []);
  const inputFiles = JSON.parse(inputFilesJson) as { key: string; filename: string }[];

  const sourceFiles: DerushSourceFileRef[] = (parsed.source_files ?? inputFiles.map((f, i) => ({
    id: `src_${String(i).padStart(3, "0")}`,
    filename: f.filename,
    r2_key: f.key,
  })));

  const manifest = buildManifest(
    jobId,
    sourceFiles,
    segments,
    (analysisMode as "vision" | "transcription"),
    body.exportFormat,
    body.workflow ?? "generic",
    "stream_copy"
  );

  if (body.exportFormat === "manifest_only") {
    const json = JSON.stringify(manifest, null, 2);
    const outputKey = `derush/${jobId}/export/${exportId}/manifest_${exportId}.json`;
    const buf = Buffer.from(json, "utf-8");
    await uploadToR2(outputKey, buf, "application/json");
    return { outputKey, outputFilename: `manifest_${exportId}.json` };
  }

  if (body.exportFormat === "xml_timeline") {
    const xmlFmt = body.xmlFormat ?? "fcpxml";
    const xml = generateXmlTimeline(manifest as DerushManifest, xmlFmt);
    const ext = xmlFmt === "fcpxml" ? "fcpxml" : "xml";
    const outputFilename = `timeline_${exportId}.${ext}`;
    const outputKey = `derush/${jobId}/export/${exportId}/${outputFilename}`;
    const buf = Buffer.from(xml, "utf-8");
    await uploadToR2(outputKey, buf, "application/xml");
    return { outputKey, outputFilename };
  }

  throw new Error(`Format ${body.exportFormat} ne peut pas être généré côté serveur`);
}

function formatExport(e: {
  id: string;
  derushJobId: string;
  status: string;
  exportFormat: string;
  workflow: string | null;
  comboFormats: string;
  accurateTrim: boolean;
  xmlFormat: string;
  outputKey: string | null;
  outputFilename: string | null;
  runpodJobId: string | null;
  errorMsg: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: e.id,
    derushJobId: e.derushJobId,
    status: e.status,
    exportFormat: e.exportFormat,
    workflow: e.workflow,
    comboFormats: JSON.parse(e.comboFormats) as string[],
    accurateTrim: e.accurateTrim,
    xmlFormat: e.xmlFormat,
    outputKey: e.outputKey,
    outputFilename: e.outputFilename,
    runpodJobId: e.runpodJobId,
    errorMsg: e.errorMsg,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}
