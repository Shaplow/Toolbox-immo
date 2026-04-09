import { redirect, notFound } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { TranscriptionDetail } from "@/components/transcription/TranscriptionDetail";

export default async function TranscriptionJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) redirect("/login");

  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.TRANSCRIPTION))) {
    redirect("/home");
  }

  const { id } = await params;
  const job = await prisma.transcriptionJob.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      inputFilename: true,
      model: true,
      language: true,
      enableDiarization: true,
      hasDiarization: true,
      segmentCount: true,
      duration: true,
      createdAt: true,
      errorMsg: true,
      outputJsonKey: true,
      userId: true,
    },
  });

  if (!job) notFound();
  if (job.userId !== userContext.effectiveUser.id && !isAdmin) redirect("/home");

  return (
    <TranscriptionDetail
      job={{
        id: job.id,
        status: job.status as "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED",
        inputFilename: job.inputFilename,
        model: job.model,
        language: job.language,
        enableDiarization: job.enableDiarization,
        hasDiarization: job.hasDiarization,
        segmentCount: job.segmentCount,
        duration: job.duration,
        createdAt: job.createdAt.toISOString(),
        errorMsg: job.errorMsg,
        hasOutput: !!job.outputJsonKey,
      }}
    />
  );
}
