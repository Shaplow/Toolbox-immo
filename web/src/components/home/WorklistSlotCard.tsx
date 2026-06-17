"use client";

/**
 * WorklistSlotCard — card slot d'une worklist home (refonte MID Liquid Glass).
 *
 * Row card horizontale, blanche opaque avec shadow franche (matière forte
 * pour ressortir sur le fond pastel du wrapper). Hover lift -translate-y-px.
 * Click → navigate vers la fiche complète.
 *
 * Phases overdue : surlignée avec ring inset rose.
 */

import { useRouter } from "next/navigation";
import { AlertCircle, ChevronRight } from "lucide-react";
import { STATUS_LABELS } from "@/types/calendar";
import { getPublicationPhase } from "@/lib/slots/phase";
import type { SlotDetailPanelMode } from "@/components/calendar/SlotDetailPanel";
import type { WorklistSlot } from "@/types/worklist";
import { isSlotOverdue } from "@/types/worklist";

/**
 * Badges contextuels optionnels pour les monteurs.
 */
export interface WorklistSlotBadges {
  /** True si le slot vient de recevoir des nouveaux rushes (RUSHES_RECEIVED). */
  hasNewRushes?: boolean;
  /** Numéro de la dernière version livrée en attente de validation. */
  versionPendingNumber?: number | null;
}

/**
 * Badges contextuels optionnels pour les CM.
 */
export interface WorklistCmBadges {
  /** Label de statut affiché sur la card CM. */
  statusLabel?: string;
  /** Classes Tailwind pour le badge (bg + text + border). */
  statusClasses?: string;
}

interface WorklistSlotCardProps {
  slot: WorklistSlot;
  mode: SlotDetailPanelMode;
  monteurBadges?: WorklistSlotBadges;
  cmBadges?: WorklistCmBadges;
}

// Dot couleur par phase (cohérent SlotCard calendar).
const PHASE_DOT_COLOR: Record<ReturnType<typeof getPublicationPhase>, string> = {
  planned: "bg-gray-400",
  shooting: "bg-warning-600",
  production: "bg-stone-500",
  admin_review: "bg-warning-600",
  cm_review: "bg-info-600",
  publishing: "bg-info-500",
  published: "bg-success-500",
  terminated: "bg-gray-300",
};

function formatScheduledAt(date: Date): string {
  const datePart = date.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "long",
  });
  const timePart = date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${datePart} · ${timePart}`;
}

export function WorklistSlotCard({ slot, monteurBadges, cmBadges }: WorklistSlotCardProps) {
  const router = useRouter();
  const overdue = isSlotOverdue(slot);
  const phase = getPublicationPhase(slot.status);
  const phaseDotColor = PHASE_DOT_COLOR[phase];

  const showNewRushes = monteurBadges?.hasNewRushes === true;
  const versionPendingN = monteurBadges?.versionPendingNumber ?? null;
  const title = slot.pattern?.label ?? slot.title ?? "Publication";

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      router.push(`/publications/${slot.id}`);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/publications/${slot.id}`)}
      onKeyDown={handleKeyDown}
      className={[
        "group relative w-full text-left rounded-md px-4 py-3 cursor-pointer transition-colors focus-ring",
        "bg-card border",
        overdue ? "border-danger-300 hover:border-danger-400" : "border-border hover:border-zinc-300",
        "hover:bg-muted",
      ].filter(Boolean).join(" ")}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-1.5">
          {overdue ? (
            <AlertCircle size={14} className="text-danger-600" />
          ) : (
            <span
              className={`inline-block h-2 w-2 rounded-full ${phaseDotColor}`}
              aria-hidden
            />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-foreground truncate leading-tight">
            {title}
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground truncate">
            @{slot.account.handle}
            {slot.account.name !== slot.account.handle && (
              <span className="text-muted-foreground/70"> · {slot.account.name}</span>
            )}
          </p>
          <p
            className={`mt-1 text-[11px] font-mono tabular-nums ${
              overdue ? "text-danger-700 font-medium" : "text-muted-foreground"
            }`}
          >
            {slot.scheduledAt ? (
              formatScheduledAt(slot.scheduledAt)
            ) : (
              <span className="uppercase tracking-widest text-[10px] font-semibold text-muted-foreground">
                En banque
              </span>
            )}
            {overdue && (
              <span className="ml-1.5 font-semibold uppercase text-danger-700 text-[10px] tracking-widest">
                En retard
              </span>
            )}
          </p>

          {(showNewRushes || versionPendingN !== null) && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {showNewRushes && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning-50 text-warning-700 border border-warning-200">
                  Nouveaux rushes
                </span>
              )}
              {versionPendingN !== null && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                  V{versionPendingN} en révision admin
                </span>
              )}
            </div>
          )}

          {cmBadges?.statusLabel && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  cmBadges.statusClasses ??
                  "bg-muted text-muted-foreground border border-border"
                }`}
              >
                {cmBadges.statusLabel}
              </span>
            </div>
          )}
        </div>

        <div className="shrink-0 flex flex-col items-end gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-medium bg-muted text-muted-foreground border border-border">
            {STATUS_LABELS[slot.status]}
          </span>
          <ChevronRight
            size={14}
            className="text-muted-foreground group-hover:text-foreground transition-colors"
          />
        </div>
      </div>
    </div>
  );
}
