/**
 * /publications/[id]/captions/manual — éditeur SRT manuel pour les patterns
 * en mode `needsCaptionsMode = "manual"` (V8.2.4).
 *
 * Charge le slot avec le mode résolu + dernier CaptionJob (pour pre-fill du
 * SRT en mode "modifier"). Rend `<CaptionEditorPanel />` qui sauvegarde via
 * POST /api/captions/manual.
 *
 * Anti-énumération : 404 si slot inconnu, accès refusé, ou mode != manual.
 */

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Subtitles } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { resolveCaptionsMode } from "@/lib/publications/captionsMode";
import { CaptionEditorPanel } from "@/components/publications/CaptionEditorPanel";

type Props = { params: Promise<{ id: string }> };

export default async function PublicationCaptionsManualPage({ params }: Props) {
  const { id: slotId } = await params;

  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) redirect("/login");

  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.CAPTIONS))) {
    redirect("/home");
  }

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      title: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
      assigneeVideasteId: true,
      needsCaptionsOverride: true,
      needsCaptionsModeOverride: true,
      account: { select: { handle: true } },
      pattern: {
        select: { needsCaptions: true, needsCaptionsMode: true },
      },
      captionJobs: {
        where: { staleSince: null },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { srtContent: true },
      },
    },
  });

  const role = toUserRole(userContext.effectiveUser.role);
  if (!slot || !canUserAccessSlot(slot, role, userContext.effectiveUser.id)) {
    notFound();
  }

  const mode = resolveCaptionsMode({
    slot: {
      needsCaptionsModeOverride: slot.needsCaptionsModeOverride,
      needsCaptionsOverride: slot.needsCaptionsOverride,
    },
    pattern: slot.pattern
      ? { needsCaptionsMode: slot.pattern.needsCaptionsMode, needsCaptions: slot.pattern.needsCaptions }
      : null,
  });
  if (mode !== "manual") {
    // Évite que l'admin tombe ici via URL directe sur un slot auto/none —
    // redirige vers la fiche où il choisira la bonne action.
    redirect(`/publications/${slot.id}`);
  }

  const slotLabel = slot.title ?? `@${slot.account.handle}`;
  const backHref = `/publications/${slot.id}`;
  const initialSrt = slot.captionJobs[0]?.srtContent ?? null;

  return (
    <div className="min-h-screen">
      <div
        className="my-11 ml-[100px] mr-[100px] rounded-3xl"
        style={{ background: "var(--gradient-page-shell)" }}
      >
        <div className="px-6 sm:px-8 pt-6 pb-12">
          <div className="max-w-3xl mx-auto space-y-5">
            <div className="sticky top-4 z-10 rounded-xl bg-gradient-to-b from-sky-50/85 to-sky-50/55 backdrop-blur-[12px] backdrop-saturate-150 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(96,165,250,0.30)]">
              <Link
                href={backHref}
                className="inline-flex items-center gap-1 text-xs text-sky-700 hover:text-sky-900 transition-colors"
              >
                <ChevronLeft size={13} />
                Retour à la publication
              </Link>
              <nav className="mt-1 flex items-center gap-1 text-xs text-sky-700/80 flex-wrap">
                <Link
                  href={backHref}
                  className="hover:text-sky-900 transition-colors truncate max-w-[240px] font-medium"
                >
                  {slotLabel}
                </Link>
                <ChevronRight size={11} className="text-sky-700/50" />
                <span className="text-sky-900 font-medium inline-flex items-center gap-1">
                  <Subtitles size={11} />
                  Sous-titres (manuel)
                </span>
              </nav>
            </div>

            <CaptionEditorPanel
              slotId={slot.id}
              initialSrt={initialSrt}
              returnHref={backHref}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
