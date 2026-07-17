"use client";

/**
 * NextActionBanner — mini pill flottant "Ta prochaine action".
 *
 * Refonte 2026-05-30 — feedback Mathis : auparavant un gros bandeau peach
 * full-width sous le header (lourd visuellement, dominant alors qu'il s'agit
 * d'une info contextuelle). Désormais un mini pill discret aligné à droite,
 * juste sous le header, avec :
 *  - Icon Sparkles (signature "next-action") + libellé court
 *  - Click → ouvre + scroll vers la section concernée
 *  - Glass v2 sage léger (positif, "à toi" = action positive à faire)
 *  - Padding minimal, ne prend qu'un row
 */

import { Sparkles, ArrowRight } from "lucide-react";
import {
  NEXT_ACTION,
  OWNER_LABEL,
  type SlotStatus,
} from "@/types/calendar";
import { resolveSlotOwner } from "@/lib/slots/statusLabels";
import type { UserRole } from "@/types/roles";
import { Tooltip } from "@/components/ui/Tooltip";

interface Props {
  slotStatus: string;
  currentUserId: string;
  currentUserRole: UserRole;
  assigneeMonteurId: string | null;
  assigneeCmId: string | null;
  assigneeVideasteId?: string | null;
  /**
   * Set des sectionIds réellement rendus dans la fiche. Si le statut mappe
   * vers une section absente (ex. CM en READY_FOR_CM mais needsDescription=
   * "none"), le bouton "Aller à la section" est masqué pour éviter un scroll
   * mort.
   */
  visibleSectionIds?: Set<string>;
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

// Mapping statut → section à scroller au clic. Quand un statut n'est pas
// dans cette map, la pill devient non-cliquable (sectionId undefined ⇒
// isClickable false dans la fn).
//
// Fix W4.1 : CLIENT_REVISION pointait vers "render" alors que le CM doit
// voir l'historique de validation client (commentaires de refus, magic
// link expiré) — donc bonne destination = "client-validation".
const STATUS_TO_SECTION: Record<string, string> = {
  RUSHES_EXPECTED: "rushes",
  RUSHES_RECEIVED: "render",
  IN_EDIT: "render",
  EDIT_APPROVED: "render",
  CAPTIONS_PENDING: "captions",
  CAPTIONS_GENERATING: "captions",
  CLIENT_REVISION: "clientValidation",
  EDIT_REVIEW: "render",
  READY_FOR_CM: "description",
  AWAITING_CLIENT: "clientValidation",
  SCHEDULED: "publish",
  DRAFT: "render",
  PLANNED: "brief",
  IN_PROGRESS: "render",
  RENDER_PROCESSING: "render",
  BLOCKED: "render",
  REJECTED: "render",
  // PUBLISHED + CANCELLED + DONE = états terminaux — pas de section à
  // scroller, la pill reste non-cliquable.
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
  visibleSectionIds,
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
  // Section absente dans le DOM → on masque le lien plutôt que de scroller
  // dans le vide (ex. CM en READY_FOR_CM mais needsDescription="none").
  const sectionInDom = sectionId
    ? visibleSectionIds
      ? visibleSectionIds.has(sectionId)
      : true
    : false;

  const isClickable = Boolean(sectionId && sectionInDom);

  const content = (
    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-success-50 border border-success-200">
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-success-100 text-success-700">
        <Sparkles size={9} />
      </span>
      <span className="text-[10.5px] uppercase tracking-widest font-semibold text-success-700">
        À toi
      </span>
      {/* W4.9 : Tooltip primitive (style cohérent design system) en plus du
          native title — utile pour les actions longues qui sont tronquées. */}
      <Tooltip content={action} delay={400}>
        <span className="text-[12px] text-success-700 max-w-[260px] truncate" title={action}>
          {action}
        </span>
      </Tooltip>
      {isClickable && (
        <ArrowRight
          size={11}
          className="text-success-700/70 group-hover:translate-x-0.5 transition-transform"
          aria-hidden="true"
        />
      )}
      <span className="sr-only"> · {OWNER_LABEL[owner]}</span>
    </span>
  );

  return (
    <div className="flex justify-end">
      {isClickable && sectionId ? (
        <button
          type="button"
          onClick={() => goToSection(sectionId)}
          className="group focus-ring rounded-lg"
          title={`Aller à la section "${sectionId}"`}
        >
          {content}
        </button>
      ) : (
        content
      )}
    </div>
  );
}
