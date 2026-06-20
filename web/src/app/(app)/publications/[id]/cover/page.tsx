/**
 * /publications/[id]/cover — sous-route dédiée à la sélection de la cover
 * pour une publication précise. Phase 1.9 B2-v2.
 *
 * Avant : CoverSection envoyait vers /tools/cover?slotId=X&returnTo=Y mais
 * /tools/cover ignorait ces query params (B2 partiel a ajouté un bandeau
 * mais pas la liaison vraie). Cette sous-route résout définitivement la
 * "cassure de retour" mentionnée dans le plan §6 friction 2.
 *
 * La page :
 *  - Vérifie l'accès du user au slot (canUserAccessSlot, sinon 404).
 *  - Affiche un breadcrumb retour vers la fiche publication.
 *  - Rend <CoverGenerator /> (le composant n'a pas de prop, il fait ses
 *    propres fetch — comportement identique à /tools/cover).
 *
 * /tools/cover reste accessible en mode hors-slot pour ADMIN (test, etc.).
 */

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ImageIcon } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { CoverGenerator } from "@/components/covers/CoverGenerator";
import { slotEffectivePatternSelect, resolveSlotEffectivePattern } from "@/lib/services/slot/effectivePattern";

type Props = { params: Promise<{ id: string }> };

export default async function PublicationCoverPage({ params }: Props) {
  const { id: slotId } = await params;

  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) redirect("/login");

  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.COVERS))) {
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
      coverModeOverride: true,
      account: { select: { handle: true } },
      ...slotEffectivePatternSelect,
      render: { select: { videoUrl: true } },
      currentVersion: { select: { fileUrl: true, fileName: true } },
    },
  });

  // 404 anti-énumération : slot inconnu OU pas accessible.
  const role = toUserRole(userContext.effectiveUser.role);
  if (!slot || !canUserAccessSlot(slot, role, userContext.effectiveUser.id)) {
    notFound();
  }

  const slotLabel = slot.title ?? `@${slot.account.handle}`;
  const backHref = `/publications/${slot.id}`;

  // Phase 2.5 — mode effectif. Si manualSelect : on bascule direct sur l'onglet
  // manuel + on pré-remplit la vidéo (finale renderée ou version montée).
  const effectiveCoverMode =
    slot.coverModeOverride ?? resolveSlotEffectivePattern(slot)?.coverMode ?? "none";
  const prefillVideoUrl =
    slot.render?.videoUrl ?? slot.currentVersion?.fileUrl ?? undefined;
  const prefillVideoName =
    slot.currentVersion?.fileName ??
    (slot.render?.videoUrl ? `Vidéo rendue · ${slotLabel}` : undefined);
  const initialTab: "packs" | "manual" =
    effectiveCoverMode === "manualSelect" ? "manual" : "packs";

  return (
    <div className="min-h-screen">
      <div
        className="mx-auto max-w-7xl px-6 py-8"

      >
        <div className="px-6 sm:px-8 pt-6 pb-12">
          <div className="max-w-6xl mx-auto space-y-5">
            {/* Header contextuel glass — sticky pour rester visible pendant la
                sélection. V5.B.5 : aligné au pattern Liquid Glass des autres
                tools (peach card pour signaler "Cover pour une publication"). */}
            <div className="sticky top-4 z-10 rounded-xl bg-gradient-to-b from-warning-50/85 to-warning-50/55 px-4 py-3 ">
              <Link
                href={backHref}
                className="inline-flex items-center gap-1 text-xs text-warning-700 hover:text-warning-700 transition-colors"
              >
                <ChevronLeft size={13} />
                Retour à la publication
              </Link>
              <nav className="mt-1 flex items-center gap-1 text-xs text-warning-700/80 flex-wrap">
                <Link
                  href={backHref}
                  className="hover:text-warning-700 transition-colors truncate max-w-[240px] font-medium"
                >
                  {slotLabel}
                </Link>
                <ChevronRight size={11} className="text-warning-700/50" />
                <span className="text-warning-700 font-medium inline-flex items-center gap-1">
                  <ImageIcon size={11} />
                  Cover
                </span>
              </nav>
            </div>

            <CoverGenerator
              slotId={slot.id}
              prefillVideoUrl={prefillVideoUrl}
              prefillVideoName={prefillVideoName}
              initialTab={initialTab}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
