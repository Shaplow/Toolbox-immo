/**
 * POST /api/derush/[id]/export/[eid]/submit
 *
 * Soumet un DerushExport QUEUED à RunPod (job_type: derush_export) pour les formats
 * qui nécessitent FFmpeg (clips_trimmed, stringout_video, structured_folder, combo_export).
 *
 * Les formats manifest_only et xml_timeline sont générés inline — ce endpoint leur retourne
 * une erreur 409 car ils sont déjà COMPLETED après création.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getR2PublicUrl, r2Configured } from "@/lib/r2";
import { submitRunpodJob } from "@/lib/runpod";
import { getRunpodWebhookUrl } from "@/lib/webhooks/runpod";

const RUNPOD_API_KEY     = process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;

// Formats qui nécessitent RunPod (FFmpeg)
const RUNPOD_FORMATS = new Set([
  "clips_trimmed", "stringout_video", "structured_folder", "combo_export",
]);

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; eid: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id, eid } = await params;

  const job = await prisma.derushJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  if (job.userId !== session.user.id && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  if (job.status !== "COMPLETED" || !job.outputJsonKey) {
    return NextResponse.json({ error: "Analyse non terminée" }, { status: 409 });
  }

  const exp = await prisma.derushExport.findUnique({ where: { id: eid } });
  if (!exp || exp.derushJobId !== id) {
    return NextResponse.json({ error: "Export introuvable" }, { status: 404 });
  }
  if (!RUNPOD_FORMATS.has(exp.exportFormat)) {
    return NextResponse.json(
      { error: `Le format ${exp.exportFormat} est généré côté serveur; il est déjà terminé.` },
      { status: 409 }
    );
  }
  if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
    return NextResponse.json({ error: "RunPod non configuré" }, { status: 503 });
  }
  if (!r2Configured()) {
    return NextResponse.json({ error: "R2 non configuré" }, { status: 503 });
  }

  // Atomic double-submit guard: only one concurrent request can claim status=QUEUED→PROCESSING.
  // If count===0 the export was already claimed by another request or is in a terminal state.
  const claimed = await prisma.derushExport.updateMany({
    where: { id: eid, status: "QUEUED" },
    data: { status: "PROCESSING" },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "Export déjà soumis ou terminé" }, { status: 409 });
  }

  const inputFiles = JSON.parse(job.inputFiles) as { key: string; filename: string }[];
  const videoUrls = inputFiles.map((f) => getR2PublicUrl(f.key));
  const segmentsUrl = getR2PublicUrl(job.outputJsonKey!);
  const safeUserId = job.userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const outputPrefix = `derush/${safeUserId}/${job.id}/export/${eid}`;

  const sourceFilesMeta = inputFiles.map((f, i) => ({
    id: `src_${String(i).padStart(2, "0")}`,
    filename: f.filename,
    r2_key: f.key,
    r2_public_url: getR2PublicUrl(f.key),
  }));

  const payload = {
    input: {
      job_type: "derush_export",
      job_id: job.id,
      export_id: eid,
      video_urls: videoUrls,
      segments_url: segmentsUrl,
      source_files_meta: sourceFilesMeta,
      export_format: exp.exportFormat,
      output_prefix: outputPrefix,
      workflow: exp.workflow ?? "capcut",
      accurate_trim: exp.accurateTrim,
      combo_formats: JSON.parse(exp.comboFormats) as string[],
      xml_format: exp.xmlFormat,
    },
    webhook: getRunpodWebhookUrl("/api/webhooks/runpod/derush-export"),
  };

  type RunpodSubmitResponse = { id: string };
  let runpodRes: RunpodSubmitResponse;
  try {
    runpodRes = await submitRunpodJob<RunpodSubmitResponse>(
      RUNPOD_ENDPOINT_ID,
      RUNPOD_API_KEY,
      payload
    );
  } catch (err) {
    // RunPod submission failed — roll the status back to QUEUED so the user can retry.
    await prisma.derushExport.update({ where: { id: eid }, data: { status: "QUEUED" } }).catch(() => {});
    console.error("[derush/export/submit] RunPod submit failed:", err);
    return NextResponse.json({ error: "Erreur lors de la soumission RunPod" }, { status: 502 });
  }

  // Status is already PROCESSING (set by the atomic guard above); only persist the job ID.
  const updated = await prisma.derushExport.update({
    where: { id: eid },
    data: { runpodJobId: runpodRes.id },
  });

  return NextResponse.json({ exportId: updated.id, runpodJobId: runpodRes.id });
}
