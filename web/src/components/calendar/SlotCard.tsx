"use client";

/**
 * SlotCard — carte slot compacte 56px (refonte I.1 — densification).
 *
 * Cible : 10+ slots visibles par viewport 1080p. Drop le nom du compte (info
 * accessible dans le drawer, color-code par rôle d'ownership en bordure).
 *
 * Layout 3 lignes serrées :
 *   1. Dot couleur phase (6px) + heure (11px font-mono) + bouton drawer (hover)
 *   2. Titre 13px truncate
 *   3. 3 avatars xs assignés (right-aligned)
 *
 * isMine = border-l-2 primary (vs glass shadow inset complexe).
 */

import { Settings2 } from "lucide-react";
import { AvatarGroup } from "@/components/ui/Avatar";
import { type PublicationSlot } from "@/types/calendar";
import { resolveSlotOwner } from "@/lib/slots/statusLabels";
import {
  getPublicationPhase,
  PHASE_DOT,
  PHASE_LABELS,
} from "@/lib/slots/phase";
import type { UserRole } from "@/types/roles";

interface SlotCardProps {
  slot: PublicationSlot;
  onClick: () => void;
  /** Optional : click sur la mini roue → ouvre le drawer d'édition rapide. */
  onOpenDrawer?: () => void;
  currentUserRole?: UserRole;
  currentUserId?: string;
}

export function SlotCard({
  slot,
  onClick,
  onOpenDrawer,
  currentUserRole,
  currentUserId,
}: SlotCardProps) {
  const time = slot.scheduledAt
    ? new Date(slot.scheduledAt).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
  const phase = getPublicationPhase(slot.status);
  const phaseDot = PHASE_DOT[phase];
  const phaseLabel = PHASE_LABELS[phase];
  const ownerRole = resolveSlotOwner(slot);

  const isMine =
    currentUserId !== undefined &&
    ((ownerRole === "VIDEASTE" && slot.assigneeVideasteId === currentUserId) ||
      (ownerRole === "MONTEUR" && slot.assigneeMonteurId === currentUserId) ||
      (ownerRole === "CM" && slot.assigneeCmId === currentUserId) ||
      (ownerRole === "ADMIN" && currentUserRole === "ADMIN"));

  const avatars: Array<{ id: string; name: string }> = [];
  if (slot.assigneeVideaste) {
    avatars.push({
      id: `v-${slot.assigneeVideaste.id}`,
      name: slot.assigneeVideaste.name ?? "Vidéaste",
    });
  }
  if (slot.assigneeMonteur) {
    avatars.push({
      id: `m-${slot.assigneeMonteur.id}`,
      name: slot.assigneeMonteur.name ?? "Monteur",
    });
  }
  if (slot.assigneeCm) {
    avatars.push({
      id: `c-${slot.assigneeCm.id}`,
      name: slot.assigneeCm.name ?? "CM",
    });
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
      title={`${phaseLabel} · ${title} · ${slot.account ? `@${slot.account.handle}` : "Sans compte"}`}
      className={[
        "group relative w-full text-left rounded-md px-2 py-1.5 cursor-pointer transition-colors",
        "bg-card border border-border hover:bg-muted hover:border-zinc-300",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        isMine ? "border-l-2 border-l-primary" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Ligne 1 : dot phase + heure + statut + (hover) bouton drawer */}
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${phaseDot}`}
          aria-label={phaseLabel}
        />
        <span className="text-[11px] font-mono text-foreground tabular-nums font-medium shrink-0">
          {time}
        </span>
        <span className="text-[10px] text-muted-foreground truncate min-w-0">
          {phaseLabel}
        </span>
        {onOpenDrawer && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDrawer();
            }}
            onKeyDown={(e) => e.stopPropagation()}
            className="ml-auto p-0.5 text-muted-foreground hover:text-foreground transition-colors rounded opacity-0 group-hover:opacity-100"
            aria-label="Édition rapide"
            title="Édition rapide"
          >
            <Settings2 size={10} />
          </button>
        )}
      </div>

      {/* Ligne 2 : titre */}
      <p className="mt-0.5 text-[13px] font-medium text-foreground truncate leading-tight">
        {title}
      </p>

      {/* Ligne 3 : compte IG (gauche) + avatars assignés (droite) */}
      <div className="mt-1 flex items-center justify-between gap-1.5">
        <span className="text-[10px] text-muted-foreground truncate min-w-0">
          {slot.account ? `@${slot.account.handle}` : "Sans compte"}
        </span>
        {avatars.length > 0 && (
          <AvatarGroup avatars={avatars} max={3} size="xs" />
        )}
      </div>
    </div>
  );
}
