"use client";

/**
 * SlotCard — carte slot compacte (refonte Phase 5 Liquid Glass MID).
 *
 * Densité acceptée : 7 colonnes étroites en grid 7-cols, donc on ne montre
 * QUE l'essentiel pour identifier la publication d'un coup d'œil :
 * - Heure + dot couleur (phase, label au hover)
 * - Titre
 * - Handle compte + AvatarGroup (assignés)
 *
 * Tout le reste (status verbeux, pipeline dots, pattern link, owner) est
 * porté par le Drawer édition ou la fiche complète.
 */

import { Settings2 } from "lucide-react";
import { AvatarGroup } from "@/components/ui/Avatar";
import { type PublicationSlot } from "@/types/calendar";
import { resolveSlotOwner } from "@/lib/slots/statusLabels";
import { getPublicationPhase, PHASE_LABELS, PHASE_BADGE_LABELS, PHASE_COLORS } from "@/lib/slots/phase";
import type { UserRole } from "@/types/roles";
import { SOURCE_LABELS_FR } from "@/lib/ui/domainLabels";

interface SlotCardProps {
  slot: PublicationSlot;
  onClick: () => void;
  /** Optional : click sur la mini roue → ouvre le drawer d'édition rapide. */
  onOpenDrawer?: () => void;
  currentUserRole?: UserRole;
  currentUserId?: string;
}

export function SlotCard({ slot, onClick, onOpenDrawer, currentUserRole, currentUserId }: SlotCardProps) {
  const time = new Date(slot.scheduledAt).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const phase = getPublicationPhase(slot.status);
  const phaseBadgeLabel = PHASE_BADGE_LABELS[phase];
  const phaseBadgeColor = PHASE_COLORS[phase];
  const ownerRole = resolveSlotOwner(slot);

  const isMine =
    currentUserId !== undefined &&
    ((ownerRole === "VIDEASTE" && slot.assigneeVideasteId === currentUserId) ||
      (ownerRole === "MONTEUR" && slot.assigneeMonteurId === currentUserId) ||
      (ownerRole === "CM" && slot.assigneeCmId === currentUserId) ||
      (ownerRole === "ADMIN" && currentUserRole === "ADMIN"));

  // Composition des avatars assignés pour AvatarGroup.
  const avatars: Array<{ id: string; name: string }> = [];
  if (slot.assigneeVideaste) {
    avatars.push({ id: `v-${slot.assigneeVideaste.id}`, name: slot.assigneeVideaste.name ?? "Vidéaste" });
  }
  if (slot.assigneeMonteur) {
    avatars.push({ id: `m-${slot.assigneeMonteur.id}`, name: slot.assigneeMonteur.name ?? "Monteur" });
  }
  if (slot.assigneeCm) {
    avatars.push({ id: `c-${slot.assigneeCm.id}`, name: slot.assigneeCm.name ?? "CM" });
  }

  const title = slot.pattern?.label ?? slot.title ?? "Publication";

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      title={`${PHASE_LABELS[phase]} · ${title}`}
      className={[
        "group relative w-full text-left rounded-xl px-3.5 py-3 cursor-pointer transition-all",
        // Matière forte — la colonne ne porte plus rien, c'est la card qui doit
        // ressortir comme objet posé.
        "bg-white shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.04),0_8px_20px_-12px_rgba(15,23,42,0.14)]",
        "hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.14),0_4px_8px_rgba(15,23,42,0.06),0_12px_28px_-12px_rgba(15,23,42,0.22)]",
        "hover:-translate-y-px",
        "focus:outline-none focus-visible:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_2px_rgba(77,150,191,0.45),0_0_0_3px_rgba(169,209,230,0.4)]",
        isMine
          ? "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_2px_rgba(125,180,210,0.5),0_2px_4px_rgba(15,23,42,0.04),0_10px_24px_-12px_rgba(125,180,210,0.3)]"
          : "",
      ].filter(Boolean).join(" ")}
    >
      {/* Ligne 1 : badge phase explicite (1 mot, couleur) + heure + (hover) roue */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded-md border text-[9px] font-semibold uppercase tracking-wider shrink-0 ${phaseBadgeColor}`}
          title={PHASE_LABELS[phase]}
        >
          {phaseBadgeLabel}
        </span>
        <span className="text-[11px] font-mono text-gray-600 tabular-nums font-medium">
          {time}
        </span>
        {/* Mini roue : visible au hover seulement. Click → open drawer (édition
            rapide / suppression). e.stopPropagation pour ne pas trigger onClick
            principal qui ouvre la fiche complète. */}
        {onOpenDrawer && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDrawer();
            }}
            onKeyDown={(e) => e.stopPropagation()}
            className="ml-auto p-0.5 text-gray-300 hover:text-gray-700 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity rounded"
            aria-label="Édition rapide"
            title="Édition rapide (statut, assignés, supprimer)"
          >
            <Settings2 size={11} />
          </button>
        )}
      </div>

      {/* Ligne 2 : titre — plus marqué */}
      <p className="mt-2 text-[13px] font-semibold text-gray-950 truncate leading-tight">
        {title}
      </p>

      {/* Ligne 3 : mode du pattern (FR, discret) — visible que si pattern lié */}
      {slot.pattern?.source && SOURCE_LABELS_FR[slot.pattern.source] && (
        <p className="mt-0.5 text-[9.5px] uppercase tracking-widest text-gray-400 truncate">
          {SOURCE_LABELS_FR[slot.pattern.source]}
        </p>
      )}

      {/* Ligne 4 : nom du compte + avatars */}
      <div className="mt-2.5 flex items-center justify-between gap-1.5 min-h-[16px]">
        <span className="text-[11px] text-gray-500 truncate" title={`@${slot.account.handle}`}>
          {slot.account.name}
        </span>
        {avatars.length > 0 && (
          <AvatarGroup avatars={avatars} max={3} size="xs" />
        )}
      </div>
    </div>
  );
}
