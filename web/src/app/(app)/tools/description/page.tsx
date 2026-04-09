import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { hasTool } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { DescriptionTool, type DescriptionPromptRow, type DescriptionJobRow } from "@/components/description/DescriptionTool";

export default async function DescriptionPage() {
  const userContext = await getUserContext();
  if (!userContext) redirect("/login");

  const userId = userContext.effectiveUser.id;
  const isAdmin = userContext.canAdminBypass;

  if (!isAdmin) {
    const access = await hasTool(userId, "description");
    if (!access) redirect("/home");
  }

  const aiConfig = {
    hasClaude: !!process.env.ANTHROPIC_API_KEY,
    hasGPT: !!process.env.OPENAI_API_KEY,
  };

  const [prompts, jobs] = await Promise.all([
    prisma.descriptionPrompt.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, prompt: true, createdAt: true },
    }),
    prisma.descriptionJob.findMany({
      where: isAdmin ? {} : { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        prompt: { select: { name: true } },
      },
    }),
  ]);

  const initialPrompts: DescriptionPromptRow[] = prompts.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
  }));

  const initialJobs: DescriptionJobRow[] = jobs.map((j) => ({
    id: j.id,
    status: j.status,
    inputFilename: j.inputFilename ?? null,
    inputType: j.inputType,
    promptId: j.promptId ?? null,
    promptSnapshot: j.promptSnapshot ?? null,
    personalization: j.personalization ?? null,
    model: j.model,
    result: j.result ?? null,
    errorMsg: j.errorMsg ?? null,
    createdAt: j.createdAt.toISOString(),
    prompt: j.prompt ?? null,
  }));

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Générateur de descriptions</h1>
        <p className="text-sm text-gray-500 mt-1">
          Créez des descriptions à partir d&apos;un fichier SRT/JSON ou d&apos;une transcription existante.
        </p>
      </div>

      <DescriptionTool
        initialPrompts={initialPrompts}
        initialJobs={initialJobs}
        isAdmin={isAdmin}
        aiConfig={aiConfig}
      />
    </div>
  );
}
