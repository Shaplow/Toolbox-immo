import { redirect } from "next/navigation";
import Link from "next/link";
import { getUserContext } from "@/lib/userContext";
import { hasTool } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { isSafeRelativePath } from "@/lib/safeUrl";
import { DescriptionTool, type DescriptionPromptRow, type DescriptionJobRow } from "@/components/description/DescriptionTool";
import { FileText, Info, ChevronLeft } from "lucide-react";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { RefreshButton } from "@/components/ui/RefreshButton";

interface PageProps {
  // V3 friction MED-4 : on lit slotId + returnTo côté server pour valider
  // l'accès et le format avant de passer au client (au lieu que le client
  // re-lise les searchParams sans validation).
  searchParams: Promise<{ slotId?: string; returnTo?: string }>;
}

export default async function DescriptionPage({ searchParams }: PageProps) {
  const userContext = await getUserContext();
  if (!userContext) redirect("/login");

  const userId = userContext.effectiveUser.id;
  const isAdmin = userContext.canAdminBypass;

  if (!isAdmin) {
    const access = await hasTool(userId, "description");
    if (!access) redirect("/home");
  }

  // Phase nav 2026-05-28 : si on arrive avec ?slotId=, on charge le contexte
  // pour afficher un banner explicite "Vous générez une description pour..."
  // — pattern symétrique à /publications/[id]/cover et /captions/[id]/generate.
  const { slotId, returnTo: rawReturnTo } = await searchParams;
  const role = toUserRole(userContext.effectiveUser.role);
  const slotContext = slotId
    ? await prisma.publicationSlot.findUnique({
        where: { id: slotId },
        select: {
          id: true,
          title: true,
          assigneeMonteurId: true,
          assigneeCmId: true,
          assigneeVideasteId: true,
          account: { select: { handle: true } },
        },
      })
    : null;
  // Garde access : on n'expose le contexte que si l'user a vraiment accès au
  // slot (anti-énumération via /descriptions?slotId=X).
  const slotIsAccessible = !!(slotContext && canUserAccessSlot(slotContext, role, userId));
  const slotForBanner = slotIsAccessible && slotContext
    ? { title: slotContext.title, handle: slotContext.account?.handle ?? "Sans compte" }
    : null;
  // returnTo validé côté server (anti open-redirect) ; fallback fiche.
  const safeReturnTo =
    rawReturnTo && isSafeRelativePath(rawReturnTo)
      ? rawReturnTo
      : slotIsAccessible
      ? `/publications/${slotId}`
      : null;

  const aiConfig = {
    hasClaude: !!process.env.ANTHROPIC_API_KEY,
    hasGPT: !!process.env.OPENAI_API_KEY,
  };

  const [prompts, jobs] = await Promise.all([
    // `kind: "description"` : sans ce filtre, les prompts de brief monteur
    // remonteraient dans le picker de légendes Instagram.
    prisma.descriptionPrompt.findMany({
      where: { isActive: true, kind: "description" },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, prompt: true, createdAt: true },
    }),
    prisma.descriptionJob.findMany({
      where: { kind: "description", ...(isAdmin ? {} : { userId }) },
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
    <div className="min-h-screen">
      <div
        className="mx-auto max-w-7xl px-6 py-8"

      >
        <div className="px-6 sm:px-8 pt-6 pb-12">
          <div className="max-w-4xl mx-auto space-y-6">
            {slotForBanner && slotId && (
              // V5.B.3 — Banner peach INTÉRIEUR au wrapper pastel (sinon
              // border-b cassait le rounded-3xl). Palette Coastal Studio.
              <div className="rounded-xl bg-warning-50 px-4 py-3 ">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0 text-sm">
                    <Info size={14} className="text-warning-700 shrink-0" />
                    <span className="text-warning-700">
                      Vous générez une légende pour{" "}
                      <span className="font-semibold">
                        {slotForBanner.title ?? `@${slotForBanner.handle}`}
                      </span>
                    </span>
                  </div>
                  <Link
                    href={safeReturnTo ?? `/publications/${slotId}`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-warning-700 hover:text-warning-700 transition-colors shrink-0"
                  >
                    <ChevronLeft size={12} />
                    Retour à la publication
                  </Link>
                </div>
              </div>
            )}
            <ToolPageHeader
              icon={FileText}
              iconTint="peach"
              title="Générateur de descriptions"
              subtitle={
                slotForBanner
                  ? "Configuration avancée : transcription, image de référence, choix de modèle. Le résultat sera rattaché à la publication."
                  : "Mode standalone — créez des descriptions à partir d'un fichier SRT/JSON, d'une transcription existante ou uniquement d'une image si besoin."
              }
              actions={<RefreshButton title="Rafraîchir les descriptions" />}
            />

            <DescriptionTool
              initialPrompts={initialPrompts}
              initialJobs={initialJobs}
              isAdmin={isAdmin}
              aiConfig={aiConfig}
              slotId={slotIsAccessible ? slotId : null}
              returnTo={safeReturnTo}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
