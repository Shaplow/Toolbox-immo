"use client";

/**
 * NextActionBanner — bandeau "À ton tour" affiché sous le header.
 *
 * UX décisions Phase 3 (migration ui-boost) :
 * - Bandeau bg-gray-950 text-white Linear-style (au lieu de bg-indigo-50)
 *   — c'est un signal "c'est à toi", doit ressortir avec contraste max.
 * - Badge owner sans couleur, simple pill bordered white/15
 *   (OWNER_BADGE_CLS coloré ne marche pas sur fond dark, on neutralise).
 * - Action en font medium gray-100.
 * - Lien "Aller à la section" → button qui dispatch `pub:open-section`
 *   AU LIEU d'un <a href="#..."> natif. Fix audit : sans dispatch, le
 *   scroll landait sur une CollapsibleSection repliée.
 */

import { ArrowRight } from "lucide-react";
import {
  NEXT_ACTION,
  OWNER_LABEL,
  type SlotStatus,
} from "@/types/calendar";
import { resolveSlotOwner } from "@/lib/slots/statusLabels";
import type { UserRole } from "@/types/roles";

interface Props {
  slotStatus: string;
  currentUserId: string;
  currentUserRole: UserRole;
  assigneeMonteurId: string | null;
  assigneeCmId: string | null;
  assigneeVideasteId?: string | null;
}

function isCurrentUserOwner(args: {
  slotStatus: string;
  currentUserId: string;
  currentUserRole: UserRole;
  assigneeMonteurId: string | null;
  assigneeCmId: string | null;
  assigneeVideasteId?: string | null;
}): boolean {
  const owner = resolveSlotOwner({
    status: args.slotStatus,
    assigneeVideasteId: args.assigneeVideasteId ?? null,
  });
  if (!owner) return false;
  if (owner === "ADMIN") return args.currentUserRole === "ADMIN";
  if (owner === "VIDEASTE") return args.assigneeVideasteId === args.currentUserId;
  if (owner === "MONTEUR") return args.assigneeMonteurId === args.currentUserId;
  if (owner === "CM") return args.assigneeCmId === args.currentUserId;
  return false;
}

const STATUS_TO_SECTION: Record<string, string> = {
  RUSHES_EXPECTED: "rushes",
  RUSHES_RECEIVED: "render",
  IN_EDIT: "render",
  EDIT_APPROVED: "render",
  CAPTIONS_PENDING: "captions",
  CLIENT_REVISION: "render",
  EDIT_REVIEW: "render",
  READY_FOR_CM: "description",
  AWAITING_CLIENT: "client-validation",
  SCHEDULED: "publish",
  DRAFT: "render",
  PLANNED: "brief",
  BLOCKED: "render",
  REJECTED: "render",
};

function goToSection(sectionId: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("pub:open-section", { detail: { sectionId } }),
    );
  }
  // Petit délai pour laisser la section se déplier avant le scroll.
  setTimeout(() => {
    const el = document.getElementById(sectionId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 50);
}

export function NextActionBanner({
  slotStatus,
  currentUserId,
  currentUserRole,
  assigneeMonteurId,
  assigneeCmId,
  assigneeVideasteId,
}: Props) {
  const owner = resolveSlotOwner({
    status: slotStatus,
    assigneeVideasteId: assigneeVideasteId ?? null,
  });
  const action = NEXT_ACTION[slotStatus as SlotStatus] ?? null;
  if (!owner || !action) return null;

  const isMine = isCurrentUserOwner({
    slotStatus,
    currentUserId,
    currentUserRole,
    assigneeMonteurId,
    assigneeCmId,
    assigneeVideasteId,
  });
  if (!isMine) return null;

  const sectionId = STATUS_TO_SECTION[slotStatus];

  return (
    <div className="bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-widest border border-white/20 text-white/90">
            À toi · {OWNER_LABEL[owner]}
          </span>
          <span className="text-[13px] font-medium text-gray-100">{action}</span>
        </div>
        {sectionId && (
          <button
            type="button"
            onClick={() => goToSection(sectionId)}
            className="group inline-flex items-center gap-1.5 text-[12px] font-medium text-gray-300 hover:text-white transition-colors focus-ring rounded px-1 py-0.5"
          >
            Aller à la section
            <ArrowRight
              size={13}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </button>
        )}
      </div>
    </div>
  );
}
