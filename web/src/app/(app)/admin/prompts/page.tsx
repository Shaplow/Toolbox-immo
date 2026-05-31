import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { CaptionPromptsPanel } from "@/components/admin/CaptionPromptsPanel";
import { DescriptionPromptsPanel } from "@/components/admin/DescriptionPromptsPanel";
import { serializeCaptionPrompt } from "@/lib/captionPrompt";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { Sparkles } from "lucide-react";

export default async function AdminPromptsPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/templates");
  }

  const [captionPromptRecords, descriptionPromptRecords] = await Promise.all([
    prisma.captionPrompt.findMany({
      orderBy: { createdAt: "asc" },
    }),
    prisma.descriptionPrompt.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        prompt: true,
        isActive: true,
        createdAt: true,
        recipeKind: true,
        recipeConfig: true,
      },
    }),
  ]);

  const captionPrompts = captionPromptRecords.map(serializeCaptionPrompt);

  const descriptionPrompts = descriptionPromptRecords.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    recipeKind: p.recipeKind as
      | "transcript_only"
      | "transcript_and_frame"
      | "transcript_multi_frame"
      | "two_pass_reformulate"
      | "context_enriched",
    recipeConfig: p.recipeConfig as { frameCount?: number; contextFieldKeys?: string[] } | null,
  }));

  return (
    <div className="min-h-screen">
      <div
        className="my-11 ml-[100px] mr-[100px] rounded-3xl"
        style={{ background: "var(--gradient-page-shell)" }}
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
                <p className="text-sm text-gray-500 mt-0.5">
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
                <p className="text-sm text-gray-500 mt-0.5">
                  Prompts de génération disponibles dans l&apos;outil de descriptions.
                </p>
              </div>
              <DescriptionPromptsPanel initialPrompts={descriptionPrompts} />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
