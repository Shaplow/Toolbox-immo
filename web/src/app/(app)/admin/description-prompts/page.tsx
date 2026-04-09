import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { DescriptionPromptsPanel } from "@/components/admin/DescriptionPromptsPanel";

export default async function AdminDescriptionPromptsPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/tools/templates");
  }

  const prompts = await prisma.descriptionPrompt.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, prompt: true, isActive: true, createdAt: true },
  });

  const initialPrompts = prompts.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
  }));

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Prompts de descriptions</h1>
        <p className="text-sm text-gray-500 mt-1">
          Gérez les prompts disponibles pour l&apos;outil de génération de descriptions.
        </p>
      </div>
      <DescriptionPromptsPanel initialPrompts={initialPrompts} />
    </div>
  );
}
