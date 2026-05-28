"use client";

/**
 * NextActionBanner — bandeau "À ton tour" affiché sous le header de la fiche
 * publication quand l'utilisateur connecté est le owner du statut courant
 * (STATUS_OWNER) ET qu'il est assigné au slot pour ce rôle.
 *
 * But : permettre au monteur/CM/vidéaste de voir immédiatement ce qu'il doit
 * faire sans avoir à interpréter la ProductionChain ni scroller dans la fiche.
 */

import { ArrowRight } from "lucide-react";
import {
  NEXT_ACTION,
  OWNER_LABEL,
  OWNER_BADGE_CLS,
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

/** Détermine si l'utilisateur connecté est le owner attendu pour ce statut. */
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

/** Map statut → section de la fiche à scroller (anchor #id). */
const STATUS_TO_SECTION: Record<string, string> = {
  // Vidéaste : doit déposer les rushes
  RUSHES_EXPECTED: "rushes",
  // Monteur : montage / version
  RUSHES_RECEIVED: "render",
  IN_EDIT: "render",
  EDIT_APPROVED: "render",
  CAPTIONS_PENDING: "captions",
  CLIENT_REVISION: "render",
  // CM : validation / légende / publication
  EDIT_REVIEW: "render",
  READY_FOR_CM: "description",
  AWAITING_CLIENT: "clientValidation",
  SCHEDULED: "publish",
  // ADMIN
  DRAFT: "render",
  PLANNED: "brief",
  BLOCKED: "render",
  REJECTED: "render",
};

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
    <div className="bg-indigo-50 border-y border-indigo-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${OWNER_BADGE_CLS[owner]}`}
          >
            À toi · {OWNER_LABEL[owner]}
          </span>
          <span className="text-sm font-medium text-indigo-900">{action}</span>
        </div>
        {sectionId && (
          <a
            href={`#${sectionId}`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 hover:text-indigo-900"
          >
            Aller à la section
            <ArrowRight size={13} />
          </a>
        )}
      </div>
    </div>
  );
}
