import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { CaptionPromptsPanel } from "@/components/admin/CaptionPromptsPanel";
import { DescriptionPromptsPanel } from "@/components/admin/DescriptionPromptsPanel";
import { serializeCaptionPrompt } from "@/lib/captionPrompt";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { Sparkles } from "lucide-react";
import { normalizeRecipeKind } from "@/lib/llm/recipes";

export default async function AdminPromptsPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/templates");
  }

  const promptSelect = {
    id: true,
    name: true,
    prompt: true,
    isActive: true,
    createdAt: true,
    recipeKind: true,
    recipeConfig: true,
  } as const;

  // Deux requêtes séparées plutôt qu'un filtre côté client : chaque panneau ne
  // doit voir que sa famille, et l'index [kind, isActive] rend le split gratuit.
  const [captionPromptRecords, descriptionPromptRecords, briefPromptRecords] =
    await Promise.all([
      prisma.captionPrompt.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.descriptionPrompt.findMany({
        where: { kind: "description" },
        orderBy: { createdAt: "asc" },
        select: promptSelect,
      }),
      prisma.descriptionPrompt.findMany({
        where: { kind: "brief" },
        orderBy: { createdAt: "asc" },
        select: promptSelect,
      }),
    ]);

  const captionPrompts = captionPromptRecords.map(serializeCaptionPrompt);

  const descriptionPrompts = descriptionPromptRecords.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    recipeKind: normalizeRecipeKind(p.recipeKind),
    recipeConfig: p.recipeConfig as { frameCount?: number; contextFieldKeys?: string[] } | null,
  }));

  const briefPrompts = briefPromptRecords.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    recipeKind: normalizeRecipeKind(p.recipeKind),
    recipeConfig: p.recipeConfig as { frameCount?: number; contextFieldKeys?: string[] } | null,
  }));

  return (
    <div className="min-h-screen">
      <div
        className="mx-auto max-w-7xl px-6 py-8"

      >
        <div className="px-6 sm:px-8 pt-6 pb-12">
          <div className="max-w-5xl mx-auto space-y-12">
            <ToolPageHeader
              icon={Sparkles}
              iconTint="peach"
              title="Prompts IA"
              subtitle="Gérez les prompts disponibles pour vos utilisateurs."
            />

            {/* Caption prompts */}
            <section>
              <div className="mb-5">
                <h2 className="text-base font-semibold text-gray-900">Sous-titres</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Prompts de correction IA disponibles dans l&apos;outil sous-titres.
                </p>
              </div>
              <CaptionPromptsPanel initialPrompts={captionPrompts} />
            </section>

            <div className="border-t border-white/40" />

            {/* Description prompts */}
            <section>
              <div className="mb-5">
                <h2 className="text-base font-semibold text-gray-900">Descriptions</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Prompts de génération disponibles dans l&apos;outil de descriptions.
                </p>
              </div>
              <DescriptionPromptsPanel initialPrompts={descriptionPrompts} />
            </section>

            <div className="border-t border-white/40" />

            {/* Brief prompts */}
            <section>
              <div className="mb-5">
                <h2 className="text-base font-semibold text-gray-900">Briefs monteur</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Prompts de génération disponibles dans l&apos;outil Briefs monteur. Ces prompts
                  n&apos;apparaissent pas dans l&apos;outil de descriptions.
                </p>
              </div>
              <DescriptionPromptsPanel initialPrompts={briefPrompts} kind="brief" />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
