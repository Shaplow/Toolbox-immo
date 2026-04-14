import { redirect, notFound } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { DerushDetail } from "@/components/derush/DerushDetail";

export default async function DerushJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) redirect("/login");

  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.DERUSH))) {
    redirect("/home");
  }

  const { id } = await params;
  const job = await prisma.derushJob.findUnique({
    where: { id },
    include: { preset: { select: { id: true, name: true } } },
  });

  if (!job) notFound();
  if (job.userId !== userContext.effectiveUser.id && !isAdmin) redirect("/home");

  return (
    <DerushDetail
      job={{
        id: job.id,
        status: job.status as "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED",
        analysisMode: job.analysisMode as "vision" | "transcription",
        visionProvider: job.visionProvider,
        presetId: job.presetId,
        presetName: job.preset?.name ?? null,
        fileCount: (JSON.parse(job.inputFiles) as unknown[]).length,
        segmentCount: job.segmentCount,
        totalDuration: job.totalDuration,
        hasOutput: !!job.outputJsonKey,
        errorMsg: job.errorMsg,
        createdAt: job.createdAt.toISOString(),
      }}
    />
  );
}
