import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { TranscriptionList } from "@/components/transcription/TranscriptionList";

export default async function TranscriptionPage() {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) redirect("/login");

  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.TRANSCRIPTION))) {
    redirect("/home");
  }

  const jobs = await prisma.transcriptionJob.findMany({
    where: { userId: userContext.effectiveUser.id },
    orderBy: { createdAt: "desc" },
    take: 50,
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
    },
  });

  return (
    <TranscriptionList
      initialJobs={jobs.map((j) => ({
        ...j,
        status: j.status as "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED",
        createdAt: j.createdAt.toISOString(),
      }))}
    />
  );
}
