import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
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
    <div className="p-8 max-w-2xl mx-auto">
      <Link
        href="/transcriptions"
        className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-6 transition-colors"
      >
        <ChevronLeft size={13} />
        Transcriptions
      </Link>
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
    </div>
  );
}
