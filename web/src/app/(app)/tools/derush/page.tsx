import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { DerushList } from "@/components/derush/DerushList";

export default async function DerushPage() {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) redirect("/login");

  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.DERUSH))) {
    redirect("/home");
  }

  const jobs = await prisma.derushJob.findMany({
    where: { userId: userContext.effectiveUser.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { preset: { select: { name: true } } },
  });

  return (
    <DerushList
      initialJobs={jobs.map((j) => ({
        id: j.id,
        status: j.status as "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED",
        analysisMode: j.analysisMode as "vision" | "transcription",
        visionProvider: j.visionProvider,
        presetName: j.preset?.name ?? null,
        fileCount: (JSON.parse(j.inputFiles) as unknown[]).length,
        segmentCount: j.segmentCount,
        totalDuration: j.totalDuration,
        createdAt: j.createdAt.toISOString(),
      }))}
    />
  );
}
