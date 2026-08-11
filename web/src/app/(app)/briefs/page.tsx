/**
 * /briefs — générateur de briefs de montage (outil standalone).
 *
 * Calqué sur `/descriptions` pour le gating et le préchargement, mais volontairement
 * sans contexte de publication : le brief n'est rattaché à aucun slot, sa sortie est
 * copiée par l'admin vers l'outil de son choix.
 *
 * Accès : ADMIN via la sentinelle `"*"` de ROLE_TOOL_SCOPE. Un CM ou un MONTEUR peut
 * recevoir `brief` au cas par cas via `User.permissions`, sans changement de code.
 */

import { redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { PageShell } from "@/components/ui/PageShell";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { RefreshButton } from "@/components/ui/RefreshButton";
import {
  BriefTool,
  type BriefPromptRow,
  type BriefJobRow,
} from "@/components/brief/BriefTool";

export default async function BriefsPage() {
  const userContext = await getUserContext();
  if (!userContext) redirect("/login");

  const userId = userContext.effectiveUser.id;
  const isAdmin = userContext.canAdminBypass;

  if (!isAdmin) {
    const access = await hasTool(userId, TOOLS.BRIEF);
    if (!access) redirect("/home");
  }

  const aiConfig = {
    hasClaude: !!process.env.ANTHROPIC_API_KEY,
    hasGPT: !!process.env.OPENAI_API_KEY,
  };

  // `kind: "brief"` des deux côtés : sans ce filtre, les prompts de légende
  // Instagram et l'historique des descriptions remonteraient ici.
  const [prompts, jobs] = await Promise.all([
    prisma.descriptionPrompt.findMany({
      where: { isActive: true, kind: "brief" },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, prompt: true, recipeKind: true },
    }),
    prisma.descriptionJob.findMany({
      where: { kind: "brief", ...(isAdmin ? {} : { userId }) },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { prompt: { select: { name: true } } },
    }),
  ]);

  const initialPrompts: BriefPromptRow[] = prompts;

  const initialJobs: BriefJobRow[] = jobs.map((j) => ({
    id: j.id,
    status: j.status,
    model: j.model,
    inputFilename: j.inputFilename,
    result: j.result,
    errorMsg: j.errorMsg,
    createdAt: j.createdAt.toISOString(),
    prompt: j.prompt ? { name: j.prompt.name } : null,
  }));

  return (
    <PageShell variant="default">
      <div className="space-y-6">
        <ToolPageHeader
          icon={ClipboardList}
          title="Briefs monteur"
          subtitle="Générez un brief de montage à partir d'une transcription et d'un prompt dédié. Sortie en Markdown ou en texte brut, prête à copier."
          actions={<RefreshButton title="Rafraîchir les briefs" />}
        />

        <BriefTool
          initialPrompts={initialPrompts}
          initialJobs={initialJobs}
          aiConfig={aiConfig}
        />
      </div>
    </PageShell>
  );
}
