import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, Info } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { CoverGenerator } from "@/components/covers/CoverGenerator";

interface PageProps {
  searchParams: Promise<{ slotId?: string; returnTo?: string }>;
}

/**
 * Valide un returnTo pour éviter les open-redirects. On n'accepte que les
 * URL internes commençant par "/publications/" (pattern actuel des call sites).
 */
function sanitizeReturnTo(value: string | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/publications/")) return null;
  return value;
}

export default async function CoverPage({ searchParams }: PageProps) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) redirect("/login");

  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.COVERS))) {
    redirect("/home");
  }

  const { slotId, returnTo } = await searchParams;
  const safeReturnTo = sanitizeReturnTo(returnTo);

  // Charge le contexte slot uniquement si slotId présent ET valide (le user a
  // accès via /publications/[id] qui gate déjà — ici on n'affiche qu'un titre).
  const slotContext = slotId
    ? await prisma.publicationSlot.findUnique({
        where: { id: slotId },
        select: {
          id: true,
          title: true,
          account: { select: { handle: true } },
        },
      })
    : null;

  return (
    <div>
      {slotContext && (
        <div className="bg-indigo-50 border-b border-indigo-100 px-4 py-3">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0 text-sm">
              <Info size={14} className="text-indigo-500 shrink-0" />
              <span className="text-indigo-900">
                Vous choisissez une cover pour{" "}
                <span className="font-semibold">
                  {slotContext.title ?? `@${slotContext.account.handle}`}
                </span>
              </span>
            </div>
            {safeReturnTo && (
              <Link
                href={safeReturnTo}
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:text-indigo-900 transition-colors shrink-0"
              >
                <ChevronLeft size={12} />
                Retour à la publication
              </Link>
            )}
          </div>
        </div>
      )}
      <CoverGenerator />
    </div>
  );
}
